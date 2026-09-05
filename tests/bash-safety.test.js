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
