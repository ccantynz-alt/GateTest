const { describe, it } = require('node:test');
const assert = require('node:assert');

const LiveCrawlerModule = require('../src/modules/live-crawler');

describe('LiveCrawlerModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new LiveCrawlerModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});
