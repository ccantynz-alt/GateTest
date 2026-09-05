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

// ─────────────────────────────────────────────────────────────────────────────
// Measured on django/django @b3f4d83 (2026-09-05), --suite full: 89 blocking.
// ─────────────────────────────────────────────────────────────────────────────
describe('PythonModule — django @b3f4d83', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-py-django-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function scan(rel, source) {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, source);
    const result = makeResult();
    await new PythonModule().run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && c.name.startsWith('python:'));
  }
  const rules = (found) => found.map((c) => c.name.split(':')[1]);

  it('`def eval(self, context)` is a definition, not a call to the builtin', async () => {
    // django/template/smartif.py:59 — expression nodes define an eval method.
    // Four of Django's eight real-source hits were definitions.
    const found = await scan('app/smartif.py', 'class Op:\n    def eval(self, context):\n        return True\n');
    assert.deepStrictEqual(rules(found).filter((r) => r === 'eval'), []);
  });

  it('a real eval call still fires', async () => {
    const found = await scan('app/q.py', 'return eval(code, {}, {"datetime": datetime})\n');
    assert.ok(rules(found).includes('eval'));
  });

  it('sql-concat inside a test tree is a warning, not an error', async () => {
    // tests/backends/tests.py — 30 of 39 sql-concat findings were the test
    // suite building the SQL it then asserts on.
    const found = await scan('tests/backends/tests.py',
      'cursor.execute("SELECT * FROM t WHERE id = " + str(pk))\n');
    const sc = found.find((c) => c.name.startsWith('python:sql-concat'));
    assert.ok(sc, 'still reported');
    assert.strictEqual(sc.severity, 'warning');
  });

  it('sql-concat in application code is still an error', async () => {
    const found = await scan('app/views.py', 'cursor.execute("SELECT * FROM t WHERE id = " + str(pk))\n');
    const sc = found.find((c) => c.name.startsWith('python:sql-concat'));
    assert.ok(sc); assert.strictEqual(sc.severity, 'error');
  });
});
