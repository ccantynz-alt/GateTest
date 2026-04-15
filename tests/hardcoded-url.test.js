const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HardcodedUrlModule = require('../src/modules/hardcoded-url');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new HardcodedUrlModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('HardcodedUrlModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no source files exist', async () => {
    write(tmp, 'notes.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'hardcoded-url:no-files'));
  });

  it('scans JS/TS sources', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'hardcoded-url:scanning'));
  });
});

describe('HardcodedUrlModule — localhost', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-local-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on http://localhost hardcoded in source', async () => {
    write(tmp, 'src/api.ts', [
      'export async function fetchUsers() {',
      '  const r = await fetch("http://localhost:3000/api/users");',
      '  return r.json();',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('hardcoded-url:localhost:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on http://127.0.0.1 hardcoded in source', async () => {
    write(tmp, 'src/api.ts', [
      'const BASE = "http://127.0.0.1:8080";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:localhost:')));
  });

  it('errors on http://0.0.0.0 hardcoded in source', async () => {
    write(tmp, 'src/api.ts', [
      'const BASE = "http://0.0.0.0:3000";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:localhost:')));
  });

  it('does NOT flag when variable name says LOCAL_URL', async () => {
    write(tmp, 'src/api.ts', [
      'const LOCAL_URL = "http://localhost:3000";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag under NODE_ENV !== production guard', async () => {
    write(tmp, 'src/api.ts', [
      'if (process.env.NODE_ENV !== "production") {',
      '  globalThis.API_BASE = "http://localhost:3000";',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('downgrades to info in test files', async () => {
    write(tmp, 'tests/a.test.ts', [
      'it("works", async () => {',
      '  const r = await fetch("http://localhost:3000");',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('hardcoded-url:localhost:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'info');
  });
});

describe('HardcodedUrlModule — private IPs', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-priv-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on 10.x.x.x RFC1918 URL', async () => {
    write(tmp, 'src/api.ts', [
      'const BACKEND = "http://10.0.1.42:5000";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:private-ip:')));
  });

  it('errors on 192.168.x.x URL', async () => {
    write(tmp, 'src/api.ts', [
      'fetch("http://192.168.1.100:8080/api");',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:private-ip:')));
  });

  it('errors on 172.16-31.x URL', async () => {
    write(tmp, 'src/api.ts', [
      'const HOST = "https://172.20.5.1:9000";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:private-ip:')));
  });

  it('does NOT flag 172.8.x.x (not in RFC1918 range)', async () => {
    write(tmp, 'src/api.ts', [
      'const HOST = "https://172.8.5.1";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('hardcoded-url:private-ip:'));
    assert.strictEqual(hit, undefined);
  });
});

describe('HardcodedUrlModule — internal TLDs / staging', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-int-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on .internal TLD', async () => {
    write(tmp, 'src/api.ts', [
      'const BACKEND = "https://api.mycompany.internal/v1";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('hardcoded-url:internal-tld:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('warns on staging.*', async () => {
    write(tmp, 'src/api.ts', [
      'const BACKEND = "https://staging.mycompany.com/api";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:internal-tld:')));
  });

  it('warns on dev.*', async () => {
    write(tmp, 'src/api.ts', [
      'fetch("https://dev.mycompany.com/api");',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('hardcoded-url:internal-tld:')));
  });
});

describe('HardcodedUrlModule — insecure scheme', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-scheme-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on plain http:// to an external host', async () => {
    write(tmp, 'src/api.ts', [
      'const r = await fetch("http://api.thirdparty.io/data");',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('hardcoded-url:insecure-scheme:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does NOT warn on https://', async () => {
    write(tmp, 'src/api.ts', [
      'fetch("https://api.stripe.com/v1/charges");',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT warn on doc-example URLs', async () => {
    write(tmp, 'src/api.ts', [
      'const EXAMPLE = "http://example.com/docs";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });
});

describe('HardcodedUrlModule — negatives', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hu-neg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag URL in comment', async () => {
    write(tmp, 'src/api.ts', [
      '// See http://localhost:3000 for dev setup',
      'export const x = 1;',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag URL in block-comment / JSDoc', async () => {
    write(tmp, 'src/api.ts', [
      '/**',
      ' * Example: http://localhost:3000/api',
      ' * See https://192.168.1.1',
      ' */',
      'export const x = 1;',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag proper env-driven URL', async () => {
    write(tmp, 'src/api.ts', [
      'const BASE = process.env.API_BASE_URL || "https://api.prod.com";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(leaks.length, 0);
  });

  it('records a summary', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'hardcoded-url:summary');
    assert.ok(s);
    assert.match(s.message, /1 file\(s\)/);
  });
});
