const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { GateTestRunner, TestResult } = require('../src/core/runner');
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
});

describe('GateTestRunner', () => {
  it('should run registered modules', async () => {
    const config = new GateTestConfig(path.resolve(__dirname, '..'));
    const runner = new GateTestRunner(config);

    // Register a mock module
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
});
