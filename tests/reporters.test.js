const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { GateTestRunner, TestResult } = require('../src/core/runner');
const { GateTestConfig } = require('../src/core/config');
const { SarifReporter } = require('../src/reporters/sarif-reporter');
const { JunitReporter } = require('../src/reporters/junit-reporter');

describe('SarifReporter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-sarif-'));
    fs.mkdirSync(path.join(tmpDir, '.gatetest', 'reports'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate valid SARIF 2.1.0 output', async () => {
    const config = new GateTestConfig(tmpDir);
    const runner = new GateTestRunner(config);
    new SarifReporter(runner, config);

    runner.register('test-mod', {
      async run(result) {
        result.addCheck('pass-check', true);
        result.addCheck('fail-check', false, {
          severity: 'error',
          file: 'src/index.js',
          line: 42,
          message: 'Found a bug',
          suggestion: 'Fix the bug',
        });
        result.addCheck('warn-check', false, {
          severity: 'warning',
          message: 'Minor issue',
        });
      },
    });

    await runner.run(['test-mod']);

    const sarifPath = path.join(tmpDir, '.gatetest', 'reports', 'gatetest-results.sarif');
    assert.ok(fs.existsSync(sarifPath), 'SARIF file should exist');

    const sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf-8'));
    assert.strictEqual(sarif.version, '2.1.0');
    assert.strictEqual(sarif.runs.length, 1);
    assert.strictEqual(sarif.runs[0].tool.driver.name, 'GateTest');
    assert.ok(sarif.runs[0].results.length >= 2, 'Should have at least 2 results (failures)');

    // Check that error levels are mapped correctly
    const errorResult = sarif.runs[0].results.find(r => r.level === 'error');
    assert.ok(errorResult, 'Should have an error-level result');

    const warningResult = sarif.runs[0].results.find(r => r.level === 'warning');
    assert.ok(warningResult, 'Should have a warning-level result');
  });

  it('should include file locations in SARIF', async () => {
    const config = new GateTestConfig(tmpDir);
    const runner = new GateTestRunner(config);
    new SarifReporter(runner, config);

    runner.register('loc-mod', {
      async run(result) {
        result.addCheck('located', false, {
          severity: 'error',
          file: 'src/main.js',
          line: 10,
          message: 'Issue here',
        });
      },
    });

    await runner.run(['loc-mod']);

    const sarif = JSON.parse(fs.readFileSync(
      path.join(tmpDir, '.gatetest', 'reports', 'gatetest-results.sarif'), 'utf-8'
    ));

    const result = sarif.runs[0].results[0];
    assert.ok(result.locations, 'Should have locations');
    assert.strictEqual(result.locations[0].physicalLocation.artifactLocation.uri, 'src/main.js');
    assert.strictEqual(result.locations[0].physicalLocation.region.startLine, 10);
  });
});

describe('JunitReporter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-junit-'));
    fs.mkdirSync(path.join(tmpDir, '.gatetest', 'reports'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate valid JUnit XML', async () => {
    const config = new GateTestConfig(tmpDir);
    const runner = new GateTestRunner(config);
    new JunitReporter(runner, config);

    runner.register('junit-mod', {
      async run(result) {
        result.addCheck('pass', true);
        result.addCheck('fail', false, {
          severity: 'error',
          message: 'Something broke',
          file: 'test.js',
          suggestion: 'Fix it',
        });
      },
    });

    await runner.run(['junit-mod']);

    const xmlPath = path.join(tmpDir, '.gatetest', 'reports', 'gatetest-results.xml');
    assert.ok(fs.existsSync(xmlPath), 'JUnit XML file should exist');

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.startsWith('<?xml'), 'Should start with XML declaration');
    assert.ok(xml.includes('<testsuites'), 'Should have testsuites element');
    assert.ok(xml.includes('<testsuite'), 'Should have testsuite element');
    assert.ok(xml.includes('<testcase'), 'Should have testcase elements');
    assert.ok(xml.includes('<failure'), 'Should have failure element');
    assert.ok(xml.includes('Something broke'), 'Should include error message');
  });

  it('should escape XML special characters', async () => {
    const config = new GateTestConfig(tmpDir);
    const runner = new GateTestRunner(config);
    new JunitReporter(runner, config);

    runner.register('escape-mod', {
      async run(result) {
        result.addCheck('xml-chars', false, {
          severity: 'error',
          message: 'Value < 5 && > 0 with "quotes"',
        });
      },
    });

    await runner.run(['escape-mod']);

    const xml = fs.readFileSync(
      path.join(tmpDir, '.gatetest', 'reports', 'gatetest-results.xml'), 'utf-8'
    );
    assert.ok(xml.includes('&lt;'), 'Should escape <');
    assert.ok(xml.includes('&amp;'), 'Should escape &');
    assert.ok(xml.includes('&quot;'), 'Should escape "');
  });
});
