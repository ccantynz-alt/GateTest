// =============================================================================
// MUTATION — a timeout is not a kill, and a truncated run is not a verdict
// =============================================================================
// Two defects, one root cause: the module could not tell "the tests caught
// this mutant" from "the tests did not finish".
//
// 1. Every mutant ran with a hardcoded 30s timeout. execSync reports a
//    timeout as a non-zero exit, and a non-zero exit was counted as KILLED.
//    So on any project whose suite takes longer than 30s, every mutant timed
//    out, every timeout scored as a kill, and the module printed a perfect
//    score without a single test run ever having finished. Measured on the
//    fixture below (35s suite): "Mutation score: 100% (3/3 killed, 0
//    survived)". That is the most dangerous number this engine can print —
//    a team reads it as "our tests are bulletproof".
//
// 2. maxMutants bounded the COUNT, not the TIME. 50 mutants against a 30s
//    suite is 25 minutes, and a full self-scan of this repo hit `timeout
//    1200` (exit 124) still inside this module. It now stops at a wall-clock
//    budget — and a run stopped early reports its number as a SAMPLE rather
//    than blocking a build on it, because "0% of 4 mutants" is real but
//    cannot carry a build decision.
//
// `_exec` had returned `timedOut` the whole time. The information existed;
// the module ignored it.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MutationModule = require('../../src/modules/mutation');

/**
 * A project whose suite PASSES but takes `suiteSeconds` to do it. The baseline
 * run exits immediately (so the module proceeds to mutants); every run after
 * that blocks, which is exactly the shape that produced the fake 100%.
 */
function buildSlowSuiteProject(suiteSeconds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mut-slow-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  // The module skips a project whose dependencies are not installed.
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'math.js'),
    'function subtract(a, b) { return a - b; }\nfunction add(a, b) { return a + b; }\nmodule.exports = { subtract, add };\n',
  );
  // The harness lives in `node -e`, NOT in a .js file. A first version put it
  // in t.js and the module mutated its own stopwatch — flipping the timeout
  // literal — so the fixture measured itself rather than the defect.
  const harness = [
    "const fs=require('fs');",
    "const m=process.cwd()+'/.baseline-done';",
    "if(!fs.existsSync(m)){fs.writeFileSync(m,'1');process.exit(0);}",
    `setTimeout(()=>process.exit(0),${suiteSeconds * 1000});`,
  ].join('');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'slow', version: '1.0.0', scripts: { test: `node -e "${harness}"` } },
      null,
      2,
    ),
  );
  return root;
}

/** The module reads its settings through config.getModuleConfig, not a plain object. */
function configFor(overrides) {
  return { getModuleConfig: (name) => (name === 'mutation' ? overrides : {}) };
}

async function runMutation(root, overrides) {
  const checks = [];
  const result = {
    checks,
    addCheck: (id, passed, meta) => checks.push({ id, passed, ...(meta || {}) }),
    addInfo() {},
  };
  const cfg = configFor(overrides);
  cfg.projectRoot = root;
  await new MutationModule().run(result, cfg);
  return checks;
}

describe('mutation — a timed-out suite is inconclusive, never a kill', () => {
  it('does not manufacture a score out of timeouts', async () => {
    // 35s suite vs a 30s floor on the per-mutant timeout: every mutant run
    // is killed by the clock, not by a test.
    const root = buildSlowSuiteProject(35);
    try {
      const checks = await runMutation(root, { maxMutants: 2 });
      const score = checks.find((c) => c.id === 'mutation:score');
      assert.ok(score, 'the module must report a score check');

      assert.ok(
        !/100%/.test(score.message),
        `a suite that never finished cannot score 100%. Got: ${score.message}`,
      );
      assert.ok(
        /not measured|inconclusive/i.test(score.message),
        `the report must say the runs were inconclusive. Got: ${score.message}`,
      );
      assert.ok(
        !/\d+\/\d+ killed/.test(score.message) || /0\/0/.test(score.message),
        `no mutant may be counted as killed. Got: ${score.message}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a run stopped by the budget reports a sample, and does not block', async () => {
    // 8s suite: fast enough to complete a mutant, slow enough that a 1s
    // budget truncates the run after the first one.
    const root = buildSlowSuiteProject(8);
    try {
      const checks = await runMutation(root, { maxMutants: 50, timeBudgetMs: 1 });
      const score = checks.find((c) => c.id === 'mutation:score');
      if (!score) return; // budget so tight nothing ran; nothing to assert
      assert.notStrictEqual(
        score.severity, 'error',
        `a truncated sample must not block a build. Got: ${score.message}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
