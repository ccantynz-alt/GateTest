const { describe, it } = require('node:test');
const assert = require('node:assert');

const FakeFixDetector = require('../src/modules/fake-fix-detector');
const { TestResult } = require('../src/core/runner');
const { GateTestConfig } = require('../src/core/config');

/**
 * Build a minimal GateTestConfig and inject a diff via _runnerOptions so the
 * module never has to shell out to git.
 */
function makeConfig(diff, extraModuleConfig = {}) {
  const config = new GateTestConfig(process.cwd());
  // Force-disable AI engine for pattern tests — we don't want network calls.
  config.config.modules.fakeFixDetector = {
    patternEngine: true,
    aiEngine: false,
    ...extraModuleConfig,
  };
  config._runnerOptions = { diff };
  return config;
}

function failedCheckNames(result) {
  return result.checks.filter(c => !c.passed).map(c => c.name);
}

function findFailure(result, ruleIdFragment) {
  return result.checks.find(c => !c.passed && c.name.includes(ruleIdFragment));
}

describe('FakeFixDetectorModule', () => {
  it('flags it.skip added to a test file', async () => {
    const diff = [
      'diff --git a/tests/auth.test.js b/tests/auth.test.js',
      'index abc..def 100644',
      '--- a/tests/auth.test.js',
      '+++ b/tests/auth.test.js',
      '@@ -10,3 +10,3 @@',
      "-  it('rejects invalid tokens', () => {",
      "+  it.skip('rejects invalid tokens', () => {",
      '     expect(verify(BAD_TOKEN)).toBe(false);',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'test-skip-added');
    assert.ok(failure, 'expected a test-skip-added failure');
    assert.strictEqual(failure.severity, 'error');
  });

  it('flags empty catch blocks', async () => {
    const diff = [
      'diff --git a/src/api.js b/src/api.js',
      '--- a/src/api.js',
      '+++ b/src/api.js',
      '@@ -5,5 +5,7 @@',
      '   try {',
      '     await fetchUser();',
      '-  } catch (err) { throw err; }',
      '+  } catch (err) { }',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'empty-catch');
    assert.ok(failure, 'expected empty-catch failure');
    assert.strictEqual(failure.severity, 'error');
  });

  it('flags @ts-ignore suppressions', async () => {
    const diff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -3,3 +3,4 @@',
      ' function parse(input) {',
      '+  // @ts-ignore',
      '   return JSON.parse(input)',
      ' }',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'ts-ignore-added');
    assert.ok(failure, 'expected ts-ignore-added failure');
    assert.strictEqual(failure.severity, 'error');
  });

  it('flags if (false) dead-code guards', async () => {
    const diff = [
      'diff --git a/src/validator.js b/src/validator.js',
      '--- a/src/validator.js',
      '+++ b/src/validator.js',
      '@@ -8,3 +8,3 @@',
      '-  if (!isValid(payload)) throw new Error("invalid");',
      '+  if (false) throw new Error("invalid");',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'always-pass');
    assert.ok(failure, 'expected always-pass failure');
    assert.strictEqual(failure.severity, 'error');
  });

  it('flags as any casts', async () => {
    const diff = [
      'diff --git a/src/thing.ts b/src/thing.ts',
      '--- a/src/thing.ts',
      '+++ b/src/thing.ts',
      '@@ -1,3 +1,3 @@',
      '-const x: User = getUser();',
      '+const x = getUser() as any;',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'any-cast-added');
    assert.ok(failure, 'expected any-cast-added failure');
    assert.strictEqual(failure.severity, 'warning');
  });

  it('flags eslint-disable inline suppressions', async () => {
    const diff = [
      'diff --git a/src/file.js b/src/file.js',
      '--- a/src/file.js',
      '+++ b/src/file.js',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      '+// eslint-disable-next-line no-unused-vars',
      ' const y = 2;',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failure = findFailure(result, 'eslint-disable-added');
    assert.ok(failure, 'expected eslint-disable-added failure');
  });

  it('passes clean on a real fix (logic change with no anti-patterns)', async () => {
    const diff = [
      'diff --git a/src/math.js b/src/math.js',
      '--- a/src/math.js',
      '+++ b/src/math.js',
      '@@ -1,3 +1,3 @@',
      ' function average(nums) {',
      '-  return nums.reduce((a, b) => a + b) / nums.length;',
      '+  if (nums.length === 0) return 0;',
      '+  return nums.reduce((a, b) => a + b, 0) / nums.length;',
      ' }',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    const failures = failedCheckNames(result);
    assert.strictEqual(failures.length, 0, `expected no failures, got: ${failures.join(', ')}`);

    const cleanCheck = result.checks.find(c => c.name === 'fake-fix:clean');
    assert.ok(cleanCheck, 'expected fake-fix:clean check when no issues found');
  });

  it('reports a no-diff info check when diff is empty', async () => {
    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(''));

    const noDiff = result.checks.find(c => c.name === 'fake-fix:no-diff');
    assert.ok(noDiff, 'expected fake-fix:no-diff check');
    assert.strictEqual(noDiff.severity, 'info');
  });

  it('can detect multiple anti-patterns in a single diff', async () => {
    const diff = [
      'diff --git a/src/handler.js b/src/handler.js',
      '--- a/src/handler.js',
      '+++ b/src/handler.js',
      '@@ -1,5 +1,6 @@',
      ' async function handle(req) {',
      '-  const user = await db.getUser(req.id);',
      '+  try { const user = await db.getUser(req.id); } catch (err) { }',
      '+  // @ts-ignore',
      '   return { ok: true };',
      ' }',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff));

    assert.ok(findFailure(result, 'empty-catch'), 'expected empty-catch');
    assert.ok(findFailure(result, 'ts-ignore-added'), 'expected ts-ignore-added');
  });

  it('respects patternEngine: false config', async () => {
    const diff = [
      'diff --git a/a.js b/a.js',
      '--- a/a.js',
      '+++ b/a.js',
      '@@ -1,1 +1,1 @@',
      '+it.skip("x", () => {})',
    ].join('\n');

    const mod = new FakeFixDetector();
    const result = new TestResult('fakeFixDetector');
    result.start();

    await mod.run(result, makeConfig(diff, { patternEngine: false, aiEngine: false }));

    const failures = failedCheckNames(result);
    assert.strictEqual(failures.length, 0, 'pattern engine disabled should produce no failures');
  });

  it('exposes PATTERN_RULES for inspection', () => {
    assert.ok(Array.isArray(FakeFixDetector.PATTERN_RULES));
    assert.ok(FakeFixDetector.PATTERN_RULES.length >= 10);
    for (const rule of FakeFixDetector.PATTERN_RULES) {
      assert.ok(rule.id, 'rule must have id');
      assert.ok(['error', 'warning', 'info'].includes(rule.severity), 'valid severity');
      assert.ok(rule.title, 'rule must have title');
    }
  });
});
