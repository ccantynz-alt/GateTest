// =============================================================================
// determinism-check — the gate must be able to fail (move 19)
// =============================================================================
// scripts/determinism-check.js scans the same tree twice and demands
// identical findings. This pins the comparison itself: a fingerprint that
// ignores what may differ (timestamps, order) and catches what may not
// (a finding that comes and goes, a confidence that drifts).
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fingerprint, compareRuns } = require('../scripts/determinism-check');

const report = (checks) => ({ results: [{ module: 'm', checks }] });
const failing = (over = {}) => ({ name: 'm:rule', passed: false, file: 'a.js', line: 3, severity: 'error', confidence: 0.9, message: 'x', ...over });

describe('fingerprint', () => {
  it('is order-independent and ignores passing checks and timing', () => {
    const a = fingerprint(report([failing({ name: 'r1' }), failing({ name: 'r2' }), { name: 'ok', passed: true }]));
    const b = fingerprint(report([failing({ name: 'r2', timestamp: 999, duration: 5 }), failing({ name: 'r1' })]));
    assert.deepStrictEqual(a, b);
  });
  it('changes when a finding, its line, or its confidence changes', () => {
    const base = fingerprint(report([failing()]));
    assert.notDeepStrictEqual(fingerprint(report([failing({ line: 4 })])), base);
    assert.notDeepStrictEqual(fingerprint(report([failing({ confidence: 0.6 })])), base);
    assert.notDeepStrictEqual(fingerprint(report([failing(), failing({ name: 'm:other' })])), base);
  });
});

describe('compareRuns', () => {
  it('passes identical runs', () => {
    const fp = fingerprint(report([failing(), failing({ name: 'm:b' })]));
    assert.strictEqual(compareRuns([fp, fp.slice(), fp.slice()]).diffs, 0);
  });
  it('fails — and names the finding — when one run differs (negative control)', () => {
    const r1 = fingerprint(report([failing(), failing({ name: 'm:flaky' })]));
    const r2 = fingerprint(report([failing()]));
    const { diffs, report: lines } = compareRuns([r1, r2]);
    assert.strictEqual(diffs, 1);
    assert.ok(lines.some((l) => /vanished/.test(l)));
    assert.ok(lines.some((l) => /- m\|m:flaky\|/.test(l)));
  });
});
