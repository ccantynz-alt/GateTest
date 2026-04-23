const { describe, it } = require('node:test');
const assert = require('node:assert');

const E2eModule = require('../src/modules/e2e');

describe('E2eModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new E2eModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});
