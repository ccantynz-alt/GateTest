const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TlsSecurityModule = require('../src/modules/tls-security');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new TlsSecurityModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('TlsSecurityModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('no-op when nothing to scan', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'tls-security:no-files'));
  });

  it('summary when files are scanned', async () => {
    write(tmp, 'src/a.ts', 'const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'tls-security:summary'));
  });
});

describe('TlsSecurityModule — JS rejectUnauthorized', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-ru-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on rejectUnauthorized: false', async () => {
    write(tmp, 'src/a.js', 'const agent = new https.Agent({ rejectUnauthorized: false });\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-reject-unauthorized:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does not flag rejectUnauthorized: true', async () => {
    write(tmp, 'src/a.js', 'const agent = new https.Agent({ rejectUnauthorized: true });\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('tls-security:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('TlsSecurityModule — JS NODE_TLS_REJECT_UNAUTHORIZED env bypass', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-env-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"', async () => {
    write(tmp, 'src/a.js', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-env-bypass:')));
  });

  it('errors on process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"', async () => {
    write(tmp, 'src/a.js', 'process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-env-bypass:')));
  });
});

describe('TlsSecurityModule — JS strictSSL / insecure', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-ss-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on strictSSL: false', async () => {
    write(tmp, 'src/a.js', 'request.get({ url, strictSSL: false });\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-strict-ssl:')));
  });

  it('errors on insecure: true', async () => {
    write(tmp, 'src/a.js', 'client.get({ url, insecure: true });\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-insecure-flag:')));
  });
});

describe('TlsSecurityModule — Python verify=False', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-py-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on requests.get(url, verify=False)', async () => {
    write(tmp, 'src/a.py', 'r = requests.get(url, verify=False)\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-verify-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on httpx.Client(verify=False)', async () => {
    write(tmp, 'src/a.py', 'client = httpx.Client(verify=False)\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-verify-false:')));
  });

  it('errors on aiohttp TCPConnector(verify_ssl=False)', async () => {
    write(tmp, 'src/a.py', 'conn = aiohttp.TCPConnector(verify_ssl=False)\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-verify-false:')));
  });

  it('does not flag verify=True', async () => {
    write(tmp, 'src/a.py', 'r = requests.get(url, verify=True)\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('tls-security:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('TlsSecurityModule — Python _create_unverified_context', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-uc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on ssl._create_unverified_context()', async () => {
    write(tmp, 'src/a.py', 'ctx = ssl._create_unverified_context()\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-unverified-context:')));
  });
});

describe('TlsSecurityModule — Python check_hostname / CERT_NONE', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-ch-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on ctx.check_hostname = False', async () => {
    write(tmp, 'src/a.py', 'ctx.check_hostname = False\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-check-hostname-false:')));
  });

  it('errors on ssl.CERT_NONE', async () => {
    write(tmp, 'src/a.py', 'ctx.verify_mode = ssl.CERT_NONE\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-cert-none:')));
  });

  it('errors on cert_reqs=\'CERT_NONE\'', async () => {
    write(tmp, 'src/a.py', "pool = urllib3.PoolManager(cert_reqs='CERT_NONE')\n");
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-cert-none:')));
  });
});

describe('TlsSecurityModule — Python disable_warnings', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-dw-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on urllib3.disable_warnings(InsecureRequestWarning)', async () => {
    write(tmp, 'src/a.py', 'urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-disable-warnings:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });
});

describe('TlsSecurityModule — suppressions', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-sup-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('honours // tls-ok on same line (JS)', async () => {
    write(tmp, 'src/a.js', 'new https.Agent({ rejectUnauthorized: false }); // tls-ok — local dev self-signed\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('tls-security:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('honours # tls-ok on same line (Python)', async () => {
    write(tmp, 'src/a.py', 'requests.get(url, verify=False)  # tls-ok — test against localhost\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('tls-security:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('TlsSecurityModule — string-content skip', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-str-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does not flag rejectUnauthorized: false inside a doc string', async () => {
    write(tmp, 'src/a.js', 'const docs = "never set rejectUnauthorized: false";\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('tls-security:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('TlsSecurityModule — test path downgrade', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tls-t-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('downgrades error -> warning in test paths (JS)', async () => {
    write(tmp, 'tests/a.test.js', 'new https.Agent({ rejectUnauthorized: false });\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('tls-security:js-reject-unauthorized:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('downgrades error -> warning in test paths (Python)', async () => {
    write(tmp, 'tests/test_a.py', 'r = requests.get(url, verify=False)\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('tls-security:py-verify-false:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });
});
