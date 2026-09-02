// =============================================================================
// WORDPRESS — a clean bill of health requires having looked
// =============================================================================
// The WordPress suite had never been run against a WordPress site. The first
// time it was (2026-09-02, against a local fixture we own — these modules probe
// for exposed backups and enumerate users, so the target must be one's own),
// wpVersionLeak reported:
//
//     "wpVersionLeak: no version leaks detected across 5 known vectors. Good."
//
// on a site leaking its version FOUR ways: <meta name="generator">,
// /readme.html, the RSS <generator> element, and ?ver= on assets.
//
// Cause: `const fetchFn = moduleConfig.fetchFn || this._defaultFetch;` extracts
// the method bare, losing `this`. `_defaultFetch` calls `this._readUpTo(...)`,
// which threw on every probe — and each probe's catch emitted a PASSED,
// info-severity check. Five failures rendered as a clean site.
//
// Two defects, and the second is the dangerous one:
//   1. the unbound method (nine WP modules had the pattern; only this one
//      broke, because only its _defaultFetch calls `this`);
//   2. the reporting — ANY unreachable host, timeout or TLS failure would have
//      produced the same false reassurance. "We looked and found nothing" and
//      "we could not look" must never render as the same sentence.
//
// These tests use a REAL local server rather than injecting `fetchFn`, because
// injecting it bypasses the exact line that was broken.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const WpVersionLeak = require('../src/modules/wp-version-leak');

const WP_VERSION = '5.8.1';

/** A site that leaks its version four ways. */
function leakyHandler(req, res) {
  const p = (req.url || '/').split('?')[0];
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><head><meta name="generator" content="WordPress ${WP_VERSION}">`
      + `</head><body>hi</body></html>`);
  }
  if (p === '/readme.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><body><h1>WordPress</h1><p>Version ${WP_VERSION}</p></body></html>`);
  }
  if (p === '/feed/' || p === '/feed') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    return res.end(`<rss><channel><generator>https://wordpress.org/?v=${WP_VERSION}`
      + `</generator></channel></rss>`);
  }
  res.writeHead(404); return res.end('nope');
}

/** A hardened site: homepage only, everything else 404. */
function hardenedHandler(req, res) {
  const p = (req.url || '/').split('?')[0];
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<html><head><title>Site</title></head><body>hi</body></html>');
  }
  res.writeHead(404); return res.end('nope');
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function run(targetUrl) {
  const checks = [];
  const result = {
    checks,
    addCheck(id, passed, meta) { checks.push({ id, name: id, passed, ...(meta || {}) }); },
    addInfo() {},
  };
  await new WpVersionLeak().run(result, {
    projectRoot: process.cwd(),
    targetUrl,
    wpVersionLeak: { timeoutMs: 3000 },
  });
  return {
    findings: checks.filter((c) => !c.passed),
    summary: (checks.find((c) => c.id.endsWith(':summary')) || {}).message || '',
    probeErrors: checks.filter((c) => /probe-error|homepage-fetch/.test(c.id)),
  };
}

describe('wpVersionLeak — detects a leaking site', () => {
  let srv, url;
  before(async () => { srv = await listen(leakyHandler); url = `http://127.0.0.1:${srv.address().port}`; });
  after(() => srv && srv.close());

  it('finds the version and reports leak vectors', async () => {
    const r = await run(url);
    assert.ok(r.findings.length > 0, `no findings on a site leaking ${WP_VERSION} four ways`);
    assert.match(r.summary, new RegExp(`detected WordPress ${WP_VERSION.replace(/\./g, '\\.')}`));
  });

  it('completes its probes — no unbound-method errors', async () => {
    // The regression itself. Every probe threw before the fix.
    const r = await run(url);
    assert.deepStrictEqual(
      r.probeErrors.map((c) => c.message), [],
      'a probe failed to complete — check the fetchFn binding',
    );
  });

  it('names the meta-generator vector specifically', async () => {
    const r = await run(url);
    assert.ok(r.findings.some((f) => /meta-generator/.test(f.id)));
  });
});

describe('wpVersionLeak — an unreachable site is NOT a clean result', () => {
  it('says NOT CHECKED rather than "Good"', async () => {
    // Nothing is listening on this port. Before the fix this produced
    // "no version leaks detected ... Good." — a clean bill of health from a
    // scanner that never completed a request.
    const r = await run('http://127.0.0.1:59997');
    assert.match(r.summary, /NOT CHECKED/, `unreachable host reported as: ${r.summary}`);
    assert.ok(
      !/Good\./.test(r.summary),
      'an unreachable site must never be described as clean',
    );
  });
});

describe('wpVersionLeak — a genuinely clean site still passes', () => {
  let srv, url;
  before(async () => { srv = await listen(hardenedHandler); url = `http://127.0.0.1:${srv.address().port}`; });
  after(() => srv && srv.close());

  it('reports Good when it looked and found nothing', async () => {
    // The load-bearing negative. Without it, "never say Good" would satisfy
    // the test above while making a clean verdict impossible.
    const r = await run(url);
    assert.deepStrictEqual(r.findings.map((f) => f.id), []);
    assert.match(r.summary, /no version leaks detected/);
    assert.ok(!/NOT CHECKED|partial result/.test(r.summary), `hardened site got: ${r.summary}`);
  });
});

describe('wp modules — fetchFn is bound', () => {
  // Eight other WP modules carried the identical unbound pattern and survived
  // only because their _defaultFetch happened not to call `this`. One added
  // `this.` call would break them the same silent way.
  const fs = require('fs');
  const path = require('path');

  it('no WP module extracts _defaultFetch unbound', () => {
    const dir = path.join(__dirname, '..', 'src', 'modules');
    const offenders = fs.readdirSync(dir)
      .filter((f) => /^wp-.*\.js$/.test(f))
      .filter((f) => /\|\|\s*this\._defaultFetch\s*;/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepStrictEqual(
      offenders, [],
      'these extract the method bare, losing `this`: ' + offenders.join(', '),
    );
  });
});
