'use strict';

// ============================================================================
// The installer must actually INSTALL — run it, don't just read it
// ============================================================================
// integrations/scripts/install.sh is the mechanism that protects Craig's other
// platforms (CLAUDE.md → PROTECTED PLATFORMS). tests/integrations.test.js
// asserts the file exists and CONTAINS certain strings; nothing executed it.
// That is the same gap that let the KI #95 bug survive — a seam guaranteed by
// inspection rather than by crossing it.
//
// A broken installer fails silently in the worst way: the operator sees the
// script run, and the repo simply is not protected.
//
// Network is avoided by overriding GATETEST_RAW with a file:// URL pointing at
// this checkout — the same code path curl takes for https, so the fetch, the
// write and the marker are all genuinely exercised.
// ============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER = path.join(REPO_ROOT, 'integrations', 'scripts', 'install.sh');

let target;
let ran;

/** file:// URL for this checkout, in the form curl accepts on this platform. */
function fileUrlForRepo() {
  const p = REPO_ROOT.split(path.sep).join('/');
  return `file:///${p.replace(/^\/+/, '')}`;
}

before(() => {
  target = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-install-'));
  // The installer refuses a non-git directory, which is itself worth honouring.
  spawnSync('git', ['init', '-q', target], { encoding: 'utf8' });

  ran = spawnSync('bash', [INSTALLER], {
    cwd: target,
    encoding: 'utf8',
    env: { ...process.env, TARGET: target, GATETEST_RAW: fileUrlForRepo() },
  });
});

after(() => {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ } // error-ok
});

describe('install.sh actually installs the protection layer', () => {
  it('exits successfully', () => {
    assert.equal(ran.status, 0, `installer failed:\n${ran.stderr || ran.stdout}`);
  });

  it('writes the CI gate workflow, with real content', () => {
    const f = path.join(target, '.github', 'workflows', 'gatetest-gate.yml');
    assert.ok(fs.existsSync(f), 'workflow was not written');
    const body = fs.readFileSync(f, 'utf8');
    // Guards against a truncated fetch or an error page landing in its place.
    assert.ok(body.length > 1000, `workflow is suspiciously small (${body.length} bytes)`);
    assert.match(body, /GATETEST QUALITY GATE/);
    assert.ok(!/<html|404: Not Found/i.test(body), 'an error page was saved as the workflow');
  });

  it('writes the pre-push hook, with real content', () => {
    const f = path.join(target, '.husky', 'pre-push');
    assert.ok(fs.existsSync(f), 'pre-push hook was not written');
    const body = fs.readFileSync(f, 'utf8');
    assert.ok(body.length > 500, `hook is suspiciously small (${body.length} bytes)`);
    assert.ok(!/<html|404: Not Found/i.test(body), 'an error page was saved as the hook');
  });

  it('writes a .gatetest.json marker that is valid JSON', () => {
    const f = path.join(target, '.gatetest.json');
    assert.ok(fs.existsSync(f), 'protection marker was not written');
    const marker = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(marker.protected, true);
    assert.match(String(marker.gatetest_source), /gatetest/);
    assert.ok(marker.do_not_remove, 'the marker must say why it exists');
  });

  it('defaults to advisory mode — the installer must not block a new repo on day one', () => {
    // Forbidden #25: we are the painkiller, not the bottleneck. A repo that
    // installs the gate and is immediately unable to push would be removed.
    const marker = JSON.parse(fs.readFileSync(path.join(target, '.gatetest.json'), 'utf8'));
    assert.equal(marker.mode, 'advisory');
  });

  it('refuses a directory that is not a git repository', () => {
    // POSITIVE CONTROL for the guard, and proof the installer is not blindly
    // writing wherever it is pointed.
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-install-bare-'));
    try {
      const r = spawnSync('bash', [INSTALLER], {
        cwd: notARepo,
        encoding: 'utf8',
        env: { ...process.env, TARGET: notARepo, GATETEST_RAW: fileUrlForRepo() },
      });
      assert.notEqual(r.status, 0, 'installer should refuse a non-git directory');
      assert.match(String(r.stderr), /not a git repository/i);
      assert.ok(
        !fs.existsSync(path.join(notARepo, '.gatetest.json')),
        'nothing may be written when the target is rejected'
      );
    } finally {
      try { fs.rmSync(notARepo, { recursive: true, force: true }); } catch { /* best effort */ } // error-ok
    }
  });
});
