const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const UnitTestsModule = require('../src/modules/unit-tests');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('UnitTestsModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-unit-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new UnitTestsModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new UnitTestsModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

// ── environment honesty (2026-08-18 audit) ─────────────────────────────────
describe('UnitTestsModule — toolchain detection beyond Node', () => {
  const fs2 = require('node:fs');
  const os2 = require('node:os');
  const path2 = require('node:path');
  const withRepo = (files, fn) => {
    const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'gt-ut-'));
    try {
      for (const [rel, c] of Object.entries(files)) {
        fs2.mkdirSync(path2.dirname(path2.join(root, rel)), { recursive: true });
        fs2.writeFileSync(path2.join(root, rel), c);
      }
      return fn(root);
    } finally { fs2.rmSync(root, { recursive: true, force: true }); }
  };

  it('detects go / cargo / maven / gradle / rspec projects instead of "No test framework detected"', () => {
    const mod = new UnitTestsModule();
    assert.strictEqual(withRepo({ 'go.mod': 'module x', 'a_test.go': '' }, (r) => mod._detectTestCommand(r)).name, 'go test');
    assert.strictEqual(withRepo({ 'Cargo.toml': '[package]' }, (r) => mod._detectTestCommand(r)).name, 'cargo test');
    assert.strictEqual(withRepo({ 'pom.xml': '<project/>' }, (r) => mod._detectTestCommand(r)).name, 'Maven');
    assert.strictEqual(withRepo({ 'build.gradle': '' }, (r) => mod._detectTestCommand(r)).name, 'Gradle');
    assert.strictEqual(withRepo({ 'Gemfile': '' }, (r) => mod._detectTestCommand(r)).name, 'RSpec');
  });

  it('"No test framework detected" is a warning, not a gate-blocking error', async () => {
    await withRepo({ 'README.md': '# x' }, async (r) => {
      const checks = [];
      await new UnitTestsModule().run({ addCheck: (id, passed, meta) => checks.push({ id, passed, meta: meta || {} }) }, { projectRoot: r, getModuleConfig() { return {}; } });
      const d = checks.find((c) => c.id === 'unit-tests:detect');
      assert.ok(d && !d.passed && d.meta.severity === 'warning', JSON.stringify(checks));
    });
  });

  it('a runner that could not START (ModuleNotFoundError / command not found) is an info skip, not "Unit tests failed"', () => {
    const mod = new UnitTestsModule();
    assert.strictEqual(mod._looksLikeMissingToolchain("ModuleNotFoundError: No module named 'flask'"), true);
    assert.strictEqual(mod._looksLikeMissingToolchain('bash: go: command not found'), true);
    assert.strictEqual(mod._looksLikeMissingToolchain('FAIL tests/foo.test.js\n  expected 1 to equal 2'), false);
  });

  it('runs the customer suite with GATETEST_* scrubbed from the environment', () => {
    const src = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'modules', 'unit-tests.js'), 'utf8');
    assert.match(src, /if \(\/\^GATETEST_\/\.test\(k\)\) delete env\[k\]/);
  });
});
