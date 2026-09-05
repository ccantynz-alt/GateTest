'use strict';

// BASH SAFETY — control pairs for the two package.json / CI shapes that
// blocked real repos on corpus6 (2026-09-05):
//   nestjs/nest  package.json "coverage" / "test:cov"
//                `vitest run --coverage --config vitest.config.coverage.mts || true`
//   trpc/trpc    .github/workflows/check-skills.yml:44
//                `OUTPUT=$(intent stale --json 2>&1) || true` … `echo "$OUTPUT" | node -e`
// and the one left blocking because it IS a swallow (defendant: the code):
//   trpc/trpc    .github/workflows/main.yml:154
//                `cp ./examples/${{ matrix.dir }}/.env.example … || true`
//
// Both downgrades are to WARNING, never silence: a coverage step that never
// fails and a captured-then-inspected exit code are both shapes where a dead
// command can read as clean (Doctrine §1), so the customer is still told.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BashSafetyModule = require('../src/modules/bash-safety');

async function scan(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-bash-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const checks = [];
    const result = { checks, addCheck(name, passed, meta) { checks.push({ name, passed, ...(meta || {}) }); } };
    await new BashSafetyModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const names = (f) => f.map((c) => c.name).join(', ');
const pipeTrue = (f) => f.find((c) => c.name.startsWith('bash-safety:pipe-true:'));

describe('bash-safety — package.json: a coverage script declared non-fatal by its name', () => {
  const NEST = {
    test: 'vitest run',
    coverage: 'vitest run --coverage --config vitest.config.coverage.mts || true',
    'test:cov': 'vitest run --coverage --config vitest.config.coverage.mts || true',
  };

  it('NEGATIVE: nest "coverage" and "test:cov" are warnings — still reported, with the reason', async () => {
    const f = await scan({ 'package.json': JSON.stringify({ name: 'nest', scripts: NEST }) });
    for (const s of ['coverage', 'test:cov']) {
      const hit = f.find((c) => c.name === `bash-safety:pipe-true:package.json:${s}`);
      assert.ok(hit, `${s} must still be reported: ${names(f)}`);
      assert.equal(hit.severity, 'warning');
      assert.match(hit.message, /coverage step/);
    }
    assert.ok(!f.some((c) => c.severity === 'error'), names(f));
  });

  it('POSITIVE: "test" going green on red is still an error — the NAME governs, not --coverage', async () => {
    const f = await scan({ 'package.json': JSON.stringify({ name: 'x', scripts: {
      test: 'vitest run --coverage || true',
      build: 'tsc || true',
      'recover:db': 'node recover.js || true',
    } }) });
    for (const s of ['test', 'build', 'recover:db']) {
      const hit = f.find((c) => c.name === `bash-safety:pipe-true:package.json:${s}`);
      assert.ok(hit, `${s}: ${names(f)}`);
      assert.equal(hit.severity, 'error', s);
    }
  });
});

describe('bash-safety — `VAR=$(cmd) || true` whose output is inspected below', () => {
  const TRPC_CHECK_SKILLS = [
    'name: check-skills', 'on: push', 'jobs:', '  check:', '    runs-on: ubuntu-latest', '    steps:',
    '      - name: Check staleness', '        id: stale', '        run: |',
    '          OUTPUT=$(intent stale --json 2>&1) || true',
    '          echo "$OUTPUT"', '',
    '          # Check if any skills need review',
    '          NEEDS_REVIEW=$(echo "$OUTPUT" | node -e "console.log(1)")',
    '          if [ -z "$NEEDS_REVIEW" ]; then', '            echo "has_stale=false" >> "$GITHUB_OUTPUT"', '          fi', '',
  ].join('\n');

  it('NEGATIVE: trpc check-skills.yml:44 — warning, with the reason in the message', async () => {
    const f = await scan({ '.github/workflows/check-skills.yml': TRPC_CHECK_SKILLS });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'warning');
    assert.match(hit.message, /captured output is read below/);
  });

  it('POSITIVE: the same capture with nothing reading $OUT afterwards is an error', async () => {
    const f = await scan({ 'deploy.sh': '#!/bin/bash\nset -e\nOUT=$(node deploy.js) || true\necho "deployed"\n' });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });

  it('POSITIVE: a $VAR read in the NEXT YAML step does not count', async () => {
    const yml = [
      'jobs:', '  j:', '    steps:',
      '      - run: |', '          OUT=$(node deploy.js) || true',
      '      - run: echo "$OUT"', '',
    ].join('\n');
    const f = await scan({ '.github/workflows/a.yml': yml });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });

  it('POSITIVE: trpc main.yml:154 `cp … || true` is a real swallow — stays an error (defendant: code)', async () => {
    const yml = [
      'jobs:', '  e2e:', '    steps:',
      '      - run: pnpm build', '',
      '      - run: cp ./examples/${{ matrix.dir }}/.env.example ./examples/${{ matrix.dir }}/.env || true',
      '      - run: pnpm turbo --filter ./examples/${{ matrix.dir }} test-dev', '',
    ].join('\n');
    const f = await scan({ '.github/workflows/main.yml': yml });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });
});

describe('bash-safety — which files are shell is decided by src/core/shell-files.js (KI #106)', () => {
  // The module's private list was `['.sh', '.bash']`: no `.zsh`, and an
  // extensionless `bin/deploy` with `#!/usr/bin/env bash` on line one was
  // never opened at all. Control pair: the same body fires from `bin/deploy`
  // and from `x.zsh`, stays silent under `LICENSE` and under a node shebang.
  const DEPLOY = '#!/usr/bin/env bash\nset -e\nrm -rf $DIR/ || true\n';
  const swallowAt = (f, rel) => f.find((c) => c.name === `bash-safety:pipe-true:${rel}:3`);

  it('POSITIVE: extensionless bin/deploy with a bash shebang FIRES', async () => {
    const f = await scan({ 'bin/deploy': DEPLOY });
    const hit = swallowAt(f, 'bin/deploy');
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });

  it('POSITIVE: .zsh is scanned (it was not), and .sh still is', async () => {
    const f = await scan({ 'scripts/x.zsh': DEPLOY, 'scripts/y.sh': DEPLOY });
    assert.ok(swallowAt(f, 'scripts/x.zsh'), names(f));
    assert.ok(swallowAt(f, 'scripts/y.sh'), names(f));
  });

  it('NEGATIVE: the same bytes under LICENSE, or a node-shebang script, are not shell', async () => {
    const f = await scan({
      LICENSE: DEPLOY,
      'bin/cli': '#!/usr/bin/env node\n// noop\nrequire("child_process").execSync("rm -rf $DIR/ || true");\n',
    });
    assert.equal(f.length, 0, names(f));
  });
});

describe('bash-safety — `cmd || true` whose OUTCOME is tested on the next line', () => {
  // integrations/husky/pre-push:88-89, verbatim. The exit code is swallowed so
  // the hook can decide on the artefact instead — and it does, on the next line.
  const PRE_PUSH = [
    '#!/bin/sh', 'GATETEST_CACHE="$HOME/.gatetest/cache"',
    'if [ ! -d "$GATETEST_CACHE/.git" ]; then',
    '  mkdir -p "$(dirname "$GATETEST_CACHE")"',
    '  git clone --depth 1 https://github.com/crclabs-hq/gatetest.git "$GATETEST_CACHE" 2>/dev/null || true',
    '  if [ ! -d "$GATETEST_CACHE/.git" ]; then',
    '    echo "[GateTest] Clone unavailable — letting push through; CI gate is the source of truth."',
    '    exit 0', '  fi', '  exit 0', 'fi', '',
  ].join('\n');

  it('NEGATIVE: the pre-push clone is a warning on both rules, with the reason', async () => {
    const f = await scan({ '.githooks/pre-push': PRE_PUSH });
    const hits = f.filter((c) => /^bash-safety:(pipe-true|devnull-swallow):/.test(c.name));
    assert.equal(hits.length, 2, names(f));
    for (const h of hits) {
      assert.equal(h.severity, 'warning', h.name);
      assert.match(h.message, /outcome is tested on the next line/);
    }
  });

  it('POSITIVE: the same clone with nothing deciding on it afterwards is an error', async () => {
    const f = await scan({ 'setup.sh': '#!/bin/bash\ngit clone --depth 1 https://example.com/x.git "$DIR" 2>/dev/null || true\necho "ready"\ncd "$DIR"\n' });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });

  it('POSITIVE: a test further than three code lines down does not count', async () => {
    const f = await scan({ 'setup.sh': '#!/bin/bash\nmake build || true\necho a\necho b\necho c\nif [ -f out/bin ]; then echo ok; fi\n' });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });

  it('POSITIVE: integrations/husky/pre-push:97 — the capped cache refresh is a real swallow (defendant: code, suppressed in .gatetestignore with the reason)', async () => {
    const f = await scan({ 'hook.sh': '#!/bin/sh\n( cd "$C" && timeout 5 git pull --ff-only --depth 1 origin HEAD >/dev/null 2>&1 || true )\nexit 0\n' });
    const hit = pipeTrue(f);
    assert.ok(hit, names(f));
    assert.equal(hit.severity, 'error');
  });
});
