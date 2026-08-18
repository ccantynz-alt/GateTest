const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PythonModule = require('../src/modules/python');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('PythonModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-py-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new PythonModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new PythonModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

describe('PythonModule — exec/eval are builtins, not methods (2026-08-18 audit)', () => {
  const { LANGUAGE_SPECS } = require('../src/core/universal-checker');
  const rule = (n) => LANGUAGE_SPECS.python.patterns.find((p) => p.name === n).pattern;
  it('does not flag SQLModel `session.exec(select(...))` or `cursor.exec(`', () => {
    assert.strictEqual(rule('exec').test('    results = session.exec(select(Hero)).all()'), false);
    assert.strictEqual(rule('exec').test('    cursor.exec(query)'), false);
    assert.strictEqual(rule('eval').test('    node.eval(ctx)'), false);
  });
  it('POSITIVE CONTROL: the real builtins still fire', () => {
    assert.strictEqual(rule('exec').test('    exec(compile(code, name, "exec"))'), true);
    assert.strictEqual(rule('eval').test('    return eval(expr)'), true);
  });
});
