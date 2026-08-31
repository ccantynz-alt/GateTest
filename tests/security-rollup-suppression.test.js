'use strict';

// =============================================================================
// A ROLLUP MUST NOT COUNT WHAT THE USER ALREADY SILENCED
// =============================================================================
// `security:secrets-scan` and `security:sql-injection-scan` are pathless
// summary checks. They used to report a raw in-module counter, so a finding
// the user had suppressed in .gatetestignore was silenced per-file and then
// re-reported by the summary — which BLOCKED the gate.
//
// GateTest's own self-scan on 2026-08-31 is the worked example. This repo
// ignores `reliability-corpus/**` and `benchmarks/bench-target/**` (the
// intentional known-bad corpora). All four SQL-injection findings live there,
// all four were suppressed, and the gate still failed on
//     security:sql-injection-scan — Found 4 potential SQL injection pattern(s)
// with nothing left to fix. A rollup has no file path, so .gatetestignore
// cannot target it without also hiding genuine findings: the user had no way
// out at all. That is the bottleneck failure mode of Bible Forbidden #25.
//
// The positive controls are the half that matters — a rollup that has learned
// to stay quiet is worse than one that over-counts.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SecurityModule = require('../src/modules/security');
const { TestResult } = require('../src/core/runner');
const { parse } = require('../src/core/ignore-file');

const SECRET_LINE = 'const dbUrl = "postgres://admin:s3cretpassw0rd@db.internal:5432/app";\n';
const SQLI_LINES = [
  'function find(db, id) {',
  '  return db.query("SELECT * FROM users WHERE id = " + id);',
  '}',
  'module.exports = { find };',
  '',
].join('\n');

/**
 * Run the security module against a throwaway project, through a real
 * TestResult so the runner's suppression machinery is actually exercised.
 */
async function scan({ files, ignore }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sec-rollup-'));
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    const result = new TestResult('security', {
      projectRoot: tmp,
      ignoreMatcher: ignore ? parse(ignore) : null,
    });
    result.start();
    await new SecurityModule().run(result, { projectRoot: tmp });
    const pick = (name) => {
      const c = result.checks.find((x) => x.name === name);
      assert.ok(c, `expected a ${name} check`);
      return c;
    };
    return {
      secretsRollup: pick('security:secrets-scan'),
      sqlRollup: pick('security:sql-injection-scan'),
      suppressed: result.suppressedChecks.length,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe('security rollups — suppressed findings are not re-counted', () => {
  it('a secret inside an ignored path leaves the rollup passing', async () => {
    const r = await scan({
      files: { 'fixtures/known-bad/db.js': SECRET_LINE },
      ignore: 'fixtures/**',
    });
    assert.ok(r.suppressed > 0, 'the per-file finding should have been suppressed, not absent');
    assert.strictEqual(r.secretsRollup.passed, true,
      `rollup must not re-count a suppressed finding: ${r.secretsRollup.message}`);
  });

  it('a SQL injection inside an ignored path leaves the rollup passing', async () => {
    const r = await scan({
      files: { 'fixtures/known-bad/q.js': SQLI_LINES },
      ignore: 'fixtures/**',
    });
    assert.ok(r.suppressed > 0, 'the per-file finding should have been suppressed, not absent');
    assert.strictEqual(r.sqlRollup.passed, true,
      `rollup must not re-count a suppressed finding: ${r.sqlRollup.message}`);
  });

  it('POSITIVE CONTROL: an unsuppressed secret still fails the rollup', async () => {
    const r = await scan({ files: { 'src/db.js': SECRET_LINE } });
    assert.strictEqual(r.secretsRollup.passed, false,
      'a real secret must still fail security:secrets-scan');
    assert.match(r.secretsRollup.message, /Found 1 potential secret/);
  });

  it('POSITIVE CONTROL: an unsuppressed SQL injection still fails the rollup', async () => {
    const r = await scan({ files: { 'src/q.js': SQLI_LINES } });
    assert.strictEqual(r.sqlRollup.passed, false,
      'a real SQL injection must still fail security:sql-injection-scan');
    assert.match(r.sqlRollup.message, /Found 1 potential SQL injection/);
  });

  it('POSITIVE CONTROL: ignoring one path does not silence a finding in another', async () => {
    // The count must be the LIVE count, not zero and not the raw total.
    const r = await scan({
      files: {
        'fixtures/known-bad/db.js': SECRET_LINE,
        'src/db.js': SECRET_LINE,
      },
      ignore: 'fixtures/**',
    });
    assert.strictEqual(r.secretsRollup.passed, false);
    assert.match(r.secretsRollup.message, /Found 1 potential secret/,
      `expected exactly the one live finding, got: ${r.secretsRollup.message}`);
  });
});
