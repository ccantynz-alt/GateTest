const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { ModuleRegistry, BUILT_IN_MODULES } = require('../src/core/registry');

describe('BUILT_IN_MODULES', () => {
  it('should map module names to file paths', () => {
    assert.ok(BUILT_IN_MODULES.syntax);
    assert.ok(BUILT_IN_MODULES.security);
    assert.ok(BUILT_IN_MODULES.links);
    assert.ok(BUILT_IN_MODULES.lint);
    assert.ok(BUILT_IN_MODULES.codeQuality);
    assert.ok(BUILT_IN_MODULES.liveCrawler);
  });

  it('should have at least 15 built-in modules', () => {
    const count = Object.keys(BUILT_IN_MODULES).length;
    assert.ok(count >= 15, `Expected >= 15 modules, got ${count}`);
  });
});

describe('ModuleRegistry', () => {
  it('should start with empty registry', () => {
    const registry = new ModuleRegistry();
    assert.strictEqual(registry.list().length, 0);
    assert.strictEqual(registry.get('syntax'), undefined);
  });

  it('should load built-in modules', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();

    const modules = registry.list();
    assert.ok(modules.length > 0, 'Should have loaded some modules');
    assert.ok(modules.includes('syntax'), 'Should include syntax module');
  });

  it('should return module instances', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();

    const syntax = registry.get('syntax');
    assert.ok(syntax, 'Syntax module should exist');
    assert.ok(typeof syntax.run === 'function', 'Module should have run() method');
  });

  it('should return all modules as a Map', () => {
    const registry = new ModuleRegistry();
    registry.loadBuiltIn();

    const all = registry.getAll();
    assert.ok(all instanceof Map);
    assert.ok(all.size > 0);
  });

  it('should handle missing custom modules dir gracefully', () => {
    const registry = new ModuleRegistry();
    // Should not throw
    registry.loadCustom('/nonexistent/path/modules');
    assert.strictEqual(registry.list().length, 0);
  });

  it('should chain loadBuiltIn and loadCustom', () => {
    const registry = new ModuleRegistry();
    const result = registry.loadBuiltIn();
    assert.strictEqual(result, registry); // Returns this for chaining
  });

  it('should return undefined for unregistered module', () => {
    const registry = new ModuleRegistry();
    assert.strictEqual(registry.get('nonexistent'), undefined);
  });
});
