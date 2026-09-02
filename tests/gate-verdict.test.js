// =============================================================================
// GATE VERDICT — the decision both hosts post, on the shape the engine emits
// =============================================================================
// Measured 2026-09-02, one line:
//
//     strict, engine shape, 3 error findings -> success
//
// github-callback's toCommitState read `module.checks` as an array of
// severities. The engine emits `checks: <number>` (scan-executor.ts:44), so
// `Array.isArray` gave `[]` and strict mode could never go red. The existing
// tests handed it arrays, agreed with the hypothesis, and never caught it.
// gluecron-callback.js failed on `totalIssues > 0`; but a sibling .ts shadowed it
// in every bundle and posted "passed" for any completed scan. Production's Gluecron
// gate could never go red either (corrected 2026-09-01, .ts deleted).
//
// Every fixture below is the REAL envelope: `checks` is a number, blocking /
// inDiff / duplicateOf live on `findings[]`, `findingSummary` is present.
// Hand-built array shapes are covered once, as the legacy fallback.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { computeGateVerdict } = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'gate-verdict.js'));
const { toCommitState, buildDescription, buildMarkdownComment } = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'github-callback.js'));
const { buildGluecronPayload } = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'gluecron-callback.js'));

/** One finding as src/core/finding-registry emits it. */
function finding(over = {}) {
  return {
    id: 'security:eval', module: 'security', rule: 'security:eval',
    severity: 'error', confidence: 1, blocking: true,
    file: 'src/a.js', line: 4, message: 'eval() with user input',
    duplicateOf: null, ...over,
  };
}

/** The envelope scan-executor returns for a CLI-engine tier. */
function engineResult(findings, over = {}) {
  const live = findings.filter((f) => !f.duplicateOf);
  const blocking = live.filter((f) => f.blocking).length;
  return {
    status: 'complete',
    totalIssues: live.length,
    modules: [
      // checks is a NUMBER here. That is the whole point.
      { name: 'security', status: blocking ? 'failed' : 'passed', checks: 12, issues: live.length, duration: 5, details: ['[error] eval() (src/a.js:4)'] },
      { name: 'lint', status: 'passed', checks: 30, issues: 0, duration: 3 },
    ],
    engine: 'cli',
    engineMeta: { gateStatus: blocking ? 'BLOCKED' : 'PASSED' },
    findings,
    findingSummary: { total: live.length, blocking, softErrors: live.filter((f) => f.severity === 'error' && !f.blocking).length, hiddenLowConfidence: 0, duplicatesCollapsed: 0 },
    ...over,
  };
}

describe('gate verdict — the regression', () => {
  it('strict mode FAILS on a blocking finding in the engine shape (checks is a number)', () => {
    const r = engineResult([finding()]);
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'failure');
    assert.strictEqual(toCommitState(r, 'strict'), 'failure', 'toCommitState must not read checks as an array');
    assert.strictEqual(toCommitState(r, 'admin'), 'failure');
  });

  it('advisory mode stays green on the same result, but says what strict would do', () => {
    const v = computeGateVerdict(engineResult([finding()]), 'advisory');
    assert.strictEqual(v.state, 'success');
    assert.strictEqual(v.wouldFail, true);
    assert.strictEqual(v.enforced, false);
  });

  it('a scan that did not complete is error in every mode', () => {
    for (const mode of ['advisory', 'strict', 'admin']) {
      assert.strictEqual(computeGateVerdict({ status: 'failed', error: 'timeout' }, mode).state, 'error');
      assert.strictEqual(computeGateVerdict({ status: 'scanning' }, mode).state, 'error');
      assert.strictEqual(computeGateVerdict(null, mode).state, 'error');
    }
  });
});

describe('gate verdict — only CONFIDENT errors fail', () => {
  it('a low-confidence error is shown, not enforced', () => {
    const soft = finding({ confidence: 0.2, blocking: false, file: 'README.md', message: 'eval() in a code sample' });
    const v = computeGateVerdict(engineResult([soft]), 'strict');
    assert.strictEqual(v.state, 'success');
    assert.strictEqual(v.softErrors, 1);
    assert.match(v.reason, /held back/);
  });

  it('positive control: the same finding at full confidence fails', () => {
    // Without this, "never fail" satisfies the test above.
    const v = computeGateVerdict(engineResult([finding({ file: 'README.md' })]), 'strict');
    assert.strictEqual(v.state, 'failure');
  });

  it('warnings never fail, whatever their count', () => {
    const warnings = Array.from({ length: 40 }, (_, i) => finding({ id: `q:${i}`, severity: 'warning', blocking: false, line: i }));
    assert.strictEqual(computeGateVerdict(engineResult(warnings), 'strict').state, 'success');
  });

  it('a cross-module duplicate does not count twice, and a duplicate-only view does not fail', () => {
    const primary = finding({ blocking: false, severity: 'warning' });
    const dup = finding({ id: 'taint:eval', module: 'taint', duplicateOf: 'security:eval', blocking: true });
    const v = computeGateVerdict(engineResult([primary, dup]), 'strict');
    assert.strictEqual(v.blocking, 0, 'a finding marked duplicateOf must not be enforced on its own');
    assert.strictEqual(v.state, 'success');
  });
});

describe('gate verdict — only findings IN THIS CHANGE fail when the base is known', () => {
  const attributed = (findings) => engineResult(findings, { changedFiles: 2, baseRef: 'b'.repeat(40) });

  it('a blocking finding in a file this change did not touch does not fail the check', () => {
    const v = computeGateVerdict(attributed([finding({ inDiff: false })]), 'strict');
    assert.strictEqual(v.state, 'success');
    assert.strictEqual(v.attributed, true);
    assert.strictEqual(v.blockingPreExisting, 1);
    assert.strictEqual(v.blocking, 1, 'pre-existing findings are still counted, just not enforced');
    assert.match(v.reason, /pre-existing/);
  });

  it('positive control: the same finding in a touched file fails', () => {
    const v = computeGateVerdict(attributed([finding({ inDiff: true })]), 'strict');
    assert.strictEqual(v.state, 'failure');
    assert.strictEqual(v.blockingInChange, 1);
  });

  it('mixed: one in the change and three pre-existing fails on the one', () => {
    const v = computeGateVerdict(attributed([
      finding({ id: 'a', inDiff: true }),
      finding({ id: 'b', inDiff: false, file: 'legacy/x.js' }),
      finding({ id: 'c', inDiff: false, file: 'legacy/y.js' }),
      finding({ id: 'd', inDiff: false, file: 'legacy/z.js' }),
    ]), 'strict');
    assert.strictEqual(v.state, 'failure');
    assert.strictEqual(v.blockingInChange, 1);
    assert.strictEqual(v.blockingPreExisting, 3);
  });

  it('no base known: the whole repository is enforced, and the verdict says so', () => {
    // `inDiff` absent, `changedFiles` null — first push, force-push, or the
    // base tree was unreadable. Falling back to "enforce everything" is the
    // honest choice; silently enforcing nothing is the bug we just fixed.
    const v = computeGateVerdict(engineResult([finding()], { changedFiles: null }), 'strict');
    assert.strictEqual(v.state, 'failure');
    assert.strictEqual(v.attributed, false);
    assert.match(v.reason, /base unknown/);
  });
});

describe('gate verdict — fallbacks when the registry is absent', () => {
  it('uses engineMeta.gateStatus when findings were not attached', () => {
    const r = { status: 'complete', totalIssues: 2, modules: [{ name: 'x', status: 'failed', checks: 3, issues: 2 }], engineMeta: { gateStatus: 'BLOCKED' } };
    assert.strictEqual(computeGateVerdict(r, 'strict').source, 'engine');
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'failure');
    r.engineMeta.gateStatus = 'PASSED';
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'success');
  });

  it('legacy: the in-memory runTier shape (checks as an array) still works', () => {
    const r = { status: 'complete', totalIssues: 1, modules: [{ name: 'x', status: 'failed', issues: 1, checks: [{ severity: 'error' }] }] };
    assert.strictEqual(computeGateVerdict(r, 'strict').source, 'legacy');
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'failure');
    r.modules[0].checks = [{ severity: 'warning' }];
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'success');
  });

  it('legacy: a failed module with only a count of checks fails', () => {
    const r = { status: 'complete', totalIssues: 1, modules: [{ name: 'x', status: 'failed', issues: 1, checks: 4 }] };
    assert.strictEqual(computeGateVerdict(r, 'strict').state, 'failure');
  });
});

describe('gate verdict — what the customer reads', () => {
  it('the 140-char description says what made the check red', () => {
    const d = buildDescription(engineResult([finding({ inDiff: true }), finding({ id: 'old', inDiff: false, file: 'legacy.js' })], { changedFiles: 1 }), 'strict');
    assert.match(d, /1 blocking finding in this change/);
    assert.match(d, /1 pre-existing not enforced/);
    assert.ok(d.length <= 140);
  });

  it('a green check with held-back findings says so, not "all passed"', () => {
    const r = engineResult([finding({ inDiff: false })], { changedFiles: 1 });
    assert.match(buildDescription(r, 'strict'), /all pre-existing, not enforced/);
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), r, null, 'strict');
    assert.match(md, /none blocking in this change/);
    assert.match(md, /pre-date this change/);
    assert.ok(!/All checks passed/.test(md));
  });

  it('the PR comment headline on failure counts blocking findings, not all issues', () => {
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), engineResult([finding({ inDiff: true }), finding({ id: 'w', severity: 'warning', blocking: false, inDiff: true })], { changedFiles: 1 }), null, 'strict');
    assert.match(md, /1 blocking finding in this change/);
  });
});

describe('gate verdict — Gluecron gets the same decision', () => {
  it('a warning-only result PASSES (the shipped .ts passed everything; the shadowed .js failed on any issue)', () => {
    const p = buildGluecronPayload({ repository: 'o/r', sha: 'a'.repeat(40), scanResult: engineResult([finding({ severity: 'warning', blocking: false })]) });
    assert.strictEqual(p.status, 'passed');
    assert.match(p.summary, /none blocking/);
  });

  it('positive control: a blocking finding FAILS', () => {
    const p = buildGluecronPayload({ repository: 'o/r', sha: 'a'.repeat(40), scanResult: engineResult([finding()]) });
    assert.strictEqual(p.status, 'failed');
  });

  it('a pre-existing blocking finding does not fail the push', () => {
    const p = buildGluecronPayload({ repository: 'o/r', sha: 'a'.repeat(40), scanResult: engineResult([finding({ inDiff: false })], { changedFiles: 1 }) });
    assert.strictEqual(p.status, 'passed');
    assert.match(p.summary, /pre-existing/);
  });
});

describe('finding registry — suppressed checks never reach the verdict', () => {
  const { normalizeFindings } = require('../src/core/finding-registry');
  it('a .gatetestignore-suppressed error is not ranked and not blocking', () => {
    const results = [{ module: 'security', checks: [
      { name: 'eval', severity: 'error', passed: false, confidence: 1, suppressed: true, file: 'a.js', line: 1, message: 'x' },
      { name: 'exec', severity: 'error', passed: false, confidence: 1, file: 'b.js', line: 1, message: 'y' },
    ] }];
    const f = normalizeFindings(results);
    assert.deepStrictEqual(f.map((x) => x.id), ['security:exec']);
  });
});
