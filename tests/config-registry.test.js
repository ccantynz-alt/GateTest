const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { GateTestConfig, DEFAULT_CONFIG } = require('../src/core/config');
const { ModuleRegistry, BUILT_IN_MODULES } = require('../src/core/registry');

function makeTmpDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-cfg-'));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

// ─── GateTestConfig ──────────────────────────────────────────────

describe('GateTestConfig', () => {
  it('should load default config when no config file exists', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    assert.strictEqual(config.projectRoot, dir);
    assert.ok(config.config.thresholds);
    assert.strictEqual(config.config.thresholds.unitTestCoverage, 90);
  });

  it('should merge file config over defaults', () => {
    const dir = makeTmpDir({
      '.gatetest/config.json': JSON.stringify({
        thresholds: { unitTestCoverage: 95 },
      }),
    });
    const config = new GateTestConfig(dir);
    assert.strictEqual(config.config.thresholds.unitTestCoverage, 95);
    // Other defaults should still exist
    assert.strictEqual(config.config.thresholds.lighthousePerformance, 95);
  });

  it('should get nested values with keyPath', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    assert.strictEqual(config.get('thresholds.unitTestCoverage'), 90);
    assert.strictEqual(config.get('gate.blockOnFailure'), true);
    assert.strictEqual(config.get('nonexistent.path'), undefined);
  });

  it('should get thresholds by name', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    assert.strictEqual(config.getThreshold('maxBundleSizeJs'), 200 * 1024);
    assert.strictEqual(config.getThreshold('maxCls'), 0.05);
  });

  it('should get module config', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    const secConfig = config.getModuleConfig('security');
    assert.ok(secConfig.scanHeaders);
    assert.ok(secConfig.secretPatterns.length > 0);
  });

  it('should return empty object for unknown modules', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    const unknown = config.getModuleConfig('nonexistent');
    assert.deepStrictEqual(unknown, {});
  });

  it('should get suite configuration', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    const quick = config.getSuite('quick');
    assert.ok(quick.includes('syntax'));
    assert.ok(quick.includes('secrets'));
    assert.ok(!quick.includes('e2e'));
  });

  it('should return standard suite for unknown suite names', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    const unknown = config.getSuite('nonexistent');
    assert.deepStrictEqual(unknown, config.config.suites.standard);
  });

  it('should handle malformed config file gracefully', () => {
    const dir = makeTmpDir({
      '.gatetest/config.json': 'not valid json{{{',
    });
    const config = new GateTestConfig(dir);
    // Should fallback to defaults
    assert.strictEqual(config.config.thresholds.unitTestCoverage, 90);
  });

  it('should save config to file', () => {
    const dir = makeTmpDir();
    const config = new GateTestConfig(dir);
    config.save();
    const savedPath = path.join(dir, '.gatetest', 'config.json');
    assert.ok(fs.existsSync(savedPath));
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf-8'));
    assert.ok(saved.thresholds);
  });
});

// ─── DEFAULT_CONFIG ──────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('should have all required suites', () => {
    assert.ok(DEFAULT_CONFIG.suites.quick);
    assert.ok(DEFAULT_CONFIG.suites.standard);
    assert.ok(DEFAULT_CONFIG.suites.full);
  });

  it('should have full suite with all modules', () => {
    const full = DEFAULT_CONFIG.suites.full;
    assert.ok(full.includes('syntax'));
    assert.ok(full.includes('security'));
    assert.ok(full.includes('accessibility'));
    assert.ok(full.includes('performance'));
    assert.ok(full.includes('seo'));
    assert.ok(full.length >= 16);
  });
});

// ─── ModuleRegistry ──────────────────────────────────────────────

describe('ModuleRegistry', () => {
  it('should load built-in modules', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();
    const list = registry.list();
    assert.ok(list.includes('syntax'));
    assert.ok(list.includes('secrets'));
    assert.ok(list.includes('security'));
    assert.ok(list.includes('accessibility'));
    assert.ok(list.length >= 10);
  });

  it('should get a specific module', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();
    const syntax = registry.get('syntax');
    assert.ok(syntax);
    assert.strictEqual(syntax.name, 'syntax');
  });

  it('should return undefined for unknown module', () => {
    const registry = new ModuleRegistry();
    assert.strictEqual(registry.get('nonexistent'), undefined);
  });

  it('should return all modules as Map', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();
    const all = registry.getAll();
    assert.ok(all instanceof Map);
    assert.ok(all.size >= 10);
  });

  it('should load custom modules from directory', () => {
    const dir = makeTmpDir({
      'modules/custom-check.js': `
        const BaseModule = require('${path.resolve(__dirname, '../src/modules/base-module').replace(/\\/g, '\\\\')}');
        class CustomCheck extends BaseModule {
          constructor() { super('custom-check', 'Custom Check'); }
          async run(result) { result.addCheck('custom', true); }
        }
        module.exports = CustomCheck;
      `,
    });
    const registry = new ModuleRegistry();
    registry.loadCustom(path.join(dir, 'modules'));
    assert.ok(registry.get('custom-check'));
  });

  it('should handle nonexistent custom modules directory', () => {
    const registry = new ModuleRegistry();
    registry.loadCustom('/nonexistent/path');
    assert.strictEqual(registry.list().length, 0);
  });
});

// ─── BUILT_IN_MODULES ────────────────────────────────────────────

describe('BUILT_IN_MODULES', () => {
  it('should have correct module paths', () => {
    assert.ok(BUILT_IN_MODULES.syntax.endsWith('syntax.js'));
    assert.ok(BUILT_IN_MODULES.secrets.endsWith('secrets.js'));
    assert.ok(BUILT_IN_MODULES.security.endsWith('security.js'));
  });
});
