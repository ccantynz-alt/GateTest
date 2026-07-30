'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { probe, __test__ } = require('../src/modules/ai-guardrails/probe');

// ============================================================
// Pure-helper tests (expandEnv, expandHeaders, substitutePrompt, pluckByPath)
// ============================================================

test('expandEnv: ${VAR} placeholder expands from process.env', () => {
  process.env.GATETEST_PROBE_TEST_TOKEN = 'placeholder-not-a-real-credential';
  assert.equal(
    __test__.expandEnv('Bearer ${GATETEST_PROBE_TEST_TOKEN}'),
    'Bearer placeholder-not-a-real-credential',
  );
  delete process.env.GATETEST_PROBE_TEST_TOKEN;
});

test('expandEnv: undefined env var stays as literal placeholder', () => {
  delete process.env.GATETEST_PROBE_TEST_MISSING;
  assert.equal(
    __test__.expandEnv('Bearer ${GATETEST_PROBE_TEST_MISSING}'),
    'Bearer ${GATETEST_PROBE_TEST_MISSING}',
  );
});

test('expandEnv: non-string input passes through', () => {
  assert.equal(__test__.expandEnv(42), 42);
  assert.equal(__test__.expandEnv(null), null);
});

test('expandHeaders: applies expandEnv to every value', () => {
  process.env.GATETEST_PROBE_TEST_KEY = 'abc';
  const out = __test__.expandHeaders({
    Authorization: 'Bearer ${GATETEST_PROBE_TEST_KEY}',
    'X-Custom': 'static',
  });
  assert.equal(out.Authorization, 'Bearer abc');
  assert.equal(out['X-Custom'], 'static');
  delete process.env.GATETEST_PROBE_TEST_KEY;
});

test('expandHeaders: null / non-object → empty object', () => {
  assert.deepEqual(__test__.expandHeaders(null), {});
  assert.deepEqual(__test__.expandHeaders('foo'), {});
});

test('substitutePrompt: replaces ${prompt} in string', () => {
  assert.equal(__test__.substitutePrompt('Q: ${prompt}', 'hello'), 'Q: hello');
});

test('substitutePrompt: walks nested object tree', () => {
  const out = __test__.substitutePrompt(
    { messages: [{ role: 'user', content: '${prompt}' }] },
    'hi there',
  );
  assert.equal(out.messages[0].content, 'hi there');
});

test('substitutePrompt: leaves non-prompt strings alone', () => {
  assert.equal(__test__.substitutePrompt('static text', 'p'), 'static text');
});

test('substitutePrompt: handles arrays and mixed types', () => {
  const out = __test__.substitutePrompt(['${prompt}', 'x', { a: '${prompt}' }, 1], 'P');
  assert.deepEqual(out, ['P', 'x', { a: 'P' }, 1]);
});

test('pluckByPath: dotted path with array index', () => {
  const obj = { choices: [{ message: { content: 'hi' } }] };
  assert.equal(__test__.pluckByPath(obj, 'choices.0.message.content'), 'hi');
});

test('pluckByPath: missing path → null', () => {
  assert.equal(__test__.pluckByPath({}, 'a.b.c'), null);
});

test('pluckByPath: empty path → null', () => {
  assert.equal(__test__.pluckByPath({ a: 1 }, ''), null);
  assert.equal(__test__.pluckByPath({ a: 1 }, null), null);
});

test('pluckByPath: top-level direct key', () => {
  assert.equal(__test__.pluckByPath({ a: 'x' }, 'a'), 'x');
});

// ============================================================
// probe() against a local HTTP test server
// ============================================================

/**
 * DIAGNOSABILITY HARDENING (KI #94) — not a confirmed fix.
 *
 * This file failed ONCE under full-suite load, reported at file level
 * (`test at …:1:1`, message `test failed`) with no individual subtest failing.
 * Two hypotheses were tested and BOTH DISPROVED, recorded so nobody repeats them:
 *
 *   1. "the timeout case leaks the server handle, because server.close() does
 *      not destroy an open connection." Measured: awaited close +
 *      closeAllConnections() left exactly the same live handles as the bare
 *      close, and after 500ms both drained to zero. No leak.
 *   2. "aborting the request leaves an unhandled 'error' on the server socket,
 *      and an unhandled 'error' event throws." Measured: 60 iterations of the
 *      exact scenario produced 0 server-side socket errors, 0 uncaughtExceptions,
 *      0 unhandledRejections.
 *
 * So the cause is still unknown and the code below is deliberately NOT presented
 * as a fix. What it changes is what happens IF something does go wrong out of
 * frame: an error event on the server or a socket becomes a named, attributable
 * failure instead of a bare file-level `test failed`, and teardown is awaited so
 * a test cannot finish while its server is still closing. The whole reason this
 * was hard to chase is that the one failure carried no diagnostic.
 */
function startTestServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          handler(req, res, body);
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err && err.message));
        }
      });
      // A client that aborts mid-request (the timeout case does exactly that)
      // makes the server side emit ECONNRESET. Swallowed on purpose: it is
      // expected here, and an unhandled 'error' event would throw.
      req.on('error', () => {});
      res.on('error', () => {});
    });
    server.on('error', reject);
    server.on('connection', (sock) => { sock.on('error', () => {}); });
    server.listen(0, '127.0.0.1', () => { // hardcoded-url-ok
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` }); // hardcoded-url-ok
    });
  });
}

/**
 * Await teardown, and destroy any connection the handler never answered.
 * `server.close()` alone stops accepting NEW connections and then waits, so a
 * test whose handler deliberately never responds could return while its server
 * was still open.
 */
async function closeTestServer(server) {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
}

test('probe: end-to-end against local server returns ok + response text', async () => {
  const { server, url } = await startTestServer((req, res, body) => {
    assert.equal(req.method, 'POST');
    const parsed = JSON.parse(body);
    assert.equal(parsed.messages[0].content, 'test prompt');
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    res.end(JSON.stringify({ choices: [{ message: { content: 'I cannot help.' } }] }));
  });
  try {
    const r = await probe(
      { prompt: 'test prompt' },
      { endpoint: url },
    );
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.responseText, 'I cannot help.');
    assert.equal(r.errorCode, null);
    assert.ok(typeof r.durationMs === 'number');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: missing endpoint → ok:false + no-endpoint', async () => {
  const r = await probe({ prompt: 'x' }, {});
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'no-endpoint');
});

test('probe: HTTP 500 from server → ok:false + http-error, raw preserved', async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.statusCode = 500;
    res.end('upstream broke');
  });
  try {
    const r = await probe({ prompt: 'x' }, { endpoint: url });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
    assert.equal(r.errorCode, 'http-error');
    assert.equal(r.responseRaw, 'upstream broke');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: response-path miss → ok:false + response-path-miss', async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ something: 'else' }));
  });
  try {
    const r = await probe(
      { prompt: 'x' },
      { endpoint: url, responsePath: 'choices.0.message.content' },
    );
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, 'response-path-miss');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: non-JSON body → treated as plain-text response', async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('I refuse to answer.');
  });
  try {
    const r = await probe({ prompt: 'x' }, { endpoint: url });
    assert.equal(r.ok, true);
    assert.equal(r.responseText, 'I refuse to answer.');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: custom responsePath drills into nested structure', async () => {
  const { server, url } = await startTestServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: { reply: 'hi' } }));
  });
  try {
    const r = await probe(
      { prompt: 'x' },
      { endpoint: url, responsePath: 'data.reply' },
    );
    assert.equal(r.ok, true);
    assert.equal(r.responseText, 'hi');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: timeout → ok:false + timeout error code', async () => {
  const { server, url } = await startTestServer(() => {
    // Never respond — the handler returns without calling res.end(), so the
    // connection stays open until the probe's AbortController fires. No
    // setTimeout needed (and no flake surface).
  });
  try {
    const r = await probe(
      { prompt: 'x' },
      { endpoint: url, timeoutMs: 50 },
    );
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, 'timeout');
  } finally {
    await closeTestServer(server);
  }
});

test('probe: env-expanded Authorization header is delivered to server', async () => {
  process.env.GATETEST_PROBE_TEST_BEARER = 'placeholder-bearer-value';
  let sentAuth = null;
  const { server, url } = await startTestServer((req, res) => {
    sentAuth = req.headers['authorization'];
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  try {
    await probe(
      { prompt: 'x' },
      {
        endpoint: url,
        headers: { Authorization: 'Bearer ${GATETEST_PROBE_TEST_BEARER}' },
      },
    );
    assert.equal(sentAuth, 'Bearer placeholder-bearer-value');
  } finally {
    await closeTestServer(server);
    delete process.env.GATETEST_PROBE_TEST_BEARER;
  }
});

test('probe: custom requestTemplate is sent verbatim with ${prompt} substituted', async () => {
  let received = null;
  const { server, url } = await startTestServer((req, res, body) => {
    received = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ text: 'done' }));
  });
  try {
    await probe(
      { prompt: 'PROMPT-HERE' },
      {
        endpoint: url,
        requestTemplate: { model: 'gpt-x', input: '${prompt}', tail: 'extra' },
        responsePath: 'text',
      },
    );
    assert.deepEqual(received, { model: 'gpt-x', input: 'PROMPT-HERE', tail: 'extra' });
  } finally {
    await closeTestServer(server);
  }
});
