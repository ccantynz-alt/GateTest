const { describe, it } = require('node:test');
const assert = require('node:assert');

const MutationModule = require('../src/modules/mutation');

describe('MutationModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new MutationModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});

// ─── never write to the user's tree (the Fifty, move 20) ───────────────────

describe('MutationModule — mutants live in a sandbox copy', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function project() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mut-'));
    const write = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
    write('package.json', JSON.stringify({ name: 'mut', version: '1.0.0', scripts: { test: 'node test.js' } }));
    fs.mkdirSync(path.join(root, 'node_modules'));
    write('src/math.js', 'function add(a, b) {\n  if (a > 100) return 100;\n  return a + b;\n}\nmodule.exports = { add };\n');
    // The suite records WHERE it ran and WHAT it saw, so the test below can
    // prove every run happened in the copy against a mutated copy.
    write('test.js', [
      "const fs = require('fs'); const path = require('path');",
      "const src = fs.readFileSync(path.join(__dirname, 'src/math.js'), 'utf8');",
      "fs.appendFileSync(process.env.GT_MUT_LOG, JSON.stringify({ cwd: process.cwd(), src }) + '\\n');",
      "const { add } = require('./src/math');",
      "if (add(1, 2) !== 3) { console.error('add broken'); process.exit(1); }",
      "if (add(200, 1) !== 100) { console.error('cap broken'); process.exit(1); }",
    ].join('\n'));
    return root;
  }

  it('the user\'s file is never modified; every test run happens in the copy; the copy is removed', async () => {
    const root = project();
    const log = path.join(root, 'runs.log');
    const before = fs.readFileSync(path.join(root, 'src/math.js'), 'utf8');
    const saved = process.env.GT_MUT_LOG;
    process.env.GT_MUT_LOG = log;
    try {
      const checks = [];
      const result = { checks, addCheck(name, passed, meta) { checks.push({ name, passed, ...(meta || {}) }); } };
      await new MutationModule().run(result, { projectRoot: root, getModuleConfig() { return { maxMutants: 3, timeBudgetMs: 60000 }; } });
      assert.equal(fs.readFileSync(path.join(root, 'src/math.js'), 'utf8'), before, 'the working tree was written to');
      const runs = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(runs.length >= 2, `expected a baseline and at least one mutant run, got ${runs.length}`);
      const real = fs.realpathSync(root);
      for (const r of runs) assert.ok(r.cwd !== root && r.cwd !== real, 'a test run used the real tree as cwd');
      assert.ok(runs.slice(1).some((r) => r.src !== before), 'no mutant was ever seen by the suite');
      assert.ok(checks.some((c) => c.name === 'mutation:sandbox' && /sandbox copy/.test(c.message)), 'the report must say the tree was not touched');
      const sandboxDirs = [...new Set(runs.map((r) => r.cwd))];
      for (const d of sandboxDirs) assert.equal(fs.existsSync(d), false, `sandbox ${d} was not removed`);
    } finally {
      if (saved === undefined) delete process.env.GT_MUT_LOG; else process.env.GT_MUT_LOG = saved;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a copy that cannot be made is reported as NOT RUN — never mutated in place', async () => {
    const { MAX_FILES } = require('../src/core/tree-copy');
    assert.ok(MAX_FILES > 0);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'mutation.js'), 'utf8');
    assert.match(src, /Not run — could not copy the tree into a sandbox/);
    assert.doesNotMatch(src, /fs\.writeFileSync\(file,/, 'no write to a path from the user\'s tree remains');
    assert.doesNotMatch(src, /IN_FLIGHT|installRestoreHandlers/, 'the restore-the-user\'s-file machinery is gone with the write');
  });
});
