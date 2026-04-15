const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ShellModule = require('../src/modules/shell');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new ShellModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('ShellModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no shell scripts exist', async () => {
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'shell:no-files'));
  });

  it('finds .sh, .bash, and .zsh files', async () => {
    write(tmp, 'a.sh',   '#!/usr/bin/env bash\nset -euo pipefail\necho a\n');
    write(tmp, 'b.bash', '#!/usr/bin/env bash\nset -euo pipefail\necho b\n');
    write(tmp, 'c.zsh',  '#!/usr/bin/env zsh\nset -euo pipefail\necho c\n');
    const r = await run(tmp);
    const scanning = r.checks.find((c) => c.name === 'shell:scanning');
    assert.match(scanning.message, /3 shell/);
  });

  it('excludes node_modules', async () => {
    write(tmp, 'node_modules/foo/bad.sh', 'rm -rf $HOME\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'shell:no-files'));
  });
});

describe('ShellModule — shebang + set -e', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-shb-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('info-flags missing shebang', async () => {
    write(tmp, 'script.sh', 'echo hello\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:no-shebang:')));
  });

  it('warns when set -e / pipefail is missing', async () => {
    write(tmp, 'script.sh', '#!/usr/bin/env bash\necho hello\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:missing-set-e:')));
  });

  it('accepts `set -euo pipefail`', async () => {
    write(tmp, 'script.sh', '#!/usr/bin/env bash\nset -euo pipefail\necho hello\n');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:missing-set-e:')), undefined);
  });

  it('accepts `set -o errexit`', async () => {
    write(tmp, 'script.sh', '#!/usr/bin/env bash\nset -o errexit\necho hello\n');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:missing-set-e:')), undefined);
  });
});

describe('ShellModule — curl | sh', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-curl-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on curl | sh', async () => {
    write(tmp, 'install.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'curl -sSL https://example.com/install.sh | sh',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('shell:curl-pipe-sh:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on wget | bash', async () => {
    write(tmp, 'install.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'wget -qO- https://example.com/install | bash',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:curl-pipe-sh:')));
  });

  it('does not flag curl piped to a non-shell command', async () => {
    write(tmp, 'fetch.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'curl -sSL https://example.com/data.json | jq .',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:curl-pipe-sh:')), undefined);
  });
});

describe('ShellModule — unsafe rm', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-rm-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on `rm -rf $VAR` (unquoted)', async () => {
    write(tmp, 'clean.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'rm -rf $BUILD_DIR',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('shell:unsafe-rm:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on `rm -rf /`', async () => {
    write(tmp, 'nuke.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'rm -rf /',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:unsafe-rm:')));
  });

  it('accepts quoted + guarded `rm -rf "$VAR"`', async () => {
    write(tmp, 'clean.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      ': "${BUILD_DIR:?BUILD_DIR required}"',
      'rm -rf -- "$BUILD_DIR"',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:unsafe-rm:')), undefined);
  });
});

describe('ShellModule — eval + secrets', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-eval-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on `eval $VAR`', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'eval "$CMD"',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:eval-var:')));
  });

  it('errors on `eval $(cmd)`', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'eval $(get-config)',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:eval-var:')));
  });

  it('errors on hardcoded AWS access key', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:hardcoded-secret:aws-key:')));
  });

  it('errors on embedded private key marker', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'KEY="-----BEGIN RSA PRIVATE KEY-----"',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:hardcoded-secret:private-key:')));
  });
});

describe('ShellModule — POSIX / portability', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-posix-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns when #!/bin/sh uses [[ ]]', async () => {
    write(tmp, 's.sh', [
      '#!/bin/sh',
      'set -e',
      'if [[ "$x" = "y" ]]; then echo hi; fi',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:sh-but-bashism:double-bracket:')));
  });

  it('warns when #!/bin/sh uses here-strings', async () => {
    write(tmp, 's.sh', [
      '#!/bin/sh',
      'set -e',
      'grep foo <<< "$data"',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:sh-but-bashism:here-string:')));
  });

  it('does NOT warn about bashisms when shebang is bash', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "$x" = "y" ]]; then echo hi; fi',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:sh-but-bashism:')), undefined);
  });

  it('info-flags backtick command substitution', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'X=`date +%s`',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('shell:backticks:')));
  });

  it('accepts $(...) command substitution silently', async () => {
    write(tmp, 's.sh', [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'X=$(date +%s)',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('shell:backticks:')), undefined);
  });
});

describe('ShellModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-shell-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 's.sh', '#!/usr/bin/env bash\nset -euo pipefail\necho ok\n');
    const r = await run(tmp);
    const summary = r.checks.find((c) => c.name === 'shell:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 file\(s\)/);
  });
});
