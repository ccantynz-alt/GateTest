/**
 * Five WordPress security modules called a failed probe a clean result.
 *
 * 6e0c008 (2026-09-02) fixed wpVersionLeak, which had told a site owner
 * "no version leaks detected across 5 known vectors. Good." while leaking its
 * version four ways. That commit had two halves — the unbound `_defaultFetch`,
 * and the REPORTING that turned five thrown probes into a clean bill. The
 * binding half landed on nine modules. The reporting half landed on one.
 *
 * Measured 2026-09-04 against 127.0.0.1:9 (nothing listening), the other nine
 * still said:
 *
 *   wpUserEnumerate    "no username leaks detected via the 3 known vectors. Good."
 *   wpXmlrpcExposed    "/xmlrpc.php appears to be disabled or blocked (GET=0, POST=0). Good."
 *   wpExposedFiles     "probed 26 known-bad paths ...; 0 exposure(s) found"   <- never probed one
 *   wpAdminProtection  "login=0, admin=0, 0 hardening gap(s) found."
 *   wpBackupValidation a BLOCKING warning, "no backup plugin detected on the site"
 *                      — a finding manufactured out of a failed fetch.
 *
 * Every one of those is the sentence a genuinely healthy site gets.
 *
 * Three controls per module, against a REAL local HTTP server rather than an
 * injected fetchFn — injecting one bypasses the exact line that was broken in
 * wpVersionLeak, and the two `_defaultProbe` extractions guarded below are
 * still unbound in the same way:
 *   1. exposed fixture   -> the module still finds the real problem
 *   2. unreachable host  -> NOT CHECKED, and no reassuring sentence
 *   3. hardened fixture  -> still says clean, in the original words
 *
 * POSITIVE CONTROL: revert any module's summary block and its "unreachable"
 * test fails with the old reassuring string.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const WpUserEnumerate = require('../src/modules/wp-user-enumerate');
const WpXmlrpcExposed = require('../src/modules/wp-xmlrpc-exposed');
const WpExposedFiles = require('../src/modules/wp-exposed-files');
const WpAdminProtection = require('../src/modules/wp-admin-protection');
const WpBackupValidation = require('../src/modules/wp-backup-validation');

// Port 9 (discard) with nothing bound: connections are refused immediately, so
// every probe throws for a reason a customer's scan really hits (DNS failure,
// dead host, TLS error, WAF drop).
const UNREACHABLE = 'http://127.0.0.1:9';

const EXPOSED_HTML = [
  '<html><head>',
  '<link rel="stylesheet" href="/wp-content/plugins/updraftplus/css/main.css?ver=1.2">',
  '</head><body>hello</body></html>',
].join('');

const HARDENED_HTML = '<html><head><title>site</title></head><body>hello</body></html>';

/** A WordPress-ish site that leaks everything these modules look for. */
function exposedHandler(req, res) {
  const url = req.url.split('?')[0];
  if (url === '/' ) return send(res, 200, EXPOSED_HTML, 'text/html');
  if (url === '/wp-json/wp/v2/users') {
    return send(res, 200, JSON.stringify([{ slug: 'admin', name: 'admin' }]), 'application/json');
  }
  if (url.startsWith('/author/')) return send(res, 200, '<html>author archive</html>', 'text/html');
  if (url === '/xmlrpc.php') {
    if (req.method === 'POST') {
      return send(res, 200, '<methodResponse><params><param><value><array><data>'
        + '<value><string>pingback.ping</string></value>'
        + '</data></array></value></param></params></methodResponse>', 'text/xml');
    }
    return send(res, 200, 'XML-RPC server accepts POST requests only.', 'text/plain');
  }
  if (url === '/wp-login.php') return send(res, 200, '<form id="loginform">Lost your password</form>', 'text/html');
  if (url === '/wp-admin/') return send(res, 200, '<html>dashboard</html>', 'text/html');
  // Every known-bad path is served — exposed backups, .env, .git, debug logs.
  return send(res, 200, 'leaked', 'text/plain');
}

/** The same site, locked down: homepage only, everything else 404. */
function hardenedHandler(req, res) {
  const url = req.url.split('?')[0];
  if (url === '/') return send(res, 200, HARDENED_HTML, 'text/html');
  if (url === '/wp-login.php') {
    res.setHeader('cf-ray', '7a1b2c3d4e5f6789-AKL');
    res.setHeader('set-cookie', 'wordpress_test_cookie=WP; HttpOnly; Secure');
    return send(res, 200, '<form id="loginform">Lost your password</form>WP 2FA', 'text/html');
  }
  return send(res, 404, 'Not Found', 'text/plain');
}

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, meta = {}) { this.checks.push({ name, passed, ...meta }); },
  };
}

/** Run one module against one base URL; return its checks. */
async function scan(ModuleClass, key, url) {
  const result = makeResult();
  const moduleConfig = { url, timeoutMs: 3000 };
  await new ModuleClass().run(result, {
    projectRoot: __dirname,          // no WP files here, so filesystem mode finds nothing
    targetUrl: url,
    [key]: moduleConfig,
    get: () => undefined,
    getModuleConfig: () => moduleConfig,
  });
  return result.checks;
}

const messagesOf = (checks) => checks.map((c) => c.message || '').join('\n');
const summaryOf = (checks, name) => (checks.find((c) => c.name === name) || {}).message || '';
const blockingOf = (checks) => checks.filter((c) => c.passed === false);

describe('WP probes — a failed probe is not a clean result', () => {
  let exposed;
  let hardened;
  let exposedUrl;
  let hardenedUrl;

  before(async () => {
    exposed = await listen(exposedHandler);
    hardened = await listen(hardenedHandler);
    exposedUrl = `http://127.0.0.1:${exposed.address().port}`;
    hardenedUrl = `http://127.0.0.1:${hardened.address().port}`;
  });

  after(() => { exposed.close(); hardened.close(); });

  // ── wpUserEnumerate ────────────────────────────────────────────────────
  it('wpUserEnumerate finds real leaks, says NOT CHECKED when unreachable, still says Good when clean', async () => {
    const leaky = await scan(WpUserEnumerate, 'wpUserEnumerate', exposedUrl);
    assert.ok(blockingOf(leaky).length > 0, 'the exposed fixture leaks usernames three ways');
    assert.match(messagesOf(leaky), /username-leak vector\(s\) active/);

    const dead = await scan(WpUserEnumerate, 'wpUserEnumerate', UNREACHABLE);
    const deadSummary = summaryOf(dead, 'wp-user-enum:summary');
    assert.doesNotMatch(
      deadSummary, /Good\./,
      'told a site owner their usernames were safe over five probes that threw'
    );
    assert.doesNotMatch(deadSummary, /no username leaks detected via the 3 known vectors/);
    assert.match(deadSummary, /NOT CHECKED/);
    assert.match(deadSummary, /not a clean result/);

    const clean = await scan(WpUserEnumerate, 'wpUserEnumerate', hardenedUrl);
    assert.match(summaryOf(clean, 'wp-user-enum:summary'), /Good\./);
    assert.equal(blockingOf(clean).length, 0);
  });

  // ── wpXmlrpcExposed ────────────────────────────────────────────────────
  it('wpXmlrpcExposed finds an open reflector, says NOT CHECKED when unreachable, still clean when blocked', async () => {
    const open = await scan(WpXmlrpcExposed, 'wpXmlrpcExposed', exposedUrl);
    assert.ok(blockingOf(open).length > 0, 'pingback.ping is advertised on the exposed fixture');
    assert.match(messagesOf(open), /pingback/i);

    const dead = await scan(WpXmlrpcExposed, 'wpXmlrpcExposed', UNREACHABLE);
    const deadMessages = messagesOf(dead);
    assert.doesNotMatch(
      deadMessages, /appears to be disabled or blocked/,
      'GET=0/POST=0 means both probes threw, not that xmlrpc.php is off'
    );
    assert.doesNotMatch(deadMessages, /Good\./);
    assert.match(deadMessages, /NOT CHECKED/);
    assert.ok(dead.some((c) => c.name === 'wp-xmlrpc:not-checked'));

    const blocked = await scan(WpXmlrpcExposed, 'wpXmlrpcExposed', hardenedUrl);
    assert.match(summaryOf(blocked, 'wp-xmlrpc:not-exposed'), /disabled or blocked.*Good\./);
    assert.equal(blockingOf(blocked).length, 0);
  });

  // ── wpExposedFiles ─────────────────────────────────────────────────────
  it('wpExposedFiles counts only paths it actually probed', async () => {
    const leaky = await scan(WpExposedFiles, 'wpExposedFiles', exposedUrl);
    const leakySummary = summaryOf(leaky, 'wp-exposed-files:summary');
    assert.match(leakySummary, /exposure\(s\) found/);
    assert.ok(blockingOf(leaky).length > 0, 'every known-bad path is served by the exposed fixture');

    const dead = await scan(WpExposedFiles, 'wpExposedFiles', UNREACHABLE);
    const deadSummary = summaryOf(dead, 'wp-exposed-files:summary');
    assert.doesNotMatch(
      deadSummary, /^wpExposedFiles: probed \d+ known-bad paths/,
      'claimed a probe count for work that never happened'
    );
    assert.doesNotMatch(deadSummary, /0 exposure\(s\) found/);
    assert.match(deadSummary, /NOT CHECKED/);
    assert.match(deadSummary, /all 26 probes/);

    const clean = await scan(WpExposedFiles, 'wpExposedFiles', hardenedUrl);
    const cleanSummary = summaryOf(clean, 'wp-exposed-files:summary');
    assert.match(cleanSummary, /probed 26 known-bad paths/);
    assert.match(cleanSummary, /0 exposure\(s\) found/);
    assert.doesNotMatch(cleanSummary, /partial result/);
  });

  // ── wpAdminProtection ──────────────────────────────────────────────────
  it('wpAdminProtection does not report "0 hardening gaps" over probes that threw', async () => {
    const open = await scan(WpAdminProtection, 'wpAdminProtection', exposedUrl);
    assert.ok(blockingOf(open).length > 0, 'unhardened login + reachable /wp-admin/');

    const dead = await scan(WpAdminProtection, 'wpAdminProtection', UNREACHABLE);
    const deadSummary = summaryOf(dead, 'wp-admin-protection:summary');
    assert.doesNotMatch(
      deadSummary, /0 hardening gap\(s\) found\.$/,
      'the same sentence a genuinely hardened site gets'
    );
    assert.match(deadSummary, /NOT CHECKED/);
    assert.match(deadSummary, /not a clean result/);

    const clean = await scan(WpAdminProtection, 'wpAdminProtection', hardenedUrl);
    const cleanSummary = summaryOf(clean, 'wp-admin-protection:summary');
    assert.match(cleanSummary, /hardening gap\(s\) found\./);
    assert.doesNotMatch(cleanSummary, /NOT CHECKED/);
    assert.doesNotMatch(cleanSummary, /partial result/);
  });

  // ── wpBackupValidation ─────────────────────────────────────────────────
  it('wpBackupValidation does not manufacture a blocking warning from a failed fetch', async () => {
    const dead = await scan(WpBackupValidation, 'wpBackupValidation', UNREACHABLE);
    const blocking = blockingOf(dead);
    assert.deepEqual(
      blocking.map((c) => c.name), [],
      'raised "no backup plugin detected on the site" having never read the site'
    );
    assert.doesNotMatch(messagesOf(dead), /no backup plugin detected on the site/);
    assert.match(summaryOf(dead, 'wp-backup:summary'), /NOT CHECKED/);
    assert.ok(dead.some((c) => c.name === 'wp-backup:not-checked'));

    // The warning is REAL when we actually read the homepage and saw no plugin.
    const reachableNoPlugin = await scan(WpBackupValidation, 'wpBackupValidation', hardenedUrl);
    assert.ok(
      reachableNoPlugin.some((c) => c.name === 'wp-backup:no-plugin-detected' && c.passed === false),
      'a reachable site with no backup plugin must still warn — the fix must not mute a true finding'
    );

    // ...and a detected plugin is still detected.
    const withPlugin = await scan(WpBackupValidation, 'wpBackupValidation', exposedUrl);
    assert.ok(withPlugin.some((c) => c.name === 'wp-backup:plugin-detected'));
  });
});

describe('WP probes — the binding landmine that caused this', () => {
  // 6e0c008 added a guard for `|| this._defaultFetch;` by NAME, so the two
  // `|| this._defaultProbe;` extractions sailed through it. Matching any
  // `this._default*` closes that gap for the next method someone adds.
  it('no WP module extracts a _default* helper unbound', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'src', 'modules');
    const offenders = fs.readdirSync(dir)
      .filter((f) => f.startsWith('wp-') && f.endsWith('.js'))
      .filter((f) => /\|\|\s*this\._default\w*\s*;/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    assert.deepEqual(
      offenders, [],
      'a bare method reference loses `this`; every probe then throws and each catch emits a passed check'
    );
  });
});
