// ============================================================================
// MUTATION SAFETY — REGRESSION TESTS for the P0 repo-corrupting bug
// ============================================================================
// On 2026-04-27 a parallel coding session caught GateTest silently
// mutating files in a customer's working tree without explicit opt-in.
// Two unauthorised "fixes" landed:
//   - apps/api/scripts/register-and-promote-admin.ts: || → && in arg
//     validation (security regression, lets script run with missing creds)
//   - apps/api/src/ai/cache.ts: === 0 → !== 0 in early-return (inverts
//     cleanup logic, would silently break cache eviction)
//
// Three combining bugs:
//   A. `mutation` was in the default `full` tier — fixed in src/core/config.js
//      (removed from line 182).
//   B. `--suite full` overrode `modules.mutation.enabled = false` in the
//      project config — fixed in src/core/runner.js (filter respects
//      per-module enabled flag).
//   C. mutation module's mutate-test-restore cycle uses try/finally; if
//      killed mid-loop (SIGKILL, OOM), restore never runs and files are
//      left mutated — fixed by an opt-in gate in src/modules/mutation.js
//      (skips entirely unless GATETEST_ALLOW_MUTATION=true OR
//      `modules.mutation.enabled = true`).
//
// These tests lock in all three fixes.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MutationModule = require('../src/modules/mutation');

function makeResult() {
  const calls = [];
  return {
    calls,
    addCheck(name, passed, meta) { calls.push({ name, passed, meta: meta || {} }); },
  };
}

function makeConfig({ projectRoot = '/tmp/nope', mutationCfg = {} } = {}) {
  return {
    projectRoot,
    getModuleConfig(name) { return name === 'mutation' ? mutationCfg : {}; },
    get() { return undefined; },
  };
}

// ---------- Bug C: mutation module opt-in gate ----------

test('mutation — without opt-in, exits early with info check, never touches disk', async () => {
  const mod = new MutationModule();
  const result = makeResult();

  // No opt-in via env or config — should skip immediately.
  delete process.env.GATETEST_ALLOW_MUTATION;
  await mod.run(result, makeConfig());

  // Should have recorded exactly one info check about opt-in
  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.ok(optInCheck, `expected mutation:opt-in-required check; got: ${result.calls.map((c) => c.name).join(', ')}`);
  assert.equal(optInCheck.passed, true, 'opt-in skip is informational, not an error');
  assert.equal(optInCheck.meta.severity, 'info');
  assert.match(optInCheck.meta.message, /requires? opt-in|skipped/i);
  assert.match(optInCheck.meta.suggestion, /GATETEST_ALLOW_MUTATION|enabled/);
});

test('mutation — env GATETEST_ALLOW_MUTATION=true bypasses the gate', async () => {
  const mod = new MutationModule();
  const result = makeResult();

  process.env.GATETEST_ALLOW_MUTATION = 'true';
  try {
    // It will proceed past the gate and then fail/skip later (no
    // test framework detected at /tmp/nope). What matters is it
    // doesn't return at the opt-in gate.
    await mod.run(result, makeConfig());
  } finally {
    delete process.env.GATETEST_ALLOW_MUTATION;
  }

  // The opt-in gate must NOT have fired
  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.equal(optInCheck, undefined, 'opt-in gate should not have triggered when env=true');
});

test('mutation — env GATETEST_ALLOW_MUTATION=1 also bypasses the gate', async () => {
  const mod = new MutationModule();
  const result = makeResult();

  process.env.GATETEST_ALLOW_MUTATION = '1';
  try {
    await mod.run(result, makeConfig());
  } finally {
    delete process.env.GATETEST_ALLOW_MUTATION;
  }

  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.equal(optInCheck, undefined);
});

test('mutation — config.getModuleConfig("mutation").enabled=true bypasses the gate', async () => {
  const mod = new MutationModule();
  const result = makeResult();
  delete process.env.GATETEST_ALLOW_MUTATION;

  await mod.run(result, makeConfig({ mutationCfg: { enabled: true } }));

  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.equal(optInCheck, undefined, 'explicit config.enabled=true should bypass the gate');
});

test('mutation — env GATETEST_ALLOW_MUTATION=false (string) does NOT bypass the gate', async () => {
  const mod = new MutationModule();
  const result = makeResult();

  process.env.GATETEST_ALLOW_MUTATION = 'false';
  try {
    await mod.run(result, makeConfig());
  } finally {
    delete process.env.GATETEST_ALLOW_MUTATION;
  }

  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.ok(optInCheck, 'string "false" must not be treated as opt-in');
});

test('mutation — config.enabled=false (no env) keeps gate active', async () => {
  const mod = new MutationModule();
  const result = makeResult();
  delete process.env.GATETEST_ALLOW_MUTATION;

  await mod.run(result, makeConfig({ mutationCfg: { enabled: false } }));

  const optInCheck = result.calls.find((c) => c.name === 'mutation:opt-in-required');
  assert.ok(optInCheck, 'config.enabled=false must keep the gate active');
});

// ---------- Bug A: mutation removed from default `full` tier ----------

test('config — `full` tier does NOT include mutation by default', () => {
  const config = require('../src/core/config');
  // Look at the actual default config object, not the file source.
  const defaults = config.DEFAULT_CONFIG || (config.GateTestConfig && new config.GateTestConfig().config);
  // Best effort: read source if neither shape works
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'config.js'), 'utf-8');

  // Find the `full:` tier block
  const fullBlock = src.match(/full:\s*\[([\s\S]*?)\]/);
  assert.ok(fullBlock, 'could not locate `full` tier definition');
  // The mutation entry must NOT appear inside the full block (commented-out
  // lines are fine; we check for a quoted entry on its own).
  const hasUncommentedMutation = /^\s*'mutation',/m.test(fullBlock[1]);
  assert.equal(hasUncommentedMutation, false, '`full` tier must not include `mutation` by default — destructive module');

  // Sanity: it SHOULD still appear in the `nuclear` tier
  const nuclearBlock = src.match(/nuclear:\s*\[([\s\S]*?)\]/);
  assert.ok(nuclearBlock);
  assert.match(nuclearBlock[1], /^\s*'mutation',/m, '`nuclear` tier should still include `mutation`');
});

// ---------- Bug B: runner respects per-module enabled:false ----------

test('runner — modulesToRun excludes modules whose config.enabled === false', async () => {
  // Build a minimal Runner-shaped object with the filter behaviour we
  // expect. Importing the full runner pulls heavy deps, so we exercise
  // the filter shape directly via a stub config.
  const { GateTestRunner } = require('../src/core/runner');

  // Construct the Runner with two registered modules, one disabled by config
  const runner = new GateTestRunner({
    projectRoot: '/tmp/nope',
    getModuleConfig(name) {
      return name === 'mutation' ? { enabled: false } : {};
    },
  }, { parallel: false });
  // Manually add stub modules so the filter has something to chew on
  runner.modules = new Map([
    ['mutation', { name: 'mutation', async run() {} }],
    ['syntax', { name: 'syntax', async run() {} }],
  ]);
  // Capture the suite:start event to inspect modulesToRun
  let suiteStartModules = null;
  runner.on('suite:start', (e) => { suiteStartModules = e.modules; });
  let skippedEvent = null;
  runner.on('modules:skipped-by-config', (e) => { skippedEvent = e; });

  await runner.run(['mutation', 'syntax']);

  assert.ok(suiteStartModules, 'suite:start should have fired');
  assert.ok(!suiteStartModules.includes('mutation'), 'mutation should be filtered out by enabled:false');
  assert.ok(suiteStartModules.includes('syntax'), 'syntax (no config) should still run');
  assert.ok(skippedEvent, 'modules:skipped-by-config should have fired');
  assert.deepEqual(skippedEvent.skipped, ['mutation']);
});

test('runner — modulesToRun includes module when config.enabled === true', async () => {
  const { GateTestRunner } = require('../src/core/runner');
  const runner = new GateTestRunner({
    projectRoot: '/tmp/nope',
    getModuleConfig(name) {
      return name === 'mutation' ? { enabled: true } : {};
    },
  }, { parallel: false });
  runner.modules = new Map([
    ['mutation', { name: 'mutation', async run() {} }],
  ]);
  let suiteStartModules = null;
  runner.on('suite:start', (e) => { suiteStartModules = e.modules; });

  await runner.run(['mutation']);

  assert.ok(suiteStartModules.includes('mutation'), 'enabled:true should not be filtered');
});

test('runner — modulesToRun includes module when config has no enabled key (default)', async () => {
  const { GateTestRunner } = require('../src/core/runner');
  const runner = new GateTestRunner({
    projectRoot: '/tmp/nope',
    getModuleConfig() { return {}; }, // no enabled key at all
  }, { parallel: false });
  runner.modules = new Map([
    ['mutation', { name: 'mutation', async run() {} }],
  ]);
  let suiteStartModules = null;
  runner.on('suite:start', (e) => { suiteStartModules = e.modules; });

  await runner.run(['mutation']);

  assert.ok(suiteStartModules.includes('mutation'), 'no enabled key = default behaviour (run)');
});

test('runner — handles missing config.getModuleConfig gracefully (no crash)', async () => {
  const { GateTestRunner } = require('../src/core/runner');
  const runner = new GateTestRunner({}, { parallel: false }); // config has no getModuleConfig method
  runner.modules = new Map([
    ['syntax', { name: 'syntax', async run() {} }],
  ]);
  let suiteStartModules = null;
  runner.on('suite:start', (e) => { suiteStartModules = e.modules; });

  // Must not throw
  await runner.run(['syntax']);

  assert.ok(suiteStartModules.includes('syntax'));
});
