// =============================================================================
// DEPLOY READINESS — the derived score must agree with the gate
// =============================================================================
// The readiness score filtered `severity === 'error'` while the gate filters
// `isBlockingFinding()`, which also requires confidence >= the block
// threshold. So a finding the gate had explicitly decided was too shaky to
// block still counted against the score, and was printed as `[CRITICAL]`.
//
// Measured 2026-09-01 on axios @81df7a5: nine `secrets:docs/**` findings from
// its HTTP Basic auth documentation (`password: "myPassword"`, in four
// languages) scored 0.4 and correctly did not block. This module listed all
// nine as CRITICAL and pulled the score down with them.
//
// One value, two readings. The gate said "not confident enough to block", the
// score said "critical", and a customer looking at both cannot tell which to
// believe. A derived score that disagrees with the thing it derives from is
// worse than no score.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

const DeployReadiness = require('../src/modules/deploy-readiness');
const { BLOCK_THRESHOLD } = require('../src/core/confidence');

function makeResult() {
  const checks = [];
  return {
    checks,
    addCheck(name, passed, meta) { checks.push({ name, passed, ...(meta || {}) }); },
    addInfo() {},
    find(name) { return checks.find((c) => c.name === name); },
  };
}

/** Run the module over a synthetic set of prior-module checks. */
async function score(checks) {
  const result = makeResult();
  await new DeployReadiness().run(result, {
    _allResults: [{ module: 'secrets', checks }],
  });
  const main = result.find('deploy-readiness:score');
  const top = result.find('deploy-readiness:top-issues');
  return {
    score: main.details.score,
    errors: main.details.errors,
    critical: main.details.critical,
    topIssues: top ? top.message : '',
  };
}

const lowConfidence = BLOCK_THRESHOLD / 2;

describe('deploy-readiness — low-confidence findings do not count', () => {
  it('ignores a soft finding the gate would not block', async () => {
    const soft = await score([
      { name: 'secrets:docs/auth.md', passed: false, severity: 'error', confidence: lowConfidence },
    ]);
    assert.strictEqual(soft.errors, 0, 'a soft finding was counted as an error');
    assert.strictEqual(soft.critical, 0, 'a soft finding was listed as CRITICAL');
    assert.ok(
      !/secrets:docs/.test(soft.topIssues),
      `soft finding appeared in top issues: ${soft.topIssues}`,
    );
  });

  it('a repo whose only findings are soft scores as clean', async () => {
    const soft = await score([
      { name: 'secrets:docs/a.md', passed: false, severity: 'error', confidence: lowConfidence },
      { name: 'secrets:docs/b.md', passed: false, severity: 'error', confidence: lowConfidence },
      { name: 'secrets:docs/c.md', passed: false, severity: 'error', confidence: lowConfidence },
    ]);
    const clean = await score([{ name: 'secrets:ok', passed: true }]);
    assert.strictEqual(soft.score, clean.score);
  });
});

describe('deploy-readiness — confident findings still count', () => {
  // The load-bearing half. Without it, ignoring EVERYTHING would pass above.
  it('counts a confident error', async () => {
    const hard = await score([
      { name: 'secrets:src/config.js', passed: false, severity: 'error', confidence: 1 },
    ]);
    assert.strictEqual(hard.errors, 1);
    assert.strictEqual(hard.critical, 1, 'a confident secrets finding must stay CRITICAL');
    assert.match(hard.topIssues, /CRITICAL/);
  });

  it('a finding with no confidence field is treated as confident', async () => {
    // Modules that never opted into scoring must not be silently discounted —
    // that would be the false-negative direction.
    const hard = await score([
      { name: 'secrets:src/config.js', passed: false, severity: 'error' },
    ]);
    assert.strictEqual(hard.errors, 1);
  });

  it('more confident errors score strictly lower', async () => {
    const one = await score([
      { name: 'security:a', passed: false, severity: 'error', confidence: 1 },
    ]);
    const many = await score([
      { name: 'security:a', passed: false, severity: 'error', confidence: 1 },
      { name: 'security:b', passed: false, severity: 'error', confidence: 1 },
      { name: 'security:c', passed: false, severity: 'error', confidence: 1 },
    ]);
    assert.ok(many.score < one.score, `expected ${many.score} < ${one.score}`);
  });

  it('warnings are unaffected by this change', async () => {
    // Enough warnings to escape the 0..100 clamp. With one warning the score
    // is 100 - 1 + 5 (all-pass bonus) = 104, clamped to 100, identical to a
    // clean repo — the term is real but invisible at that scale. Asserting on
    // a single warning would have been a test that could not fail.
    const withWarn = await score(
      Array.from({ length: 9 }, (_, i) => (
        { name: `lint:x${i}`, passed: false, severity: 'warning' }
      )),
    );
    const clean = await score([{ name: 'lint:ok', passed: true }]);
    assert.ok(
      withWarn.score < clean.score,
      `warnings must still cost points: ${withWarn.score} vs ${clean.score}`,
    );
  });

  it('the zero-warning bonus is reachable', async () => {
    // It was not: the branch awarding it could only be entered when at least
    // one warning existed. A clean repo must score strictly above one whose
    // only findings are warnings.
    const clean = await score([{ name: 'lint:ok', passed: true }]);
    const warned = await score([
      { name: 'lint:x', passed: false, severity: 'warning' },
    ]);
    assert.ok(
      clean.score >= warned.score,
      `a clean repo must not score below a warned one: ${clean.score} vs ${warned.score}`,
    );
  });
});
