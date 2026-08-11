/**
 * Blocking-severity calibration — the "do not cry wolf" suite.
 *
 * Neutral-repo audit 2026-08-12: scanning expressjs/express (green CI
 * upstream, no secret-like files anywhere) produced FIVE findings that blocked
 * the gate, and all five were noise:
 *
 *   - 3x `.gitignore missing pattern` for files the repo does not contain
 *   - 1x `Unit tests failed` because node_modules wasn't installed
 *   - 1x `ESLint crashed` because our fallback ESLint 9 couldn't read that
 *        repo's legacy .eslintrc.yml
 *
 * A gate whose every blocking line is noise teaches the customer to bypass the
 * gate. That is the single most damaging failure mode this product has
 * (Forbidden #25 — we are the painkiller, not the bottleneck).
 *
 * Each test below pairs the downgrade with a NEGATIVE CONTROL asserting the
 * error still fires when the risk is real. Without those, "we stopped
 * blocking" is indistinguishable from "we stopped detecting".
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SecretsModule = require('../src/modules/secrets');
const UnitTestsModule = require('../src/modules/unit-tests');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

const find = (result, name) => result.checks.find(c => c.name === name);

describe('secrets: .gitignore pattern severity tracks real exposure', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-gitignore-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns (does not block) when the pattern is missing but no such file exists', async () => {
    // The express case: a .gitignore that omits .env, in a repo with no .env.
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(tmp, 'index.js'), 'module.exports = 1;\n');

    const result = makeResult();
    await new SecretsModule().run(result, { projectRoot: tmp });

    const check = find(result, 'secrets:gitignore-.env');
    assert.ok(check, 'the advisory should still be reported');
    assert.strictEqual(check.passed, false);
    assert.strictEqual(check.severity, 'warning', 'must not block a repo that has no .env to leak');
  });

  it('NEGATIVE CONTROL: still errors when a matching file really is present', async () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(tmp, '.env'), 'API_KEY=abc123\n');

    const result = makeResult();
    await new SecretsModule().run(result, { projectRoot: tmp });

    const check = find(result, 'secrets:gitignore-.env');
    assert.ok(check);
    assert.strictEqual(check.severity, 'error', 'an unignored .env on disk is a live exposure and must block');
    assert.match(check.message, /matching file exists/);
  });

  it('NEGATIVE CONTROL: finds a matching file in a nested directory', async () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(tmp, 'config', 'certs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'certs', 'server.pem'), 'x\n');

    const result = makeResult();
    await new SecretsModule().run(result, { projectRoot: tmp });

    assert.strictEqual(find(result, 'secrets:gitignore-*.pem').severity, 'error');
  });

  it('ignores matches inside node_modules — a dependency\'s fixture is not our exposure', async () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), '');
    fs.mkdirSync(path.join(tmp, 'node_modules', 'some-pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules', 'some-pkg', 'test.key'), 'x\n');

    const result = makeResult();
    await new SecretsModule().run(result, { projectRoot: tmp });

    assert.strictEqual(find(result, 'secrets:gitignore-*.key').severity, 'warning');
  });

  it('treats .env.local as covered by the .env pattern', async () => {
    fs.writeFileSync(path.join(tmp, '.gitignore'), '');
    fs.writeFileSync(path.join(tmp, '.env.local'), 'SECRET=1\n');

    const result = makeResult();
    await new SecretsModule().run(result, { projectRoot: tmp });

    assert.strictEqual(find(result, 'secrets:gitignore-.env').severity, 'error');
  });
});

describe('unitTests: an uninstalled dependency tree is not a failing test suite', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-unit-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips with info when deps are declared but node_modules is absent', async () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { test: 'mocha' },
      devDependencies: { mocha: '^10.0.0' },
    }));

    const result = makeResult();
    await new UnitTestsModule().run(result, { projectRoot: tmp });

    const run = find(result, 'unit-tests:run');
    assert.ok(run, 'the check should still be reported, not silently dropped');
    assert.strictEqual(run.passed, true, 'must not fail the customer for our scan environment');
    assert.strictEqual(run.severity, 'info');
    assert.match(run.message, /dependencies are not installed/i);
  });

  it('NEGATIVE CONTROL: a project with no declared deps is still actually run', async () => {
    // No dependencies to install, so absence of node_modules proves nothing —
    // the suite must genuinely execute and its real failure must surface.
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'x',
      scripts: { test: 'node -e "process.exit(1)"' },
    }));

    const result = makeResult();
    await new UnitTestsModule().run(result, { projectRoot: tmp });

    const run = find(result, 'unit-tests:run');
    assert.ok(run);
    assert.strictEqual(run.passed, false, 'a genuinely failing suite must still fail');
    assert.notStrictEqual(run.severity, 'info');
  });

  it('does not treat a non-Node project as uninstalled', () => {
    // A Python repo has no node_modules and never will; the guard must not
    // fire and suppress its pytest run.
    fs.writeFileSync(path.join(tmp, 'pytest.ini'), '[pytest]\n');
    assert.strictEqual(new UnitTestsModule()._dependenciesMissing(tmp), false);
  });

  it('does not fire when node_modules is present', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'x', devDependencies: { mocha: '^10.0.0' },
    }));
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    assert.strictEqual(new UnitTestsModule()._dependenciesMissing(tmp), false);
  });
});
