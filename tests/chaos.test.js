const { describe, it } = require('node:test');
const assert = require('node:assert');

const ChaosModule = require('../src/modules/chaos');

describe('ChaosModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new ChaosModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});
