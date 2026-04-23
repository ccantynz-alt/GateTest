/**
 * Mocked-HTTP integration test for the Gluecron v2 wire contract.
 *
 * We spin up a local HTTP server impersonating Gluecron's v2 API and drive
 * the shipped JS bridge (src/core/gluecron-bridge.js) through every path
 * the new TypeScript adapter at integrations/gluecron/ also uses:
 *
 *   GET  /api/v2/user                          → verifyAuth()
 *   GET  /api/v2/repos/:owner/:repo            → getDefaultBranch() step 1
 *   GET  /api/v2/repos/:owner/:repo/tree/:ref  → getDefaultBranch() / listRepoFiles()
 *   POST /api/v2/repos/:owner/:repo/git/refs   → createBranch()
 *   POST /api/v2/repos/:owner/:repo/pulls      → createPullRequest()
 *   GET  /api/v2/repos/:owner/:repo/pulls/:n   → getPullRequest()
 *   POST /api/v2/repos/:owner/:repo/pulls/:n/comments → addPrComment()
 *   POST /api/v2/repos/:owner/:repo/statuses/:sha     → setCommitStatus()
 *   GET  /api/v2/repos/:owner/:repo/commits/:sha      → getCommit()
 *
 * Each assertion covers URL path, HTTP verb, Authorization header shape,
 * and body for write endpoints — i.e. the exact contract the TS adapter
 * relies on.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { GluecronBridge, circuitState, rateLimitState } = require('../src/core/gluecron-bridge');

// Capture of every request the bridge sends during a test run.
const received = [];

function recordRequest(req, body) {
  received.push({
    method: req.method,
    url: req.url,
    headers: { ...req.headers },
    body,
  });
}

function jsonRespond(res, status, obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

let server;
let baseUrl;
let bridge;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf-8');
      let bodyParsed = null;
      if (bodyRaw) {
        try {
          bodyParsed = JSON.parse(bodyRaw);
        } catch {
          bodyParsed = bodyRaw;
        }
      }
      recordRequest(req, bodyParsed);

      // Route table mirrors Gluecron v2 contract. 201 for writes, 200 for reads.
      const u = req.url;
      const m = req.method;

      if (m === 'GET' && u === '/api/v2/user') {
        return jsonRespond(res, 200, { id: 7, username: 'gatetest-bot', email: 'bot@example.com' });
      }
      if (m === 'GET' && u === '/api/hooks/ping') {
        return jsonRespond(res, 200, { ok: true });
      }
      let match;
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)$/);
      if (m === 'GET' && match) {
        return jsonRespond(res, 200, {
          id: 1,
          name: match[2],
          defaultBranch: 'main',
          owner: { id: 1, login: match[1] },
        });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/tree\/([^?]+)(?:\?.*)?$/);
      if (m === 'GET' && match) {
        return jsonRespond(res, 200, {
          sha: 'deadbeefcafebabedeadbeefcafebabedeadbeef',
          tree: [
            { path: 'README.md', type: 'blob', sha: 'a'.repeat(40), size: 100 },
            { path: 'src/index.ts', type: 'blob', sha: 'b'.repeat(40), size: 2048 },
          ],
        });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/git\/refs$/);
      if (m === 'POST' && match) {
        return jsonRespond(res, 201, { ok: true, ref: bodyParsed.ref, sha: bodyParsed.sha });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/pulls$/);
      if (m === 'POST' && match) {
        return jsonRespond(res, 201, {
          id: 42,
          number: 42,
          title: bodyParsed.title,
          body: bodyParsed.body,
          headBranch: bodyParsed.headBranch,
          baseBranch: bodyParsed.baseBranch,
          state: 'open',
        });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
      if (m === 'GET' && match) {
        return jsonRespond(res, 200, {
          id: Number(match[3]),
          number: Number(match[3]),
          title: 'Test PR',
          body: '',
          state: 'open',
          baseBranch: 'main',
          headBranch: 'feat/x',
        });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/comments$/);
      if (m === 'POST' && match) {
        return jsonRespond(res, 201, { ok: true, comment: { id: 9, body: bodyParsed.body } });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/statuses\/([0-9a-f]+)$/);
      if (m === 'POST' && match) {
        return jsonRespond(res, 201, {
          ok: true,
          state: bodyParsed.state,
          context: bodyParsed.context,
          sha: match[3],
        });
      }
      match = u.match(/^\/api\/v2\/repos\/([^/]+)\/([^/]+)\/commits\/([0-9a-f]+)$/);
      if (m === 'GET' && match) {
        return jsonRespond(res, 200, { sha: match[3], message: 'test', files: [] });
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found in mock', url: u, method: m }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;

  bridge = new GluecronBridge({ token: 'glc_' + 'a'.repeat(64), baseUrl });
  // Ensure the state is clean across test runs.
  circuitState.status = 'closed';
  circuitState.failures = 0;
  rateLimitState.remaining = null;
});

after(() => {
  server.close();
});

function lastRequest() {
  return received[received.length - 1];
}

describe('GluecronBridge — v2 wire contract', () => {
  it('verifyAuth() → GET /api/v2/user with bearer token', async () => {
    received.length = 0;
    const me = await bridge.verifyAuth();
    assert.strictEqual(me.login, 'gatetest-bot');
    const r = lastRequest();
    assert.strictEqual(r.method, 'GET');
    assert.strictEqual(r.url, '/api/v2/user');
    assert.match(r.headers.authorization, /^Bearer glc_/);
  });

  it('getDefaultBranch() → GET repo meta then recursive tree', async () => {
    received.length = 0;
    const info = await bridge.getDefaultBranch('ccantynz-alt', 'Gluecron.com');
    assert.strictEqual(info.name, 'main');
    assert.strictEqual(info.sha, 'deadbeefcafebabedeadbeefcafebabedeadbeef');
    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].url, '/api/v2/repos/ccantynz-alt/Gluecron.com');
    assert.strictEqual(received[1].url, '/api/v2/repos/ccantynz-alt/Gluecron.com/tree/main?recursive=1');
  });

  it('createBranch() → POST /git/refs with refs/heads/<name>', async () => {
    received.length = 0;
    const out = await bridge.createBranch('o', 'r', 'gatetest/branch', 'abc123');
    assert.strictEqual(out.ref, 'refs/heads/gatetest/branch');
    const r = lastRequest();
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, '/api/v2/repos/o/r/git/refs');
    assert.deepStrictEqual(r.body, { ref: 'refs/heads/gatetest/branch', sha: 'abc123' });
  });

  it('createPullRequest() → POST /pulls with headBranch/baseBranch', async () => {
    received.length = 0;
    const pr = await bridge.createPullRequest('o', 'r', {
      title: 'feat: do a thing',
      body: 'details',
      head: 'gatetest/x',
      base: 'main',
    });
    assert.strictEqual(pr.number, 42);
    const r = lastRequest();
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, '/api/v2/repos/o/r/pulls');
    assert.strictEqual(r.body.headBranch, 'gatetest/x');
    assert.strictEqual(r.body.baseBranch, 'main');
    assert.strictEqual(r.body.title, 'feat: do a thing');
  });

  it('getPullRequest() → GET /pulls/:n', async () => {
    received.length = 0;
    const pr = await bridge.getPullRequest('o', 'r', 42);
    assert.strictEqual(pr.number, 42);
    const r = lastRequest();
    assert.strictEqual(r.method, 'GET');
    assert.strictEqual(r.url, '/api/v2/repos/o/r/pulls/42');
  });

  it('addPrComment() → POST /pulls/:n/comments', async () => {
    received.length = 0;
    const comment = await bridge.addPrComment('o', 'r', 42, 'hello');
    assert.ok(comment);
    const r = lastRequest();
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, '/api/v2/repos/o/r/pulls/42/comments');
    assert.deepStrictEqual(r.body, { body: 'hello' });
  });

  it('setCommitStatus() → POST /statuses/:sha with canonical state', async () => {
    received.length = 0;
    const sha = 'c'.repeat(40);
    const out = await bridge.setCommitStatus('o', 'r', sha, 'success', 'All green', {
      context: 'gatetest',
      targetUrl: 'https://gatetest.ai/runs/1',
    });
    assert.strictEqual(out.state, 'success');
    const r = lastRequest();
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, `/api/v2/repos/o/r/statuses/${sha}`);
    assert.strictEqual(r.body.state, 'success');
    assert.strictEqual(r.body.description, 'All green');
    assert.strictEqual(r.body.context, 'gatetest');
    assert.strictEqual(r.body.target_url, 'https://gatetest.ai/runs/1');
  });

  it('setCommitStatus() rejects invalid states', async () => {
    await assert.rejects(
      () => bridge.setCommitStatus('o', 'r', 'c'.repeat(40), 'succeeded', 'typo'),
      /Invalid commit status state/,
    );
  });

  it('getCommit() → GET /commits/:sha', async () => {
    received.length = 0;
    const sha = 'd'.repeat(40);
    const commit = await bridge.getCommit('o', 'r', sha);
    assert.strictEqual(commit.sha, sha);
    const r = lastRequest();
    assert.strictEqual(r.method, 'GET');
    assert.strictEqual(r.url, `/api/v2/repos/o/r/commits/${sha}`);
  });

  it('every outbound request carries Authorization: Bearer <token>', () => {
    for (const r of received) {
      assert.match(r.headers.authorization || '', /^Bearer glc_/);
    }
  });

  it('never logs the raw token via _apiError helper', () => {
    // Synthesize a failing response and verify the rendered message is safe.
    const err = bridge._apiError('setCommitStatus', { statusCode: 403, data: { message: 'forbidden' } });
    assert.match(err.message, /setCommitStatus failed/);
    assert.doesNotMatch(err.message, /glc_/);
  });
});

// ─── Integrations: TS adapter surface parity check ─────────────────────────
describe('integrations/gluecron — TS adapter surface', () => {
  const integrationsDir = path.join(__dirname, '..', 'integrations', 'gluecron');

  it('ships types.ts, client.ts, adapter.ts, index.ts, README.md', () => {
    for (const f of ['types.ts', 'client.ts', 'adapter.ts', 'index.ts', 'README.md']) {
      assert.ok(
        fs.existsSync(path.join(integrationsDir, f)),
        `integrations/gluecron/${f} should exist`,
      );
    }
  });

  it('adapter.ts mirrors the GitHub bridge method surface', () => {
    const src = fs.readFileSync(path.join(integrationsDir, 'adapter.ts'), 'utf-8');
    const required = [
      'verifyAuth',
      'healthCheck',
      'getAccessStatus',
      'getDefaultBranch',
      'createBranch',
      'listRepoFiles',
      'readFile',
      'writeFile',
      'createPullRequest',
      'getPullRequest',
      'addPrComment',
      'setCommitStatus',
      'getCommit',
      'postGateResult',
      'reportResults',
    ];
    for (const m of required) {
      assert.match(src, new RegExp(`\\b${m}\\s*\\(`), `adapter must declare ${m}(`);
    }
  });

  it('client.ts references every v2 endpoint path the adapter needs', () => {
    const src = fs.readFileSync(path.join(integrationsDir, 'client.ts'), 'utf-8');
    const expected = [
      '/api/v2/user',
      '/api/v2/repos/${enc(owner)}/${enc(repo)}',
      '/tree/${enc(ref)}?recursive=1',
      '/contents/',
      '/git/refs',
      '/pulls',
      '/statuses/',
      '/commits/',
    ];
    for (const path of expected) {
      assert.ok(src.includes(path), `client.ts must reference ${path}`);
    }
  });

  it('client.ts redacts Authorization on debug output', () => {
    const src = fs.readFileSync(path.join(integrationsDir, 'client.ts'), 'utf-8');
    assert.match(src, /redactHeaders/);
    assert.match(src, /\[REDACTED\]/);
  });

  it('README documents GLUECRON_API_URL + GLUECRON_TOKEN', () => {
    const src = fs.readFileSync(path.join(integrationsDir, 'README.md'), 'utf-8');
    assert.match(src, /GLUECRON_API_URL/);
    assert.match(src, /GLUECRON_TOKEN/);
    assert.match(src, /GIT_HOST/);
  });

  it('adapter exports a selector (shouldUseGluecron) respecting GIT_HOST', () => {
    const src = fs.readFileSync(path.join(integrationsDir, 'adapter.ts'), 'utf-8');
    assert.match(src, /shouldUseGluecron/);
    assert.match(src, /GIT_HOST/);
  });
});
