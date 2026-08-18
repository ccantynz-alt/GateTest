const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RubyModule = require('../src/modules/ruby');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('RubyModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ruby-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new RubyModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new RubyModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

describe('RubyModule — eval rule targets non-literal arguments (2026-08-18 audit)', () => {
  const { LANGUAGE_SPECS } = require('../src/core/universal-checker');
  const rule = LANGUAGE_SPECS.ruby.patterns.find((p) => p.name === 'eval').pattern;
  it('eval of a STRING LITERAL is the safe form and is not flagged', () => {
    assert.strictEqual(rule.test(`  buf = binding.eval('@_out_buf')`), false);
    assert.strictEqual(rule.test(`  eval("1 + 1")`), false);
  });
  it('POSITIVE CONTROL: eval of a variable / expression fires', () => {
    assert.strictEqual(rule.test(`  eval(params[:code])`), true);
    assert.strictEqual(rule.test(`  instance_eval user_input`), true);
  });
});
