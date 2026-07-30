'use strict';
/**
 * PUBLISHED-ARTIFACT SMOKE TEST — does what we ship actually run?
 *
 * Nothing tested this before, and it cost real customer-facing breakage. Known
 * Issue #74 found SEVEN places where shipped code loaded modules from
 * `website/…`, which `package.json` `files` (`bin/ src/ lib/`) and `.npmignore`
 * both exclude. Four were bare top-level requires in binaries, so
 * `gatetest-doctor`, `gatetest-promote`, `gatetest-train` and
 * `gatetest-reliability` died with MODULE_NOT_FOUND on invocation for every
 * `npm i -g` user — and `gatetest-reliability` is one of the three commands
 * `package.json` declares.
 *
 * ── Why CI could not catch it ────────────────────────────────────────────────
 * This is the important part. `.github/workflows/reliability-corpus.yml` runs
 * `node bin/gatetest-reliability.js --strict` on every push and it PASSED
 * throughout, because CI runs from a git checkout where `website/` exists. Every
 * test, every workflow, every local run had the whole repo on disk. The only
 * environment that did not was the customer's, and nothing ever looked there.
 *
 * A green CI on a broken binary is worse than a red one: it is evidence pointing
 * the wrong way.
 *
 * So this test builds the real tarball with `npm pack`, extracts it, and runs
 * every shipped binary from that tree — where `website/` genuinely is not
 * present. It is the only check here that sees what a customer sees.
 *
 * ── On the node_modules link ────────────────────────────────────────────────
 * External dependencies are linked in rather than installed: a real `npm install`
 * would need the network, which makes a test slow and flaky. Linking is right for
 * the question being asked — this test is about whether OUR files are in the
 * package, not whether npm can fetch third-party ones. Note ESM `import` ignores
 * NODE_PATH, so the link (not an env var) is what makes the .mjs binary testable.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const BIN_TIMEOUT_MS = 40_000;

let tmp = null;
let pkgDir = null;
let linked = false;

/** Missing FIRST-PARTY file — the bug class this test exists for. */
function firstPartyMissing(output) {
  // Node says "Cannot find module" for CJS and "Cannot find package" for ESM.
  // A bare/scoped specifier is a third-party dep (not our problem here); a
  // relative or absolute path is one of ours.
  const m = output.match(/Cannot find (?:module|package) '([^']+)'/);
  if (!m) return null;
  const spec = m[1];
  const external = !spec.startsWith('.') && !path.isAbsolute(spec) && !/^[A-Za-z]:[\\/]/.test(spec);
  return external ? null : spec;
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-pack-'));
  // Fails loudly rather than skipping: if we cannot build the tarball, we cannot
  // publish either, and that is worth a red test.
  execFileSync('npm', ['pack', '--pack-destination', tmp], {
    cwd: REPO, stdio: 'pipe', shell: true, timeout: 180_000,
  });
  const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, 'npm pack produced no tarball');

  // Relative filename from cwd, deliberately: GNU tar treats an argument
  // containing a colon as `host:path`, so a Windows path like
  // C:\Users\…\x.tgz fails with "Cannot connect to C: resolve failed".
  execFileSync('tar', ['-xzf', tgz], { cwd: tmp, stdio: 'pipe', timeout: 120_000 });
  pkgDir = path.join(tmp, 'package');
  assert.ok(fs.existsSync(pkgDir), 'tarball did not extract to package/');

  try {
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(pkgDir, 'node_modules'), 'junction');
    linked = true;
  } catch {
    linked = false; // surfaced by the test below rather than silently skipped
  }
});

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } // error-ok
});

describe('published package — what we ship', () => {
  it('does NOT contain website/, which is the whole reason this test exists', () => {
    assert.strictEqual(fs.existsSync(path.join(pkgDir, 'website')), false,
      'website/ must stay out of the package — if it ships, this test stops being meaningful');
    for (const dir of ['bin', 'src', 'lib']) {
      assert.ok(fs.existsSync(path.join(pkgDir, dir)), `${dir}/ must ship`);
    }
  });

  it('every declared bin entry exists in the tarball', () => {
    const declared = require(path.join(REPO, 'package.json')).bin;
    for (const [name, rel] of Object.entries(declared)) {
      assert.ok(fs.existsSync(path.join(pkgDir, rel)),
        `bin "${name}" -> ${rel} is declared but not in the package`);
    }
  });

  it('the node_modules link was created (otherwise the runs below prove nothing)', () => {
    assert.ok(linked,
      'could not link node_modules into the extracted package — this platform cannot run '
      + 'this test meaningfully, and a silent pass would be a false all-clear');
  });

  it('every shipped binary loads without a missing first-party module', () => {
    const bins = fs.readdirSync(path.join(pkgDir, 'bin')).filter((f) => /\.(js|mjs|cjs)$/.test(f));
    assert.ok(bins.length >= 3, `expected several shipped binaries, found ${bins.length}`);

    const broken = [];
    for (const b of bins) {
      const r = spawnSync(process.execPath, [path.join(pkgDir, 'bin', b), '--help'], {
        cwd: pkgDir, encoding: 'utf8', timeout: BIN_TIMEOUT_MS,
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`;
      const missing = firstPartyMissing(out);
      if (missing) broken.push(`${b} -> cannot find ${missing}`);
      else if (r.error) broken.push(`${b} -> ${r.error.message}`);
    }

    assert.deepStrictEqual(broken, [],
      'These ship but cannot load. Move the dependency into src/core/ (or lib/) and leave a '
      + 're-export shim at the old path — see tests/lib-shims.test.js.');
  });

  it('the engine is complete in the tarball — all modules load from the packed tree', () => {
    // The strongest assertion here: not "the files exist" but "the registry can
    // build every module from the packaged tree alone". A single missing module
    // file would drop the count.
    const expected = Object.keys(require(path.join(REPO, 'src/core/registry')).BUILT_IN_MODULES).length;
    const r = spawnSync(process.execPath, [path.join(pkgDir, 'bin', 'gatetest.js'), '--list'], {
      cwd: pkgDir, encoding: 'utf8', timeout: BIN_TIMEOUT_MS,
    });
    const listed = (`${r.stdout || ''}`.match(/^ {2}\w+/gm) || []).length;
    assert.strictEqual(listed, expected,
      `packed engine listed ${listed} modules, repo registry has ${expected} — something did not ship`);
  });
});
