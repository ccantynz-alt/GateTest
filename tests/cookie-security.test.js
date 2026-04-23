const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CookieSecurityModule = require('../src/modules/cookie-security');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new CookieSecurityModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('CookieSecurityModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('no-op when nothing to scan', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'cookie-sec:no-files'));
  });

  it('summary when files are scanned', async () => {
    write(tmp, 'src/a.ts', 'const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'cookie-sec:summary'));
  });
});

describe('CookieSecurityModule — JS httpOnly:false', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-ho-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on httpOnly: false', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ httpOnly: false }));\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-httponly-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does not flag httpOnly: true', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ httpOnly: true }));\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — JS secure:false', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-sec-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on secure: false', async () => {
    write(tmp, 'src/a.js', 'res.cookie("sid", v, { secure: false });\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-secure-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does not flag secure: true', async () => {
    write(tmp, 'src/a.js', 'res.cookie("sid", v, { secure: true });\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — JS weak-secret', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-ws-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on secret: "changeme"', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ secret: "changeme" }));\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-weak-secret:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.strictEqual(hit.value, 'changeme');
  });

  it('errors on secret: "keyboard cat"', async () => {
    write(tmp, 'src/a.js', "app.use(session({ secret: 'keyboard cat' }));\n");
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-weak-secret:')));
  });

  it('errors on secret: "your-secret-here"', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ secret: "your-secret-here" }));\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-weak-secret:')));
  });

  it('does not flag a strong-looking secret', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ secret: "k8sJd2hf9sJk2hFjSkdh2fkSdjhf" }));\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — Python SESSION_COOKIE_*', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-py-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on SESSION_COOKIE_SECURE = False', async () => {
    write(tmp, 'src/settings.py', 'SESSION_COOKIE_SECURE = False\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-cookie-secure-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('errors on SESSION_COOKIE_HTTPONLY = False', async () => {
    write(tmp, 'src/settings.py', 'SESSION_COOKIE_HTTPONLY = False\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-cookie-httponly-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('warns on CSRF_COOKIE_SECURE = False', async () => {
    write(tmp, 'src/settings.py', 'CSRF_COOKIE_SECURE = False\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-cookie-secure-false:')));
  });

  it('errors on CSRF_COOKIE_HTTPONLY = False', async () => {
    write(tmp, 'src/settings.py', 'CSRF_COOKIE_HTTPONLY = False\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-cookie-httponly-false:')));
  });

  it('does not flag SESSION_COOKIE_SECURE = True', async () => {
    write(tmp, 'src/settings.py', 'SESSION_COOKIE_SECURE = True\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — Python httponly=False kwarg', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-pykw-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on response.set_cookie(..., httponly=False)', async () => {
    write(tmp, 'src/a.py', 'response.set_cookie("sid", v, httponly=False)\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-fastapi-httponly-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does not flag httponly=True', async () => {
    write(tmp, 'src/a.py', 'response.set_cookie("sid", v, httponly=True)\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — suppressions', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-sup-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('honours // cookie-ok on same line (JS)', async () => {
    write(tmp, 'src/a.js', 'app.use(session({ httpOnly: false })); // cookie-ok — dev only\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('honours # cookie-ok on same line (Python)', async () => {
    write(tmp, 'src/settings.py', 'SESSION_COOKIE_SECURE = False  # cookie-ok — local dev\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — string-content skip', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-str-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does not flag httpOnly:false inside a doc string', async () => {
    write(tmp, 'src/a.js', 'const msg = "never set httpOnly: false";\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('cookie-sec:js-httponly-false:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('CookieSecurityModule — test path downgrade', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cookie-t-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('downgrades error -> warning in test paths (JS)', async () => {
    write(tmp, 'tests/a.test.js', 'app.use(session({ httpOnly: false }));\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:js-httponly-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('downgrades error -> warning in test paths (Python)', async () => {
    write(tmp, 'tests/test_settings.py', 'SESSION_COOKIE_HTTPONLY = False\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('cookie-sec:py-cookie-httponly-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });
});
