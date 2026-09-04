// =============================================================================
// MUTATION — a killed scan must not leave a mutant in the user's source
// =============================================================================
// The mutation module writes a mutant into the REAL source file, runs the
// project's tests against it, and restores the original in a `finally`.
// `finally` covers a thrown exception. It does not cover the process being
// killed, and that is the ordinary case rather than the exotic one: a CI
// step that exceeds its limit gets SIGTERM, a developer who loses patience
// sends SIGINT, and both land inside the window where the file on disk is
// the mutated version.
//
// Observed three times in a single session on this repo — a `-` left as `+`
// in arena-scaffold/src/math.js, a `+` flipped inside a string literal in
// arena-scaffold/scripts/inject-bug.js, and a mutant in
// benchmarks/bench-target/config/default.js. A scanner that silently edits
// the tree it was asked to inspect is worse than one that misses a finding:
// the developer's next commit carries our bug with their name on it.
//
// The victim project below is built so the window is genuinely open when the
// signal arrives — baseline run exits immediately, the first mutant run
// blocks — because a test that kills the scan before it mutates anything
// passes whether the restore works or not. That vacuous version of this test
// was written first and reported success against the UNFIXED module.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'bin', 'gatetest.js');
const ORIGINAL = 'function subtract(a, b) { return a - b; }\nmodule.exports = { subtract };\n';

function buildVictim() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mut-victim-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  // The module skips a project whose deps are not installed.
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'math.js'), ORIGINAL);
  fs.writeFileSync(
    path.join(root, 't.js'),
    [
      "const fs = require('fs');",
      "const marker = __dirname + '/.baseline-done';",
      '// Baseline: exit at once so the module proceeds to mutants.',
      "if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); process.exit(0); }",
      '// Mutant runs: hold the window open.',
      'setTimeout(() => process.exit(1), 30000);',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'victim', version: '1.0.0', scripts: { test: 'node t.js' } }, null, 2),
  );
  return root;
}

const read = (root) => fs.readFileSync(path.join(root, 'src', 'math.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('mutation — the working tree survives a killed scan', () => {
  it('restores the original source when the scan is SIGTERMed mid-mutation', async () => {
    const root = buildVictim();
    try {
      const child = spawn(process.execPath, [CLI, 'scan', '--module', 'mutation', '--project', root], {
        cwd: REPO_ROOT,
        stdio: 'ignore',
      });
      const exited = new Promise((resolve) => child.on('exit', resolve));

      // Wait for the module to actually mutate the file. Without this the
      // test proves nothing — see the header.
      let sawMutation = false;
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (read(root) !== ORIGINAL) { sawMutation = true; break; }
        if (child.exitCode !== null) break;
      }

      assert.ok(
        sawMutation,
        'the victim project never reached the mutation window — this test would ' +
          'pass against a broken restore, so it must fail loudly instead',
      );

      child.kill('SIGTERM');
      await exited;
      await sleep(250);

      assert.strictEqual(
        read(root),
        ORIGINAL,
        'a SIGTERMed scan left a mutant behind in the source file',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
