const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { GateTestRunner, TestResult, Severity } = require('../src/core/runner');
const { GateTestConfig } = require('../src/core/config');

describe('TestResult', () => {
  it('should track check pass/fail', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addCheck('check-1', true);
    result.addCheck('check-2', false, { message: 'failed' });
    result.addCheck('check-3', true);

    assert.strictEqual(result.passedChecks.length, 2);
    assert.strictEqual(result.failedChecks.length, 1);
    assert.strictEqual(result.failedChecks[0].name, 'check-2');
  });

  it('should calculate duration', () => {
    const result = new TestResult('test-module');
    result.start();
    result.pass();
    assert.ok(result.duration >= 0);
    assert.strictEqual(result.status, 'passed');
  });

  it('should serialize to JSON', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addCheck('check-1', true);
    result.pass();

    const json = result.toJSON();
    assert.strictEqual(json.module, 'test-module');
    assert.strictEqual(json.status, 'passed');
    assert.strictEqual(json.totalChecks, 1);
    assert.strictEqual(json.passedChecks, 1);
    assert.strictEqual(json.failedChecks, 0);
  });

  it('should track severity levels', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addCheck('err', false, { severity: 'error' });
    result.addCheck('warn', false, { severity: 'warning' });
    result.addCheck('info', true, { severity: 'info' });

    assert.strictEqual(result.errorChecks.length, 1);
    assert.strictEqual(result.warningChecks.length, 1);
    assert.strictEqual(result.infoChecks.length, 1);
    assert.strictEqual(result.failedChecks.length, 2);
  });

  it('should default failed checks to error severity', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addCheck('fail-no-severity', false, { message: 'oops' });

    assert.strictEqual(result.errorChecks.length, 1);
    assert.strictEqual(result.errorChecks[0].severity, 'error');
  });

  it('should track auto-fixes', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addFix('check-1', 'Fixed trailing whitespace', ['src/foo.js']);

    assert.strictEqual(result.fixes.length, 1);
    assert.strictEqual(result.fixes[0].check, 'check-1');
    assert.strictEqual(result.fixes[0].filesChanged.length, 1);

    const json = result.toJSON();
    assert.strictEqual(json.fixes, 1);
    assert.strictEqual(json.appliedFixes.length, 1);
  });

  it('should include errors/warnings/fixes in JSON serialization', () => {
    const result = new TestResult('test-module');
    result.start();
    result.addCheck('err', false, { severity: 'error' });
    result.addCheck('warn', false, { severity: 'warning' });
    result.addCheck('ok', true);
    result.addFix('err', 'auto-fixed', []);
    result.pass();

    const json = result.toJSON();
    assert.strictEqual(json.errors, 1);
    assert.strictEqual(json.warnings, 1);
    assert.strictEqual(json.fixes, 1);
  });
});

describe('Severity', () => {
  it('should export severity constants', () => {
    assert.strictEqual(Severity.ERROR, 'error');
    assert.strictEqual(Severity.WARNING, 'warning');
    assert.strictEqual(Severity.INFO, 'info');
  });
});

describe('GateTestRunner', () => {
  it('should run registered modules', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    runner.register('mock', {
      async run(result) {
        result.addCheck('mock-check', true, { message: 'ok' });
      },
    });

    const summary = await runner.run(['mock']);
    assert.strictEqual(summary.gateStatus, 'PASSED');
    assert.strictEqual(summary.modules.passed, 1);
    assert.strictEqual(summary.modules.failed, 0);
  });

  it('should block gate on failure', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    runner.register('failing', {
      async run(result) {
        result.addCheck('bad-check', false, { message: 'something broke' });
      },
    });

    const summary = await runner.run(['failing']);
    assert.strictEqual(summary.gateStatus, 'BLOCKED');
    assert.strictEqual(summary.modules.failed, 1);
    assert.strictEqual(summary.checks.failed, 1);
  });

  it('should skip unregistered modules', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    const summary = await runner.run(['nonexistent']);
    assert.strictEqual(summary.modules.skipped, 1);
  });

  it('should handle module errors gracefully', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    runner.register('crashing', {
      async run() {
        throw new Error('Module exploded');
      },
    });

    const summary = await runner.run(['crashing']);
    assert.strictEqual(summary.gateStatus, 'BLOCKED');
    assert.strictEqual(summary.modules.failed, 1);
  });

  it('should pass gate when only warnings exist (no errors)', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    runner.register('warns', {
      async run(result) {
        result.addCheck('warning-check', false, { severity: 'warning', message: 'just a warning' });
        result.addCheck('ok-check', true);
      },
    });

    const summary = await runner.run(['warns']);
    assert.strictEqual(summary.gateStatus, 'PASSED');
    assert.strictEqual(summary.checks.warnings, 1);
    assert.strictEqual(summary.checks.errors, 0);
  });

  it('should block gate when errors exist alongside warnings', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    runner.register('mixed', {
      async run(result) {
        result.addCheck('warn', false, { severity: 'warning' });
        result.addCheck('err', false, { severity: 'error' });
      },
    });

    const summary = await runner.run(['mixed']);
    assert.strictEqual(summary.gateStatus, 'BLOCKED');
    assert.strictEqual(summary.checks.errors, 1);
    assert.strictEqual(summary.checks.warnings, 1);
  });

  it('should run modules in parallel when enabled', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config, { parallel: true });
    const order = [];

    runner.register('a', {
      async run(result) {
        order.push('a');
        result.addCheck('a', true);
      },
    });
    runner.register('b', {
      async run(result) {
        order.push('b');
        result.addCheck('b', true);
      },
    });

    const summary = await runner.run(['a', 'b']);
    assert.strictEqual(summary.gateStatus, 'PASSED');
    assert.strictEqual(summary.modules.passed, 2);
  });

  it('should stop on first failure when enabled', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config, { stopOnFirstFailure: true });

    runner.register('fail', {
      async run(result) {
        result.addCheck('x', false, { severity: 'error' });
      },
    });
    runner.register('skip', {
      async run(result) {
        result.addCheck('y', true);
      },
    });

    const summary = await runner.run(['fail', 'skip']);
    assert.strictEqual(summary.modules.failed, 1);
    assert.strictEqual(summary.modules.total, 1);
  });

  it('should run auto-fixes when enabled', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config, { autoFix: true });
    let fixRan = false;

    runner.register('fixable', {
      async run(result) {
        result.addCheck('fixme', false, {
          severity: 'error',
          autoFix: async () => {
            fixRan = true;
            return { fixed: true, description: 'Auto-fixed the issue' };
          },
        });
      },
    });

    const summary = await runner.run(['fixable']);
    assert.strictEqual(fixRan, true);
    assert.strictEqual(summary.fixes.total, 1);
    // After fix, the module should pass
    assert.strictEqual(summary.gateStatus, 'PASSED');
  });

  it('should include diff metadata in summary', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config, {
      diffOnly: true,
      changedFiles: ['src/index.js', 'src/core/runner.js'],
    });

    runner.register('noop', {
      async run(result) {
        result.addCheck('ok', true);
      },
    });

    const summary = await runner.run(['noop']);
    assert.strictEqual(summary.diffOnly, true);
    assert.deepStrictEqual(summary.changedFiles, ['src/index.js', 'src/core/runner.js']);
  });

  it('should report fix details in summary', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config, { autoFix: true });

    runner.register('fixable', {
      async run(result) {
        result.addCheck('fix1', false, {
          severity: 'error',
          autoFix: async () => ({ fixed: true, description: 'Removed trailing space', filesChanged: ['a.js'] }),
        });
        result.addCheck('fix2', false, {
          severity: 'error',
          autoFix: async () => ({ fixed: true, description: 'Added semicolon', filesChanged: ['b.js'] }),
        });
      },
    });

    const summary = await runner.run(['fixable']);
    assert.strictEqual(summary.fixes.total, 2);
    assert.strictEqual(summary.fixes.details.length, 2);
  });
});
