/**
 * Onboarding — installing the App must produce value immediately.
 *
 * Before this, installing persisted an installation_id and redirected to a
 * page that upsold auto-fixes. That was the whole onboarding. Nothing
 * scanned. The customer had to leave, write code, push it and wait for CI
 * before GateTest did anything — so the one moment they were paying
 * attention produced no evidence the product works.
 *
 * The tests below are weighted toward the failure paths, because this code
 * runs inside a redirect a customer is watching: if it can hang or throw,
 * a successful install becomes an error page.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  MAX_FIRST_SCANS,
  selectFirstScanRepos,
  firstScanEventId,
  enqueueFirstScans,
} = require('../website/app/lib/onboarding');

const repo = (full_name, extra = {}) => ({ full_name, pushed_at: '2026-01-01T00:00:00Z', ...extra });

function deps(overrides = {}) {
  const calls = { enqueued: [] };
  const base = {
    getInstallationToken: async () => 'ghs_token',
    listRepos: async () => [repo('acme/api'), repo('acme/web')],
    getDefaultBranchSha: async (_t, full) => ({ sha: `sha-${full}`, ref: 'refs/heads/main' }),
    enqueueScan: async (job) => { calls.enqueued.push(job); return { duplicate: false, id: calls.enqueued.length }; },
    sql: () => {},
  };
  return { deps: { ...base, ...overrides }, calls };
}

describe('onboarding — repo selection', () => {
  it('prefers the most recently pushed repo — that is what they are working on', () => {
    const picked = selectFirstScanRepos([
      repo('acme/old', { pushed_at: '2020-01-01T00:00:00Z' }),
      repo('acme/hot', { pushed_at: '2026-07-01T00:00:00Z' }),
      repo('acme/mid', { pushed_at: '2024-01-01T00:00:00Z' }),
    ]);
    assert.deepStrictEqual(picked.map((r) => r.full_name), ['acme/hot', 'acme/mid', 'acme/old']);
  });

  it('caps the fan-out — an org install must not bury the queue', () => {
    const many = Array.from({ length: 50 }, (_, i) => repo(`acme/r${i}`));
    assert.strictEqual(selectFirstScanRepos(many).length, MAX_FIRST_SCANS);
  });

  it('drops archived and disabled repos', () => {
    // A finding on an archive is noise at the worst possible moment.
    const picked = selectFirstScanRepos([
      repo('acme/live'), repo('acme/dead', { archived: true }), repo('acme/off', { disabled: true }),
    ]);
    assert.deepStrictEqual(picked.map((r) => r.full_name), ['acme/live']);
  });

  it('survives junk input', () => {
    assert.deepStrictEqual(selectFirstScanRepos(null), []);
    assert.deepStrictEqual(selectFirstScanRepos([null, {}, repo('a/b')]).map((r) => r.full_name), ['a/b']);
  });
});

describe('onboarding — the happy path', () => {
  it('queues a scan per selected repo, at the default branch head', async () => {
    const { deps: d, calls } = deps();
    const res = await enqueueFirstScans({ installationId: '42', deps: d });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.queued.length, 2);
    assert.deepStrictEqual(calls.enqueued.map((j) => j.repository), ['acme/api', 'acme/web']);
    for (const job of calls.enqueued) {
      assert.strictEqual(job.host, 'github', 'a GitHub install must enqueue with host=github');
      assert.strictEqual(job.ref, 'refs/heads/main');
      assert.ok(job.sha, 'a job without a sha cannot be scanned');
    }
  });

  it('is idempotent — a retried callback cannot double-queue', () => {
    // enqueueScan is ON CONFLICT (event_id) DO NOTHING, so the eventId must
    // be derived, never random.
    const a = firstScanEventId('42', 'acme/api', 'abcdef1234567890');
    const b = firstScanEventId('42', 'acme/api', 'abcdef1234567890');
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, firstScanEventId('42', 'acme/web', 'abcdef1234567890'));
    assert.notStrictEqual(a, firstScanEventId('43', 'acme/api', 'abcdef1234567890'));
  });
});

describe('onboarding — must never break the install', () => {
  // Every case here would otherwise turn a successful install into an error
  // page or a hung redirect.
  it('a failing token returns a reason instead of throwing', async () => {
    const { deps: d } = deps({ getInstallationToken: async () => { throw new Error('bad key'); } });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, false);
    assert.match(res.reason, /token: bad key/);
  });

  it('a failing repo list returns a reason instead of throwing', async () => {
    const { deps: d } = deps({ listRepos: async () => { throw new Error('403'); } });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, false);
    assert.match(res.reason, /list-repos/);
  });

  it('one bad repo does not stop the others', async () => {
    const { deps: d, calls } = deps({
      getDefaultBranchSha: async (_t, full) =>
        full === 'acme/api' ? (() => { throw new Error('boom'); })() : { sha: 'ok', ref: 'refs/heads/main' },
    });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(calls.enqueued.length, 1);
    assert.strictEqual(res.skipped.length, 1);
  });

  it('an empty repo is skipped, not failed', async () => {
    // A repo with no commits has no SHA; asking GitHub for one 409s.
    const { deps: d } = deps({ getDefaultBranchSha: async () => null });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.queued.length, 0);
    assert.ok(res.skipped.every((s) => s.reason === 'empty-repo'));
  });

  it('an install with no eligible repos is a clean no-op', async () => {
    const { deps: d } = deps({ listRepos: async () => [] });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.reason, 'no-eligible-repos');
  });

  it('missing deps or id degrade rather than throw', async () => {
    assert.strictEqual((await enqueueFirstScans({ deps: deps().deps })).reason, 'no-installation-id');
    assert.strictEqual((await enqueueFirstScans({ installationId: '42', deps: {} })).reason, 'deps-missing');
    await assert.doesNotReject(() => enqueueFirstScans({}));
  });

  it('a queue failure on one repo is recorded, not thrown', async () => {
    const { deps: d } = deps({ enqueueScan: async () => { throw new Error('db down'); } });
    const res = await enqueueFirstScans({ installationId: '42', deps: d });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.queued.length, 0);
    assert.match(res.skipped[0].reason, /enqueue: db down/);
  });
});

describe('onboarding — wired into the install callback', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'website', 'app', 'api', 'github', 'callback', 'route.ts'), 'utf8',
  );

  it('the install branch actually calls it', () => {
    assert.match(src, /await startFirstScans\(installationId\)/);
  });

  it('the callback still redirects even if onboarding fails', () => {
    assert.match(src, /async function startFirstScans[\s\S]*?catch \(err\)/,
      'startFirstScans must swallow its own failures — a slow GitHub must not error the install');
  });
});
