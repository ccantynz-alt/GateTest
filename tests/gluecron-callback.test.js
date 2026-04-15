// ============================================================================
// GLUECRON CALLBACK TEST — Finding 3 (async scan-result callback)
// ============================================================================
// Verifies the GateTest → Gluecron scan-result callback matches the wire
// contract at /home/user/Gluecron.com/GATETEST_HOOK.md exactly:
//   - POST to GLUECRON_CALLBACK_URL
//   - Authorization: Bearer <GLUECRON_CALLBACK_SECRET>
//   - Content-Type: application/json
//   - Body shape: { repository, sha, ref, status, summary, details, durationMs }
// And that callback failure NEVER throws — the sync /api/scan/run response
// must not break if Gluecron is unreachable.
// ============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  buildGluecronPayload,
  sendGluecronCallback,
} = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'gluecron-callback.js'));

const TEST_URL = 'https://gluecron.example.test/api/hooks/gatetest';
const TEST_SECRET = 'test-bearer-token-0123456789abcdef';

function sampleScanResult({ error, issues = 0, modules = 3, duration = 4200 } = {}) {
  const mods = [];
  for (let i = 0; i < modules; i++) {
    mods.push({
      name: `module_${i}`,
      status: i === 0 && issues > 0 ? 'failed' : 'passed',
      checks: 10,
      issues: i === 0 ? issues : 0,
      duration: 100,
    });
  }
  return {
    modules: mods,
    totalIssues: issues,
    duration,
    authSource: 'github-app',
    ...(error ? { error } : {}),
  };
}

describe('buildGluecronPayload', () => {
  it('builds a "passed" payload when scan has zero issues and no error', () => {
    const payload = buildGluecronPayload({
      repository: 'alice/webapp',
      sha: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
      scanResult: sampleScanResult({ issues: 0 }),
    });
    assert.strictEqual(payload.repository, 'alice/webapp');
    assert.strictEqual(payload.sha, '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b');
    assert.strictEqual(payload.ref, 'refs/heads/main', 'default ref');
    assert.strictEqual(payload.status, 'passed');
    assert.ok(typeof payload.summary === 'string' && payload.summary.length > 0);
    assert.ok(payload.details && typeof payload.details === 'object');
    assert.strictEqual(payload.durationMs, 4200);
  });

  it('builds a "failed" payload when totalIssues > 0', () => {
    const payload = buildGluecronPayload({
      repository: 'alice/webapp',
      sha: 'a'.repeat(40),
      scanResult: sampleScanResult({ issues: 7 }),
    });
    assert.strictEqual(payload.status, 'failed');
    assert.match(payload.summary, /7/);
  });

  it('builds an "error" payload when the scan reports an error', () => {
    const payload = buildGluecronPayload({
      repository: 'alice/webapp',
      sha: 'b'.repeat(40),
      scanResult: sampleScanResult({ error: 'Cannot access repo: 404' }),
    });
    assert.strictEqual(payload.status, 'error');
    assert.match(payload.summary, /Cannot access/);
  });

  it('honours an explicit ref', () => {
    const payload = buildGluecronPayload({
      repository: 'alice/webapp',
      sha: 'c'.repeat(40),
      ref: 'refs/heads/feature-branch',
      scanResult: sampleScanResult(),
    });
    assert.strictEqual(payload.ref, 'refs/heads/feature-branch');
  });
});

describe('sendGluecronCallback — POST contract', () => {
  it('POSTs to GLUECRON_CALLBACK_URL with Bearer auth and JSON body', async () => {
    const calls = [];
    const fakeFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };

    const result = await sendGluecronCallback({
      repository: 'alice/webapp',
      sha: 'd'.repeat(40),
      ref: 'refs/heads/main',
      scanResult: sampleScanResult({ issues: 0 }),
      fetchImpl: fakeFetch,
      env: {
        GLUECRON_CALLBACK_URL: TEST_URL,
        GLUECRON_CALLBACK_SECRET: TEST_SECRET,
      },
    });

    assert.strictEqual(result.sent, true);
    assert.strictEqual(calls.length, 1);

    const [call] = calls;
    assert.strictEqual(call.url, TEST_URL, 'POST URL matches GLUECRON_CALLBACK_URL');
    assert.strictEqual(call.init.method, 'POST');
    assert.strictEqual(
      call.init.headers.Authorization,
      `Bearer ${TEST_SECRET}`,
      'Authorization: Bearer <GLUECRON_CALLBACK_SECRET>',
    );
    assert.strictEqual(call.init.headers['Content-Type'], 'application/json');

    const body = JSON.parse(call.init.body);
    // Wire-spec field set (see GATETEST_HOOK.md)
    for (const field of ['repository', 'sha', 'ref', 'status', 'summary', 'details', 'durationMs']) {
      assert.ok(field in body, `body missing required field: ${field}`);
    }
    assert.strictEqual(body.repository, 'alice/webapp');
    assert.strictEqual(body.sha.length, 40);
    assert.strictEqual(body.ref, 'refs/heads/main');
    assert.ok(['passed', 'failed', 'error'].includes(body.status));
    assert.strictEqual(typeof body.summary, 'string');
    assert.strictEqual(typeof body.details, 'object');
    assert.strictEqual(typeof body.durationMs, 'number');
  });

  it('skips the POST (no fetch call) when env vars are missing', async () => {
    let called = 0;
    const fakeFetch = async () => {
      called += 1;
      return { ok: true, status: 200 };
    };

    const result = await sendGluecronCallback({
      repository: 'alice/webapp',
      sha: 'e'.repeat(40),
      scanResult: sampleScanResult(),
      fetchImpl: fakeFetch,
      env: {}, // neither URL nor SECRET set
    });

    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'missing-config');
    assert.strictEqual(called, 0, 'fetch must not be called when config is missing');
  });
});

describe('sendGluecronCallback — error swallowing', () => {
  it('does NOT throw when fetch rejects', async () => {
    const boomFetch = async () => {
      throw new Error('ECONNREFUSED — Gluecron unreachable');
    };

    // If this throws, the scan-run route would crash. The contract says it
    // must resolve to a { sent: false } object without bubbling the error up.
    const result = await sendGluecronCallback({
      repository: 'alice/webapp',
      sha: 'f'.repeat(40),
      scanResult: sampleScanResult(),
      fetchImpl: boomFetch,
      env: {
        GLUECRON_CALLBACK_URL: TEST_URL,
        GLUECRON_CALLBACK_SECRET: TEST_SECRET,
      },
    });

    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'fetch-error');
  });

  it('does NOT throw when fetch returns a non-OK response', async () => {
    const badFetch = async () => ({ ok: false, status: 500 });

    const result = await sendGluecronCallback({
      repository: 'alice/webapp',
      sha: '1'.repeat(40),
      scanResult: sampleScanResult(),
      fetchImpl: badFetch,
      env: {
        GLUECRON_CALLBACK_URL: TEST_URL,
        GLUECRON_CALLBACK_SECRET: TEST_SECRET,
      },
    });

    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, 'non-ok');
    assert.strictEqual(result.status, 500);
  });

  it('works with a mocked globalThis.fetch (no fetchImpl override)', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 204 };
    };
    try {
      const result = await sendGluecronCallback({
        repository: 'alice/webapp',
        sha: '2'.repeat(40),
        scanResult: sampleScanResult(),
        env: {
          GLUECRON_CALLBACK_URL: TEST_URL,
          GLUECRON_CALLBACK_SECRET: TEST_SECRET,
        },
      });
      assert.strictEqual(result.sent, true);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, TEST_URL);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
