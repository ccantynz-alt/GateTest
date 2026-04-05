const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

const { GateTestConfig } = require('../src/core/config');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-report-'));
}

function makeSummary(gateStatus = 'PASSED') {
  return {
    gateStatus,
    timestamp: new Date().toISOString(),
    duration: 123,
    modules: { total: 2, passed: gateStatus === 'PASSED' ? 2 : 1, failed: gateStatus === 'PASSED' ? 0 : 1, skipped: 0 },
    checks: { total: 5, passed: gateStatus === 'PASSED' ? 5 : 3, failed: gateStatus === 'PASSED' ? 0 : 2 },
    results: [
      { module: 'syntax', status: 'passed', duration: 50, totalChecks: 3, passedChecks: 3, failedChecks: 0, checks: [], error: null },
      {
        module: 'security',
        status: gateStatus === 'PASSED' ? 'passed' : 'failed',
        duration: 73,
        totalChecks: 2,
        passedChecks: gateStatus === 'PASSED' ? 2 : 1,
        failedChecks: gateStatus === 'PASSED' ? 0 : 1,
        checks: [],
        error: gateStatus === 'PASSED' ? null : '1 check(s) failed',
      },
    ],
    failedModules: gateStatus === 'PASSED' ? [] : [{ module: 'security', error: '1 check(s) failed', failedChecks: [] }],
  };
}

// ─── Console Reporter ────────────────────────────────────────────

describe('ConsoleReporter', () => {
  it('should attach to runner events', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    const reporter = new ConsoleReporter(runner);
    assert.ok(reporter.runner === runner);
    assert.ok(runner.listenerCount('suite:start') > 0);
    assert.ok(runner.listenerCount('module:start') > 0);
    assert.ok(runner.listenerCount('module:end') > 0);
    assert.ok(runner.listenerCount('suite:end') > 0);
  });

  it('should handle suite:start event', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    // Should not throw
    runner.emit('suite:start', { modules: ['syntax', 'security'] });
  });

  it('should handle suite:end with PASSED', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    runner.emit('suite:end', makeSummary('PASSED'));
  });

  it('should handle suite:end with BLOCKED', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    runner.emit('suite:end', makeSummary('BLOCKED'));
  });

  it('should handle module:end with passed result', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    runner.emit('module:end', {
      status: 'passed',
      module: 'syntax',
      checks: [{ name: 'check1', passed: true }],
      failedChecks: [],
      duration: 50,
    });
  });

  it('should handle module:end with failed result', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    runner.emit('module:end', {
      status: 'failed',
      module: 'security',
      checks: [{ name: 'check1', passed: false, file: 'app.js', line: 1, suggestion: 'Fix it' }],
      failedChecks: [{ name: 'check1', passed: false, file: 'app.js', line: 1, expected: 'no eval', actual: 'eval found', suggestion: 'Fix it' }],
      duration: 73,
    });
  });

  it('should handle module:skip event', () => {
    const { ConsoleReporter } = require('../src/reporters/console-reporter');
    const runner = new EventEmitter();
    new ConsoleReporter(runner);
    runner.emit('module:skip', { module: 'e2e', error: 'Not registered' });
  });
});

// ─── JSON Reporter ───────────────────────────────────────────────

describe('JsonReporter', () => {
  it('should write JSON report on suite:end', () => {
    const { JsonReporter } = require('../src/reporters/json-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new JsonReporter(runner, config);
    runner.emit('suite:end', makeSummary('PASSED'));

    const reportDir = path.join(tmpDir, 'reports');
    assert.ok(fs.existsSync(reportDir));

    const latestPath = path.join(reportDir, 'gatetest-report-latest.json');
    assert.ok(fs.existsSync(latestPath));

    const report = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
    assert.strictEqual(report.gatetest.gateStatus, 'PASSED');
    assert.strictEqual(report.gatetest.version, '1.0.0');
    assert.strictEqual(report.summary.modules.total, 2);
  });

  it('should write timestamped report file', () => {
    const { JsonReporter } = require('../src/reporters/json-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new JsonReporter(runner, config);
    runner.emit('suite:end', makeSummary('BLOCKED'));

    const reportDir = path.join(tmpDir, 'reports');
    const files = fs.readdirSync(reportDir);
    const timestamped = files.filter(f => f.startsWith('gatetest-report-') && f !== 'gatetest-report-latest.json');
    assert.ok(timestamped.length > 0);
  });

  it('should include failures in report', () => {
    const { JsonReporter } = require('../src/reporters/json-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new JsonReporter(runner, config);
    runner.emit('suite:end', makeSummary('BLOCKED'));

    const latestPath = path.join(tmpDir, 'reports', 'gatetest-report-latest.json');
    const report = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
    assert.strictEqual(report.gatetest.gateStatus, 'BLOCKED');
    assert.ok(report.failures.length > 0);
  });
});

// ─── HTML Reporter ───────────────────────────────────────────────

describe('HtmlReporter', () => {
  it('should write HTML report on suite:end', () => {
    const { HtmlReporter } = require('../src/reporters/html-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new HtmlReporter(runner, config);
    runner.emit('suite:end', makeSummary('PASSED'));

    const latestPath = path.join(tmpDir, 'reports', 'gatetest-report-latest.html');
    assert.ok(fs.existsSync(latestPath));

    const html = fs.readFileSync(latestPath, 'utf-8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('GATE: PASSED'));
    assert.ok(html.includes('GateTest Quality Report'));
  });

  it('should show BLOCKED status in HTML', () => {
    const { HtmlReporter } = require('../src/reporters/html-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new HtmlReporter(runner, config);
    runner.emit('suite:end', makeSummary('BLOCKED'));

    const latestPath = path.join(tmpDir, 'reports', 'gatetest-report-latest.html');
    const html = fs.readFileSync(latestPath, 'utf-8');
    assert.ok(html.includes('GATE: BLOCKED'));
    assert.ok(html.includes('#ef4444')); // red color
  });

  it('should include module rows in HTML', () => {
    const { HtmlReporter } = require('../src/reporters/html-reporter');
    const runner = new EventEmitter();
    const tmpDir = makeTmpDir();
    const config = new GateTestConfig(tmpDir);
    config.config.reporting = { outputDir: path.join(tmpDir, 'reports') };

    new HtmlReporter(runner, config);
    runner.emit('suite:end', makeSummary('PASSED'));

    const latestPath = path.join(tmpDir, 'reports', 'gatetest-report-latest.html');
    const html = fs.readFileSync(latestPath, 'utf-8');
    assert.ok(html.includes('syntax'));
    assert.ok(html.includes('security'));
  });
});
