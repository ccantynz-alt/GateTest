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

// ── environment honesty (2026-08-18 audit) ─────────────────────────────────
// A configured-but-not-installed framework must be SKIPPED, not run through
// `npx` (which downloaded Cypress for 108 s on a fresh clone and then
// reported a blocking "E2E tests failed").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('E2eModule — never downloads a framework to fail with it', () => {
  it('cypress config with no node_modules → info skip, no subprocess', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-e2e-'));
    try {
      fs.writeFileSync(path.join(root, 'cypress.config.js'), 'module.exports = {};');
      const checks = [];
      const mod = new E2eModule();
      let execCalled = false;
      mod._exec = () => { execCalled = true; return { exitCode: 1, stdout: '', stderr: '' }; };
      await mod.run({ addCheck: (id, passed, meta) => checks.push({ id, passed, meta: meta || {} }) }, { projectRoot: root, getModuleConfig() { return {}; } });
      const run = checks.find((c) => c.id === 'e2e:run');
      assert.ok(run && run.passed && run.meta.severity === 'info', JSON.stringify(checks));
      assert.strictEqual(execCalled, false, 'must not shell out when the framework is not installed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('every framework command uses npx --no-install', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'e2e.js'), 'utf8');
    const cmds = [...src.matchAll(/command:\s*'([^']+)'/g)].map((m) => m[1]);
    assert.ok(cmds.length >= 3);
    for (const c of cmds) assert.match(c, /^npx --no-install /, c);
  });
});
