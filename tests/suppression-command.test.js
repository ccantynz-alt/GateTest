/**
 * Suppression in place (2026-08-18 audit advancement #13): a repo insider
 * replies `@gatetest ignore <rule>` under the PR comment and the rule is
 * committed to .gatetestignore on the PR head branch. Safety controls are
 * the point: strict command grammar, insider-only, no forks, no injection.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  parseSuppressionCommand,
  isAuthorizedCommenter,
  applySuppression,
  recordSuppression,
} = require('../website/app/lib/suppression-command');

describe('parseSuppressionCommand', () => {
  it('parses the command on its own line, with surrounding prose', () => {
    const body = 'This one is a false positive for us.\n\n@gatetest ignore security:no-helmet\n\nthanks!';
    assert.deepStrictEqual(parseSuppressionCommand(body), { rule: 'security:no-helmet' });
  });

  it('accepts every grammar form ignore-file supports', () => {
    for (const rule of ['flakyTests', 'security:no-csrf-protection', '*:real-clock', 'secrets:aws-key@docs_src/**']) {
      assert.deepStrictEqual(parseSuppressionCommand(`@gatetest ignore ${rule}`), { rule }, rule);
    }
  });

  it('NEGATIVE: prose that merely mentions the command does not trigger', () => {
    assert.strictEqual(parseSuppressionCommand('you could reply `@gatetest ignore x` to silence it, fyi'), null);
  });

  it('NEGATIVE: injection shapes are rejected by the grammar', () => {
    for (const bad of [
      '@gatetest ignore ../../etc/passwd',
      '@gatetest ignore rule;#comment',
      `@gatetest ignore ${'a'.repeat(200)}`,
    ]) {
      assert.strictEqual(parseSuppressionCommand(bad), null, JSON.stringify(bad));
    }
  });

  it('NEGATIVE: a newline cannot smuggle a second rule — only the validated token survives', () => {
    // The command line parses; the trailing line is ordinary comment prose
    // and never reaches the file. What matters is that exactly ONE
    // grammar-validated token is extracted.
    assert.deepStrictEqual(parseSuppressionCommand('@gatetest ignore rule\nsecrets:*'), { rule: 'rule' });
  });
});

describe('isAuthorizedCommenter', () => {
  it('owners, members, collaborators yes; contributors, none, bots no', () => {
    assert.ok(isAuthorizedCommenter({ authorAssociation: 'OWNER', userType: 'User' }));
    assert.ok(isAuthorizedCommenter({ authorAssociation: 'MEMBER', userType: 'User' }));
    assert.ok(isAuthorizedCommenter({ authorAssociation: 'COLLABORATOR', userType: 'User' }));
    assert.ok(!isAuthorizedCommenter({ authorAssociation: 'CONTRIBUTOR', userType: 'User' }));
    assert.ok(!isAuthorizedCommenter({ authorAssociation: 'NONE', userType: 'User' }));
    assert.ok(!isAuthorizedCommenter({ authorAssociation: 'OWNER', userType: 'Bot' }), 'bots never — loop protection');
  });
});

function makeGithub({ headRepo = 'octo/demo', existing = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (/\/pulls\/\d+$/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ head: { ref: 'feature/x', repo: { full_name: headRepo } } }) };
    }
    if (/\/contents\/\.gatetestignore\?ref=/.test(url)) {
      if (existing === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ sha: 'abc123', content: Buffer.from(existing, 'utf-8').toString('base64') }) };
    }
    if (/\/contents\/\.gatetestignore$/.test(url) && opts.method === 'PUT') {
      return { ok: true, status: existing === null ? 201 : 200, json: async () => ({}) };
    }
    if (/\/issues\/\d+\/comments$/.test(url) && opts.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

describe('applySuppression', () => {
  const base = { owner: 'octo', repo: 'demo', prNumber: 7, rule: 'security:no-helmet', actor: 'craig', token: 't' };

  it('creates .gatetestignore on the PR branch when none exists, then acks', async () => {
    const gh = makeGithub();
    const r = await applySuppression({ ...base, fetchImpl: gh.fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.branch, 'feature/x');
    const put = gh.calls.find((c) => c.opts.method === 'PUT');
    assert.ok(put, 'must commit the file');
    const body = JSON.parse(put.opts.body);
    assert.strictEqual(body.branch, 'feature/x');
    const content = Buffer.from(body.content, 'base64').toString('utf-8');
    assert.match(content, /security:no-helmet {2}# suppressed by @craig via PR #7/);
    assert.ok(gh.calls.some((c) => /\/issues\/7\/comments$/.test(c.url)), 'ack reply posted');
  });

  it('appends to an existing file, preserving its content and passing the sha', async () => {
    const gh = makeGithub({ existing: '# mine\nflakyTests\n' });
    const r = await applySuppression({ ...base, fetchImpl: gh.fetchImpl });
    assert.strictEqual(r.ok, true);
    const put = gh.calls.find((c) => c.opts.method === 'PUT');
    const body = JSON.parse(put.opts.body);
    assert.strictEqual(body.sha, 'abc123');
    const content = Buffer.from(body.content, 'base64').toString('utf-8');
    assert.match(content, /^# mine\nflakyTests\nsecurity:no-helmet {2}#/);
  });

  it('is idempotent: an already-present rule commits nothing', async () => {
    const gh = makeGithub({ existing: 'security:no-helmet  # earlier\n' });
    const r = await applySuppression({ ...base, fetchImpl: gh.fetchImpl });
    assert.deepStrictEqual(r, { ok: true, already: true, branch: 'feature/x' });
    assert.ok(!gh.calls.some((c) => c.opts.method === 'PUT'), 'no write for a present rule');
  });

  it('NEGATIVE: refuses fork PRs', async () => {
    const gh = makeGithub({ headRepo: 'attacker/demo' });
    const r = await applySuppression({ ...base, fetchImpl: gh.fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /fork/);
    assert.ok(!gh.calls.some((c) => c.opts.method === 'PUT'));
  });
});

describe('recordSuppression', () => {
  it('creates the table and inserts the row', async () => {
    const statements = [];
    const sql = async (strings, ...values) => { statements.push({ text: strings.join('?'), values }); return []; };
    const ok = await recordSuppression(sql, { repository: 'octo/demo', rule: 'security:no-helmet', actor: 'craig', prNumber: 7 });
    assert.strictEqual(ok, true);
    assert.match(statements[0].text, /CREATE TABLE IF NOT EXISTS rule_suppressions/);
    assert.match(statements[1].text, /INSERT INTO rule_suppressions/);
    assert.deepStrictEqual(statements[1].values, ['octo/demo', 'security:no-helmet', 'craig', 7]);
  });
});

// ── end to end through the webhook processor ───────────────────────────────

describe('issue_comment through processGitHubEvent', () => {
  const crypto = require('crypto');
  const { processGitHubEvent, extractGitHubEvent } = require('../website/app/lib/github-events');
  const SECRET = 'whsec';

  function commentPayload({ body, association = 'OWNER', userType = 'User', prIssue = true } = {}) {
    return {
      action: 'created',
      repository: { full_name: 'octo/demo' },
      issue: { number: 7, ...(prIssue ? { pull_request: { url: 'x' } } : {}) },
      comment: { body, author_association: association, user: { login: 'craig', type: userType } },
    };
  }

  function args(payload) {
    const rawBody = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const gh = makeGithub();
    return {
      a: {
        rawBody,
        eventType: 'issue_comment',
        delivery: 'd-1',
        signatureHeader: sig,
        env: { GITHUB_WEBHOOK_SECRET: SECRET, GITHUB_TOKEN: 'ghp_x' },
        sql: async () => [],
        queueStore: {},
        fetchImpl: gh.fetchImpl,
        baseUrl: 'https://gatetest.io',
      },
      gh,
    };
  }

  it('an authorized command suppresses and reports it', async () => {
    const { a, gh } = args(commentPayload({ body: '@gatetest ignore security:no-helmet' }));
    const r = await processGitHubEvent(a);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.suppressed, true);
    assert.ok(gh.calls.some((c) => c.opts.method === 'PUT'));
  });

  it('NEGATIVE: a drive-by commenter is ignored (204, nothing written)', async () => {
    const { a, gh } = args(commentPayload({ body: '@gatetest ignore security:no-helmet', association: 'NONE' }));
    const r = await processGitHubEvent(a);
    assert.strictEqual(r.status, 204, 'unauthorized commenters are an ignore, not an action');
    assert.ok(!gh.calls.some((c) => c.opts.method === 'PUT'));
  });

  it('NEGATIVE: a non-PR issue comment is ignored', async () => {
    const e = extractGitHubEvent('issue_comment', 'd-1', commentPayload({ body: '@gatetest ignore x:y', prIssue: false }));
    assert.strictEqual(e.kind, 'ignore');
  });
});
