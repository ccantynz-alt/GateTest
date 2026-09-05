// =============================================================================
// Report provenance + signature (the Fifty, move 21)
// =============================================================================
// What produced this report, over what, and proof it was not edited since.
// The negative controls matter most: a signature that cannot fail to verify
// is decoration.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { GateTestConfig } = require('../src/core/config');
const { GateTestRunner } = require('../src/core/runner');
const { JsonReporter } = require('../src/reporters/json-reporter');
const {
  buildProvenance, signProvenance, signatureFor, verifyReport, canonicalJson, fingerprintFindings,
} = require('../src/core/report-provenance');

const KEY = 'test-signing-key-0123456789abcdef';
let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-prov-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function runAndRead(env) {
  const saved = process.env.GATETEST_REPORT_SIGNING_KEY;
  if (env && env.GATETEST_REPORT_SIGNING_KEY !== undefined) process.env.GATETEST_REPORT_SIGNING_KEY = env.GATETEST_REPORT_SIGNING_KEY;
  else delete process.env.GATETEST_REPORT_SIGNING_KEY;
  try {
    const config = new GateTestConfig(tmp);
    const runner = new GateTestRunner(config);
    new JsonReporter(runner, config);
    runner.register('secrets', {
      async run(result) {
        result.addCheck('secrets:src/a.js', false, { severity: 'error', file: 'src/a.js', line: 2, message: '1 potential secret(s) found' });
        result.addCheck('secrets:ok', true);
      },
    });
    runner.register('lint', { async run(result) { result.addCheck('lint:clean', true); } });
    await runner.run(['secrets', 'lint']);
    return JSON.parse(fs.readFileSync(path.join(tmp, '.gatetest', 'reports', 'gatetest-report-latest.json'), 'utf8'));
  } finally {
    if (saved === undefined) delete process.env.GATETEST_REPORT_SIGNING_KEY; else process.env.GATETEST_REPORT_SIGNING_KEY = saved;
  }
}

describe('provenance block', () => {
  it('records engine, runtime, module coverage, gate settings and a findings digest', async () => {
    const r = await runAndRead({});
    const p = r.provenance;
    assert.strictEqual(p.engine.name, 'gatetest');
    assert.match(p.engine.version, /^\d+\.\d+\.\d+/);
    assert.match(p.runtime.node, /^v\d+/);
    assert.deepStrictEqual(p.modules.ran.sort(), ['lint', 'secrets']);
    assert.deepStrictEqual(p.modules.skipped, []);
    assert.strictEqual(typeof p.confidenceThreshold, 'number');
    assert.strictEqual(p.findings.count, 1);
    assert.match(p.findings.sha256, /^[0-9a-f]{64}$/);
    assert.strictEqual(p.suppression.ignoreFile.present, false);
  });

  it('is unsigned — and says so — without a key', async () => {
    const r = await runAndRead({});
    assert.strictEqual(r.signature.signature, null);
    assert.match(r.signature.unsigned, /GATETEST_REPORT_SIGNING_KEY/);
  });

  it('is signed with the key, and verifies', async () => {
    const r = await runAndRead({ GATETEST_REPORT_SIGNING_KEY: KEY });
    assert.strictEqual(r.signature.algorithm, 'HMAC-SHA256');
    assert.match(r.signature.signature, /^[0-9a-f]{64}$/);
    assert.deepStrictEqual(verifyReport(r, KEY).ok, true);
  });

  it('the digest is the determinism fingerprint — same findings, same digest', async () => {
    const r = await runAndRead({});
    const crypto = require('node:crypto');
    const expected = crypto.createHash('sha256').update(fingerprintFindings(r.results).join('\n')).digest('hex');
    assert.strictEqual(r.provenance.findings.sha256, expected);
  });
});

describe('verifyReport — negative controls', () => {
  it('rejects the wrong key', async () => {
    const r = await runAndRead({ GATETEST_REPORT_SIGNING_KEY: KEY });
    const v = verifyReport(r, 'another-key-that-is-long-enough-00');
    assert.strictEqual(v.ok, false);
    assert.match(v.reason, /different key/);
  });
  it('rejects an edited provenance block', async () => {
    const r = await runAndRead({ GATETEST_REPORT_SIGNING_KEY: KEY });
    r.provenance.gateStatus = 'PASSED';
    r.provenance.findings.count = 0;
    const v = verifyReport(r, KEY);
    assert.strictEqual(v.ok, false);
    assert.match(v.reason, /provenance block was edited/);
  });
  it('rejects edited findings even when the provenance is intact', async () => {
    const r = await runAndRead({ GATETEST_REPORT_SIGNING_KEY: KEY });
    r.results[0].checks[0].passed = true; // "fix" the finding by hand
    const v = verifyReport(r, KEY);
    assert.strictEqual(v.ok, false);
    assert.match(v.reason, /findings were edited/);
  });
  it('rejects an unsigned report and one with no provenance', () => {
    assert.strictEqual(verifyReport({ provenance: {}, signature: { signature: null } }, KEY).ok, false);
    assert.strictEqual(verifyReport({}, KEY).ok, false);
  });
});

describe('canonical JSON', () => {
  it('sorts keys at every level so the same object always signs the same', () => {
    assert.strictEqual(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 0 }], c: null } }), '{"a":{"c":null,"d":[2,{"y":0,"z":1}]},"b":1}');
    const s1 = signProvenance({ b: 1, a: 2 }, KEY).signature;
    const s2 = signProvenance({ a: 2, b: 1 }, KEY).signature;
    assert.strictEqual(s1, s2);
  });
  it('signatureFor refuses a short key rather than pretending', () => {
    assert.strictEqual(signatureFor(buildProvenance({ results: [] }), { GATETEST_REPORT_SIGNING_KEY: 'short' }).signature, null);
  });
});

describe('gatetest verify-report (CLI)', () => {
  it('exits 0 on a verified report and 1 on a tampered one', async () => {
    const r = await runAndRead({ GATETEST_REPORT_SIGNING_KEY: KEY });
    const good = path.join(tmp, 'good.json');
    fs.writeFileSync(good, JSON.stringify(r));
    const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gatetest.js'), 'verify-report', good, '--key', KEY], { encoding: 'utf8' });
    assert.match(out, /^VERIFIED:/);
    r.results[0].checks[0].passed = true;
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify(r));
    let code = 0;
    try { execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'gatetest.js'), 'verify-report', bad, '--key', KEY], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (err) { code = err.status; }
    assert.strictEqual(code, 1);
  });
});

// ─── the policy the run was judged under (the Fifty, move 26) ───────────────

it('provenance carries the digests of .gatetest.json and .gatetestignore, and says when they are absent', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-policy-'));
  try {
    const none = buildProvenance({ results: [] }, { projectRoot: root });
    assert.deepEqual(none.policy, { configFile: { present: false, sha256: null }, ignoreFile: { present: false, sha256: null } });
    fs.writeFileSync(path.join(root, '.gatetest.json'), '{ "modules": {} }\n');
    fs.writeFileSync(path.join(root, '.gatetestignore'), 'secrets@tests/fixtures/**\n');
    const p = buildProvenance({ results: [] }, { projectRoot: root });
    assert.equal(p.policy.configFile.sha256, crypto.createHash('sha256').update('{ "modules": {} }\n').digest('hex'));
    assert.equal(p.policy.ignoreFile.sha256, crypto.createHash('sha256').update('secrets@tests/fixtures/**\n').digest('hex'));
    assert.deepEqual(p.suppression.ignoreFile, p.policy.ignoreFile, 'one digest, two views');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
