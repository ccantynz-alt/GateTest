'use strict';

// SHELL FILES — the one definition of "is this a shell script" (KI #106).
//
// Before this file, `shell` and `bashSafety` each chose files by extension
// from two different private lists. An extensionless `bin/deploy` with
// `#!/usr/bin/env bash` on line one — the commonest place for a deploy or
// release script — was opened by NEITHER, so `rm -rf $DIR/` in it was
// invisible while the identical line in `bin/deploy.sh` blocked the gate.
//
// Control pairs, per Doctrine §3:
//   POSITIVE  extensionless `bin/deploy` with a bash shebang       → scanned
//   NEGATIVE  the same bytes under `LICENSE`                        → not scanned
//   NEGATIVE  the same body under a `#!/usr/bin/env node` shebang  → not scanned
//   NEGATIVE  a binary (NUL in the head), Makefile, Dockerfile     → not scanned
//   POSITIVE  `.zsh` / `.ksh` / `.bash` / `.sh` by extension       → scanned

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SHELL_EXTENSIONS, SHELL_SHEBANG_RE, headIsShellScript, isShellScript, collectShellScripts,
} = require('../src/core/shell-files');
const BaseModule = require('../src/modules/base-module');

const DEPLOY = '#!/usr/bin/env bash\nset -e\nrm -rf $DIR/\n';

describe('shell-files — the shebang grammar', () => {
  const yes = [
    '#!/bin/sh', '#!/bin/bash', '#!/bin/bash -e', '#! /bin/bash',           // django verify_release.sh has the space
    '#!/usr/bin/env bash', '#!/usr/bin/env sh', '#!/usr/bin/env zsh', '#!/usr/bin/env ksh',
    '#!/usr/bin/env dash', '#!/usr/bin/env -S bash -eu', '#!/usr/bin/bash',    // fastify integration/test.sh
    '#!/bin/zsh',                                                             // vapor Performance/run-wrk.sh
    '#!/usr/local/bin/bash', '#!/bin/dash', '#!/bin/ash',
  ];
  const no = [
    '#!/usr/bin/env node', '#!/usr/bin/env nodejs', '#!/usr/bin/env -S node --enable-source-maps',
    '#!/usr/bin/env ruby', '#!/usr/bin/env python', '#! /usr/bin/env python3', '#!/usr/bin/env tsx',
    '#!/usr/bin/env pwsh', '#!/usr/bin/env fish', '#!/usr/bin/perl',
    '#![allow(unused_parens)]',                                               // Rust inner attribute (axum)
    '#!/bin/shell', '#!/bin/bashful',                                         // token, not prefix
    '# not a shebang', '', 'set -e',
  ];
  for (const line of yes) it(`fires: ${JSON.stringify(line)}`, () => assert.ok(SHELL_SHEBANG_RE.test(line)));
  for (const line of no) it(`quiet: ${JSON.stringify(line)}`, () => assert.ok(!SHELL_SHEBANG_RE.test(line)));

  it('a NUL byte in the sniffed head means binary, never a script', () => {
    assert.equal(headIsShellScript(Buffer.from('#!/bin/bash\n\x00\x01\x02')), false);
    assert.equal(headIsShellScript(Buffer.from('\x7fELF\x02\x01\x01')), false);
    assert.equal(headIsShellScript(Buffer.from('#!/bin/bash\necho ok\n')), true);
    assert.equal(headIsShellScript(Buffer.from('#!/bin/bash\r\necho ok\r\n')), true);
    assert.equal(headIsShellScript(null), false);
    assert.equal(headIsShellScript(Buffer.alloc(0)), false);
  });

  it('the extension list is the four shells and nothing else is by extension', () => {
    assert.deepEqual([...SHELL_EXTENSIONS], ['.sh', '.bash', '.zsh', '.ksh']);
  });
});

describe('shell-files — isShellScript on real files', () => {
  let tmp;
  const write = (rel, content) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  };
  const is = (rel) => isShellScript(path.join(tmp, rel), rel);
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-files-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('POSITIVE: extensionless bin/deploy with a bash shebang', () => {
    write('bin/deploy', DEPLOY);
    assert.equal(is('bin/deploy'), true);
  });

  it('POSITIVE: the hook, the release helper, the ci runner — every conventional home', () => {
    for (const rel of ['.githooks/pre-push', 'hooks/post-receive', 'scripts/release', 'ci/run', 'tools/bootstrap']) {
      write(rel, '#!/bin/sh\nset -e\necho ok\n');
      assert.equal(is(rel), true, rel);
    }
  });

  it('POSITIVE: by extension, whatever the content — .sh .bash .zsh .ksh, any case', () => {
    for (const rel of ['a.sh', 'b.bash', 'c.zsh', 'd.ksh', 'E.SH']) {
      write(rel, 'echo no shebang here\n');
      assert.equal(is(rel), true, rel);
    }
  });

  it('NEGATIVE: the same bytes under LICENSE / LICENSE-MIT / Makefile / Dockerfile / Procfile', () => {
    for (const rel of ['LICENSE', 'LICENSE-MIT', 'COPYING', 'Makefile', 'Dockerfile', 'Procfile', 'README', 'CHANGELOG']) {
      write(rel, DEPLOY);
      assert.equal(is(rel), false, rel);
    }
  });

  it('NEGATIVE: a node / ruby / python shebang is another language\'s script', () => {
    write('bin/cli', '#!/usr/bin/env node\nrequire("child_process").execSync("rm -rf $DIR/");\n');
    write('bin/rails', '#!/usr/bin/env ruby\nsystem("rm -rf $DIR/")\n');
    write('bin/manage', '#!/usr/bin/env python\nimport os\n');
    for (const rel of ['bin/cli', 'bin/rails', 'bin/manage']) assert.equal(is(rel), false, rel);
  });

  it('NEGATIVE: extensionless with no shebang, and a binary with a NUL in its head', () => {
    write('bin/notes', 'rm -rf $DIR/\n');
    write('bin/splitsh-lite', Buffer.concat([Buffer.from('#!/bin/bash\n'), Buffer.from([0x00, 0x7f, 0x45, 0x4c, 0x46])]));
    write('bin/elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]));
    for (const rel of ['bin/notes', 'bin/splitsh-lite', 'bin/elf']) assert.equal(is(rel), false, rel);
  });

  it('NEGATIVE: an extension that is not shell is never sniffed — .tt, .py, .js, .txt keep their shebangs to themselves', () => {
    for (const rel of ['docker-entrypoint.tt', 'x.py', 'x.js', 'x.txt', 'x.md']) {
      write(rel, DEPLOY);
      assert.equal(is(rel), false, rel);
    }
  });

  it('a missing file is not a script (unreadable → false, never a throw)', () => {
    assert.equal(is('bin/does-not-exist'), false);
  });
});

describe('shell-files — collectShellScripts goes through the module walk', () => {
  let tmp;
  const write = (rel, content) => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  };
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-collect-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('returns the scripts and, from the SAME walk, the extra extensions asked for', () => {
    const deploy = write('bin/deploy', DEPLOY);
    const sh = write('scripts/test.sh', 'echo\n');
    const zsh = write('scripts/x.zsh', 'echo\n');
    const yml = write('.github/workflows/ci.yml', 'jobs: {}\n');
    write('LICENSE', DEPLOY);
    write('Makefile', DEPLOY);
    write('bin/cli', '#!/usr/bin/env node\n');
    write('node_modules/dep/bin/deploy', DEPLOY);
    write('vendor/lib/deploy', DEPLOY);
    const mod = new BaseModule('t', 't');
    const { scripts, others } = collectShellScripts(mod, tmp, ['.yml', '.yaml']);
    assert.deepEqual(scripts.sort(), [deploy, sh, zsh].sort());
    assert.deepEqual(others, [yml]);
  });

  it('honours --diff scoping: only the changed script survives (Doctrine §4 — one walk)', () => {
    const deploy = write('bin/deploy', DEPLOY);
    write('scripts/test.sh', 'echo\n');
    const mod = new BaseModule('t', 't');
    mod._incrementalContext = { changedFilesAbs: new Set([deploy]) };
    const { scripts } = collectShellScripts(mod, tmp);
    assert.deepEqual(scripts, [deploy]);
  });
});
