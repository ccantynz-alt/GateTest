const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SSRFModule = require('../src/modules/ssrf');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new SSRFModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('SSRFModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no source files exist', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'ssrf:no-files'));
  });

  it('scans JS/TS sources', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'ssrf:scanning'));
  });
});

describe('SSRFModule — tainted URLs', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-taint-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on fetch(req.body.url)', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const r = await fetch(req.body.url);',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:'));
    assert.ok(hit, `expected tainted-url, got: ${JSON.stringify(r.checks.map((c) => c.name))}`);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on axios.get(req.query.target)', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const data = await axios.get(req.query.target);',
      '  res.json(data);',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:')));
  });

  it('errors on tainted variable assigned from req.body', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const userUrl = req.body.url;',
      '  const r = await fetch(userUrl);',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on destructured request body', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const { url } = req.body;',
      '  const r = await fetch(url);',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:')));
  });

  it('does NOT flag when validateUrl is called before fetch', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const userUrl = req.body.url;',
      '  validateUrl(userUrl);',
      '  const r = await fetch(userUrl);',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const taint = r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:'));
    assert.strictEqual(taint, undefined);
  });

  it('does NOT flag when hostname is checked against allowlist', async () => {
    write(tmp, 'src/h.ts', [
      'async function handler(req, res) {',
      '  const userUrl = req.body.url;',
      '  const parsed = new URL(userUrl);',
      '  if (!allowedHosts.includes(parsed.hostname)) throw new Error("bad host");',
      '  const r = await fetch(userUrl);',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const taint = r.checks.find((c) => c.name.startsWith('ssrf:tainted-url:'));
    assert.strictEqual(taint, undefined);
  });
});

describe('SSRFModule — metadata endpoints', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-meta-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on AWS metadata IP', async () => {
    write(tmp, 'src/h.ts', [
      'async function leak() {',
      '  const r = await fetch("http://169.254.169.254/latest/meta-data/iam/security-credentials/");',
      '  return r.text();',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:metadata-endpoint:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on GCP metadata hostname', async () => {
    write(tmp, 'src/h.ts', [
      'async function leak() {',
      '  return fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token");',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('ssrf:metadata-endpoint:')));
  });

  it('errors on Alibaba metadata IP', async () => {
    write(tmp, 'src/h.ts', [
      'fetch("http://100.100.100.200/latest/meta-data/");',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('ssrf:metadata-endpoint:')));
  });
});

describe('SSRFModule — suspicious-named vars', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-sus-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on fetch(webhookUrl) without validation', async () => {
    write(tmp, 'src/h.ts', [
      'async function send(webhookUrl, payload) {',
      '  const r = await fetch(webhookUrl, { method: "POST", body: JSON.stringify(payload) });',
      '  return r.status;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:unvalidated-url-var:'));
    assert.ok(hit, `expected unvalidated-url-var hit, got: ${JSON.stringify(r.checks.map((c) => c.name))}`);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does NOT warn when isValidUrl guards the call', async () => {
    write(tmp, 'src/h.ts', [
      'async function send(webhookUrl, payload) {',
      '  if (!isValidUrl(webhookUrl)) throw new Error("bad url");',
      '  const r = await fetch(webhookUrl, { method: "POST" });',
      '  return r.status;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:unvalidated-url-var:'));
    assert.strictEqual(hit, undefined);
  });
});

describe('SSRFModule — library-ok', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-lib-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records info when ssrf-req-filter is imported', async () => {
    write(tmp, 'src/h.ts', [
      'const ssrfFilter = require("ssrf-req-filter");',
      'async function handler(req, res) {',
      '  const r = await fetch(req.body.url, { agent: ssrfFilter() });',
      '  res.send(await r.text());',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const lib = r.checks.find((c) => c.name.startsWith('ssrf:library-ok:'));
    assert.ok(lib);
    assert.strictEqual(lib.severity, 'info');
  });

  it('records info when request-filtering-agent is imported via ES module', async () => {
    write(tmp, 'src/h.ts', [
      'import { useAgent } from "request-filtering-agent";',
      'export async function safe(url) {',
      '  return fetch(url, { agent: useAgent(url) });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('ssrf:library-ok:')));
  });
});

describe('SSRFModule — negatives', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-neg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag fetch with hardcoded external URL', async () => {
    write(tmp, 'src/h.ts', [
      'async function external() {',
      '  const r = await fetch("https://api.stripe.com/v1/charges");',
      '  return r.json();',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag fetch with a config-derived URL', async () => {
    write(tmp, 'src/h.ts', [
      'async function internal() {',
      '  const apiBase = process.env.API_BASE;',
      '  const r = await fetch(`${apiBase}/users`);',
      '  return r.json();',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('downgrades severity to info inside test files', async () => {
    write(tmp, 'tests/a.test.ts', [
      'it("hits aws", () => {',
      '  fetch("http://169.254.169.254/");',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('ssrf:metadata-endpoint:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'info');
  });
});

describe('SSRFModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ssrf-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'ssrf:summary');
    assert.ok(s);
    assert.match(s.message, /1 file\(s\)/);
  });
});
