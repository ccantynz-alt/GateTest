const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { GateTestConfig, DEFAULT_CONFIG } = require('../src/core/config');

const TEST_ROOT = path.join(__dirname, '..', '.test-tmp-config');

function setup() {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function cleanup() {
  if (fs.existsSync(TEST_ROOT)) fs.rmSync(TEST_ROOT, { recursive: true });
}

describe('DEFAULT_CONFIG', () => {
  it('should have thresholds defined', () => {
    assert.ok(DEFAULT_CONFIG.thresholds);
    assert.strictEqual(DEFAULT_CONFIG.thresholds.unitTestCoverage, 90);
    assert.strictEqual(DEFAULT_CONFIG.thresholds.lighthousePerformance, 95);
    assert.strictEqual(DEFAULT_CONFIG.thresholds.maxBrokenLinks, 0);
  });

  it('should define all test suites', () => {
    assert.ok(DEFAULT_CONFIG.suites.quick);
    assert.ok(DEFAULT_CONFIG.suites.standard);
    assert.ok(DEFAULT_CONFIG.suites.full);
    assert.ok(DEFAULT_CONFIG.suites.live);
    assert.ok(DEFAULT_CONFIG.suites.nuclear);
  });

  it('should have nuclear suite include all modules', () => {
    assert.ok(DEFAULT_CONFIG.suites.nuclear.length > 15);
    assert.ok(DEFAULT_CONFIG.suites.nuclear.includes('syntax'));
    assert.ok(DEFAULT_CONFIG.suites.nuclear.includes('security'));
    assert.ok(DEFAULT_CONFIG.suites.nuclear.includes('liveCrawler'));
  });
});

describe('GateTestConfig', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should load defaults when no config file exists', () => {
    const config = new GateTestConfig(TEST_ROOT);
    assert.strictEqual(config.getThreshold('unitTestCoverage'), 90);
    assert.strictEqual(config.get('gate.blockOnFailure'), true);
  });

  it('should navigate deep paths with get()', () => {
    const config = new GateTestConfig(TEST_ROOT);

    assert.strictEqual(config.get('thresholds.maxFcp'), 1000);
    assert.strictEqual(config.get('modules.accessibility.standard'), 'WCAG2AAA');
    assert.strictEqual(config.get('reporting.outputDir'), '.gatetest/reports');
  });

  it('should return undefined for missing paths', () => {
    const config = new GateTestConfig(TEST_ROOT);

    assert.strictEqual(config.get('nonexistent.deep.path'), undefined);
    assert.strictEqual(config.get('thresholds.nonexistent'), undefined);
  });

  it('should return standard suite as fallback for unknown suite', () => {
    const config = new GateTestConfig(TEST_ROOT);
    const suite = config.getSuite('nonexistent');
    assert.deepStrictEqual(suite, DEFAULT_CONFIG.suites.standard);
  });

  it('should return correct suite by name', () => {
    const config = new GateTestConfig(TEST_ROOT);
    const quick = config.getSuite('quick');
    assert.deepStrictEqual(quick, DEFAULT_CONFIG.suites.quick);
    assert.ok(quick.includes('syntax'));
    assert.ok(!quick.includes('security'));
  });

  it('should return module config or empty object', () => {
    const config = new GateTestConfig(TEST_ROOT);

    const visualConfig = config.getModuleConfig('visual');
    assert.ok(visualConfig.viewports);
    assert.ok(visualConfig.viewports.length > 0);

    const unknownConfig = config.getModuleConfig('nonexistent');
    assert.deepStrictEqual(unknownConfig, {});
  });

  it('should merge file config over defaults', () => {
    // Write a config file that overrides some values
    const configDir = path.join(TEST_ROOT, '.gatetest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      thresholds: { unitTestCoverage: 95, customThreshold: 42 },
    }));

    const config = new GateTestConfig(TEST_ROOT);

    // Overridden value
    assert.strictEqual(config.getThreshold('unitTestCoverage'), 95);
    // Default value preserved
    assert.strictEqual(config.getThreshold('lighthousePerformance'), 95);
    // Custom value added
    assert.strictEqual(config.getThreshold('customThreshold'), 42);
  });

  it('should handle invalid JSON config gracefully', () => {
    const configDir = path.join(TEST_ROOT, '.gatetest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), 'not valid json{{{');

    // Should not throw — falls back to defaults
    const config = new GateTestConfig(TEST_ROOT);
    assert.strictEqual(config.getThreshold('unitTestCoverage'), 90);
  });

  it('should save config to file', () => {
    const config = new GateTestConfig(TEST_ROOT);
    config.save();

    const saved = JSON.parse(fs.readFileSync(config.configPath, 'utf-8'));
    assert.strictEqual(saved.thresholds.unitTestCoverage, 90);
    assert.ok(saved.suites.quick);
  });

  it('should deep merge arrays by replacement not concatenation', () => {
    const configDir = path.join(TEST_ROOT, '.gatetest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      suites: { quick: ['syntax'] },
    }));

    const config = new GateTestConfig(TEST_ROOT);
    assert.deepStrictEqual(config.getSuite('quick'), ['syntax']);
  });

  it('should deep merge nested objects', () => {
    const configDir = path.join(TEST_ROOT, '.gatetest');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      modules: { visual: { diffThreshold: 0.05 } },
    }));

    const config = new GateTestConfig(TEST_ROOT);
    const visual = config.getModuleConfig('visual');

    // Overridden
    assert.strictEqual(visual.diffThreshold, 0.05);
    // Default preserved (deep merge)
    assert.ok(visual.viewports);
    assert.ok(visual.viewports.length > 0);
  });
});
