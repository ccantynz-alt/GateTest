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

// ── the one stripper (2026-09-05, Doctrine §4): the private per-line quote
// counter this module carried could not see a template continuation line or a
// block comment that opened earlier, and read comment text as code ──
describe('EnvVarsModule — reads are matched on the masked line', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-strip-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a process.env read inside a string, a template or a comment is not a read; the real ones beside them are — dot and bracket form (2026-09-05)', async () => {
    write(tmp, 'src/a.ts', [
      'const advice = "set process.env.QUOTED_KEY before boot";', // 1 string
      'const tpl = `',                                             // 2
      '  export DEFAULT=${process.env.HOLE_KEY} # process.env.TEMPLATE_KEY', // 3: the hole is code, the rest is template text
      '`;',                                                        // 4
      '/* migration notes:',                                       // 5
      '   we used to read process.env.COMMENT_KEY here',           // 6 block comment
      ' */',                                                       // 7
      'const real = process.env.REAL_KEY;',                        // 8 real, dot form
      'const bracket = process.env["BRACKET_KEY"];',               // 9 real, bracket form — the key is string content
    ].join('\n'));
    write(tmp, '.env.example', '\n');
    const r = await run(tmp);
    const missing = r.checks
      .filter((c) => c.passed === false && c.name.startsWith('env-vars:missing-from-example:'))
      .map((c) => `${c.name}@${c.line}`)
      .sort();
    assert.deepStrictEqual(missing, [
      'env-vars:missing-from-example:BRACKET_KEY@9',
      'env-vars:missing-from-example:HOLE_KEY@3',
      'env-vars:missing-from-example:REAL_KEY@8',
    ]);
  });
});

describe('EnvVarsModule — a key set in a child process env block is a use of the key (2026-09-05)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ev-child-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('CHILD_KEY passed to spawn is referenced; PLAIN_KEY in an ordinary object and NEVER_KEY are unused', async () => {
    write(tmp, 'src/a.js', [
      'const labels = { PLAIN_KEY: "x" };',
      'spawn(process.execPath, [worker], {',
      '  env: {',
      '    ...process.env,',
      '    CHILD_KEY: JSON.stringify(task),',
      '    QUOTED_KEY: "not a key: OTHER_KEY: 1",',
      '    NODE_OPTIONS: "",',
      '  },',
      '});',
      'const after = { LATE_KEY: 1 };',
      '',
    ].join('\n'));
    write(tmp, '.env.example', 'CHILD_KEY=\nQUOTED_KEY=\nOTHER_KEY=\nPLAIN_KEY=\nLATE_KEY=\nNEVER_KEY=\n');
    const r = await run(tmp);
    const unused = r.checks
      .filter((c) => c.passed === false && c.name.startsWith('env-vars:unused-in-code:'))
      .map((c) => c.name.replace('env-vars:unused-in-code:', ''))
      .sort();
    assert.deepStrictEqual(unused, ['LATE_KEY', 'NEVER_KEY', 'OTHER_KEY', 'PLAIN_KEY']);
  });

  it('a key only SET for a child is not missing from .env.example; a key READ beside it is', async () => {
    write(tmp, 'src/a.js', [
      'const worker = process.env.WORKER_PATH;',
      'spawn(process.execPath, [worker], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });',
      '',
    ].join('\n'));
    write(tmp, '.env.example', 'OTHER=\n');
    const r = await run(tmp);
    const missing = r.checks
      .filter((c) => c.passed === false && c.name.startsWith('env-vars:missing-from-example:'))
      .map((c) => c.name.replace('env-vars:missing-from-example:', ''));
    assert.deepStrictEqual(missing, ['WORKER_PATH']);
  });
});
