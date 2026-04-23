const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EnvVarsModule = require('../src/modules/env-vars');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new EnvVarsModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('EnvVarsModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('no-op when nothing to scan', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:no-env'));
  });

  it('scans when source or .env.example present', async () => {
    write(tmp, '.env.example', 'API_KEY=\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:scanning'));
  });
});

describe('EnvVarsModule — missing-from-example', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-miss-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on process.env.X without .env.example declaration', async () => {
    write(tmp, 'src/a.ts', [
      'export function run() {',
      '  return process.env.STRIPE_SECRET_KEY;',
      '}',
      '',
    ].join('\n'));
    write(tmp, '.env.example', 'PUBLIC_URL=\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name === 'env-vars:missing-from-example:STRIPE_SECRET_KEY');
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on process.env["X"] bracket form', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env["SENDGRID_API_KEY"];\n');
    write(tmp, '.env.example', '\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:missing-from-example:SENDGRID_API_KEY'));
  });

  it('does NOT flag runtime-allowlist keys (NODE_ENV, PORT, CI)', async () => {
    write(tmp, 'src/a.ts', [
      'const env = process.env.NODE_ENV;',
      'const port = process.env.PORT;',
      'const ci = process.env.CI;',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter(
      (c) => c.passed === false && c.name.startsWith('env-vars:missing-from-example:'),
    );
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag when declared in .env.example', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env.STRIPE_SECRET_KEY;\n');
    write(tmp, '.env.example', 'STRIPE_SECRET_KEY=\n');
    const r = await run(tmp);
    const leaks = r.checks.filter(
      (c) => c.passed === false && c.name === 'env-vars:missing-from-example:STRIPE_SECRET_KEY',
    );
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag when declared in GitHub Actions workflow env block', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env.DEPLOY_TOKEN;\n');
    write(tmp, '.github/workflows/ci.yml', [
      'name: ci',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    env:',
      '      DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}',
      '    steps:',
      '      - run: echo ok',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const leaks = r.checks.filter(
      (c) => c.passed === false && c.name === 'env-vars:missing-from-example:DEPLOY_TOKEN',
    );
    assert.strictEqual(leaks.length, 0);
  });

  it('does NOT flag when declared in vercel.json env', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env.DATABASE_URL;\n');
    write(tmp, 'vercel.json', JSON.stringify({ env: { DATABASE_URL: '@database-url' } }));
    const r = await run(tmp);
    const leaks = r.checks.filter(
      (c) => c.passed === false && c.name === 'env-vars:missing-from-example:DATABASE_URL',
    );
    assert.strictEqual(leaks.length, 0);
  });
});

describe('EnvVarsModule — unused-in-code', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-unused-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on .env.example key not referenced in source', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    write(tmp, '.env.example', [
      'USED_KEY=',
      'DEAD_FEATURE_FLAG=',
      '',
    ].join('\n'));
    write(tmp, 'src/b.ts', 'const k = process.env.USED_KEY;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name === 'env-vars:unused-in-code:DEAD_FEATURE_FLAG');
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does NOT warn on runtime-allowlist declared keys', async () => {
    write(tmp, '.env.example', 'NODE_ENV=\nPORT=\n');
    const r = await run(tmp);
    const leaks = r.checks.filter(
      (c) => c.passed === false && c.name.startsWith('env-vars:unused-in-code:'),
    );
    assert.strictEqual(leaks.length, 0);
  });
});

describe('EnvVarsModule — client-exposed info', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-pub-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records info for NEXT_PUBLIC_* keys', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env.NEXT_PUBLIC_STRIPE_KEY;\n');
    write(tmp, '.env.example', 'NEXT_PUBLIC_STRIPE_KEY=\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name === 'env-vars:client-exposed:NEXT_PUBLIC_STRIPE_KEY');
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'info');
  });

  it('records info for VITE_* keys', async () => {
    write(tmp, 'src/a.ts', 'const k = process.env.VITE_API_URL;\n');
    write(tmp, '.env.example', 'VITE_API_URL=\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:client-exposed:VITE_API_URL'));
  });
});

describe('EnvVarsModule — multi-language', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-lang-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('finds Python os.environ / os.getenv references', async () => {
    write(tmp, 'app.py', [
      'import os',
      'db = os.environ["DATABASE_URL"]',
      'key = os.getenv("SECRET_TOKEN")',
      '',
    ].join('\n'));
    write(tmp, '.env.example', 'DATABASE_URL=\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:missing-from-example:SECRET_TOKEN'));
  });

  it('finds Go os.Getenv references', async () => {
    write(tmp, 'main.go', [
      'package main',
      'import "os"',
      'func main() {',
      '  _ = os.Getenv("REDIS_URL")',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'env-vars:missing-from-example:REDIS_URL'));
  });
});

describe('EnvVarsModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, '.env.example', 'FOO=\n');
    write(tmp, 'src/a.ts', 'const k = process.env.FOO;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'env-vars:summary');
    assert.ok(s);
    assert.match(s.message, /declared=\d+/);
  });
});
