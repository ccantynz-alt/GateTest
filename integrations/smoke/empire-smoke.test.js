/**
 * Unit tests for integrations/smoke/empire-smoke.js
 *
 * Run with: node --test integrations/smoke/empire-smoke.test.js
 *
 * All network primitives (fetch, DNS resolve, TLS connect) are injected as
 * mocks; these tests never touch the network.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { runEmpireSmoke } = require('./empire-smoke');

/**
 * Build a mock fetch that dispatches on URL prefix. Responses are plain
 * objects shaped like the subset of the Fetch Response contract our probes
 * actually consume.
 */
function makeFetch(responses) {
  return async (url) => {
    for (const [prefix, builder] of Object.entries(responses)) {
      if (url.startsWith(prefix)) {
        return builder();
      }
    }
    throw new Error(`mock fetch: no handler for ${url}`);
  };
}

function okText(body, { httpVersion = '2.0' } = {}) {
  return {
    status: 200,
    httpVersion,
    text: async () => body,
    headers: { get: () => null },
  };
}

function okJson(obj) {
  return {
    status: 200,
    httpVersion: '2.0',
    json: async () => obj,
    headers: { get: () => null },
  };
}

function status(code) {
  return {
    status: code,
    httpVersion: '2.0',
    text: async () => '',
    json: async () => ({}),
    headers: { get: () => null },
  };
}

// A resolve() that always succeeds (apex DNS exists).
const resolveOk = async () => ['1.2.3.4'];

// A resolve() that simulates NXDOMAIN.
const resolveNxdomain = async () => {
  const err = new Error('ENOTFOUND gluecron.com');
  err.code = 'ENOTFOUND';
  throw err;
};

// Build a TLS mock that reports a cert expiring N days from now.
function tlsConnectInDays(days) {
  return async () => {
    const notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return { valid_to: notAfter.toUTCString() };
  };
}

test('all probes pass -> green', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('<html>Welcome to Crontech</html>'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    'https://gluecron.com/': () => okText('hello apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(90),
  });

  assert.equal(report.status, 'green');
  assert.equal(report.probes.length, 5);
  for (const p of report.probes) {
    assert.equal(p.status, 'pass', `${p.name}: ${p.detail}`);
    assert.equal(typeof p.latency_ms, 'number');
  }
  assert.match(report.markdown, /GREEN/);
});

test('gluecron subdomain 502 -> yellow (service down but Caddy up)', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('Crontech'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => status(502),
    'https://gluecron.com/': () => okText('apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(90),
  });

  assert.equal(report.status, 'yellow');
  const sub = report.probes.find((p) => p.name === 'gluecron-sub');
  assert.equal(sub.status, 'warn');
  assert.match(sub.detail, /service down but Caddy up/);
});

test('api health fails -> red', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('Crontech'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: false, reason: 'db down' }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    'https://gluecron.com/': () => okText('apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(90),
  });

  assert.equal(report.status, 'red');
  const api = report.probes.find((p) => p.name === 'api-health');
  assert.equal(api.status, 'fail');
});

test('gluecron apex NXDOMAIN -> skip (soft info), overall still green', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('Crontech'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    // gluecron.com should never be fetched because DNS resolution fails first.
    'https://gluecron.com/': () => {
      throw new Error('fetch should not be called on NXDOMAIN');
    },
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveNxdomain,
    tlsConnect: tlsConnectInDays(90),
  });

  const apex = report.probes.find((p) => p.name === 'gluecron-apex');
  assert.equal(apex.status, 'skip');
  assert.match(apex.detail, /DNS not yet configured/);
  // skips do not degrade status
  assert.equal(report.status, 'green');
});

test('cert expiring in 7 days -> warn -> yellow', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('Crontech'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    'https://gluecron.com/': () => okText('apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(7),
  });

  const cert = report.probes.find((p) => p.name === 'cert-crontech');
  assert.equal(cert.status, 'warn');
  assert.match(cert.detail, /expires in \d+d/);
  assert.equal(report.status, 'yellow');
});

test('missing "Crontech" in body -> fail -> red', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('<html>Under construction</html>'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    'https://gluecron.com/': () => okText('apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(90),
  });

  const home = report.probes.find((p) => p.name === 'crontech-home');
  assert.equal(home.status, 'fail');
  assert.equal(report.status, 'red');
});

test('markdown report shape includes table header and all probes', async () => {
  const fetchMock = makeFetch({
    'https://crontech.ai/': () => okText('Crontech'),
    'https://api.crontech.ai/api/health': () => okJson({ ok: true }),
    'https://gluecron.crontech.ai/': () => okText('hello'),
    'https://gluecron.com/': () => okText('apex'),
  });

  const report = await runEmpireSmoke({
    fetch: fetchMock,
    resolve: resolveOk,
    tlsConnect: tlsConnectInDays(90),
  });

  assert.match(report.markdown, /\| Probe \| Status \| Latency \| Detail \|/);
  for (const name of ['crontech-home', 'api-health', 'gluecron-sub', 'gluecron-apex', 'cert-crontech']) {
    assert.ok(report.markdown.includes(name), `markdown missing row for ${name}`);
  }
  assert.ok(report.timestamp);
});
