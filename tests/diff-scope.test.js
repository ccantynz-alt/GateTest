// =============================================================================
// A narrowed scan reports only what it was narrowed to
// =============================================================================
// Measured 2026-09-05 on PR #422: the console said "Mode: diff-only (20
// changed files)" and the SARIF uploaded to GitHub Code Scanning held 961
// results across 379 files — 945 of them in files the PR never touched.
// `BaseModule._collectFiles` honours the changed set, but 22 of the 25
// quick-suite modules walk the tree with their own private copy of the
// loop and never see it. So `--diff` narrowed a handful of modules and let
// the rest report the whole repository under a diff-only banner, and every
// pre-existing finding reached the Security tab as one the PR introduced.
//
// The runner now filters every module's result at the one seam they all
// pass through. This test drives it with a module that ignores the
// incremental context entirely — the shape of the 22 — and asserts the
// contract on the way out.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GateTestConfig } = require('../src/core/config');
const { GateTestRunner } = require('../src/core/runner');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-diff-scope-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// A module that walks nothing and reports everything — the finding set a
// whole-tree walker would produce on a repo where only src/changed.js moved.
function wholeTreeModule() {
  return {
    async run(result) {
      result.addCheck('scan:summary', true, { severity: 'info', message: '4 files scanned' });
      result.addCheck('rule:in-changed', false, {
        severity: 'error', file: 'src/changed.js', line: 3, message: 'in a changed file',
      });
      result.addCheck('rule:in-untouched', false, {
        severity: 'error', file: 'src/untouched.js', line: 9, message: 'in a file the diff never touched',
      });
      result.addCheck('rule:absolute-untouched', false, {
        severity: 'warning', file: path.join(tmp, 'lib', 'old.js'), line: 1, message: 'absolute path, untouched',
      });
      result.addCheck('rule:repo-wide', false, {
        severity: 'warning', message: 'no .nvmrc at the project root',
      });
      result.addCheck('rule:sink-in-untouched-source-changed', false, {
        severity: 'error', file: 'src/db.js', line: 12, source: 'src/changed.js',
        message: 'tainted argument at src/changed.js:7 reaches query()',
      });
      result.addCheck('rule:message-cites-changed', false, {
        severity: 'warning', file: 'src/twin.js', line: 1,
        message: 'duplicate of src/changed.js lines 1-20',
      });
      result.addCheck('rule:near-miss-name', false, {
        severity: 'warning', file: 'src/other.js', line: 1,
        message: 'see src/unchanged.js — not the changed file, just contains its name',
      });
    },
  };
}

async function runScoped(options, configPatch) {
  const config = new GateTestConfig(tmp);
  if (configPatch) Object.assign(config.config, configPatch);
  const runner = new GateTestRunner(config, options);
  let summary;
  runner.on('suite:end', (s) => { summary = s; });
  runner.register('walker', wholeTreeModule());
  await runner.run(['walker']);
  return summary.results[0];
}

const names = (r) => r.checks.map((c) => c.name).sort();

describe('diff scope — a narrowed scan reports only changed files', () => {
  it('keeps findings in changed files, repo-wide findings, and findings a changed file caused', async () => {
    const r = await runScoped({ diffOnly: true, changedFiles: ['src/changed.js'] });
    assert.deepStrictEqual(names(r), [
      'rule:in-changed',
      'rule:message-cites-changed',
      'rule:repo-wide',
      'rule:sink-in-untouched-source-changed',
      'scan:summary',
    ]);
    assert.strictEqual(r.scopedOut, 3, 'the three findings outside the diff are counted, not silently lost');
  });

  it('does not match a changed filename inside a longer one', async () => {
    // src/changed.js is NOT cited by "src/unchanged.js"; nor would a.js be by data.js
    const r = await runScoped({ diffOnly: true, changedFiles: ['src/changed.js'] });
    assert.ok(!names(r).includes('rule:near-miss-name'));
  });

  it('normalises absolute check paths against the project root', async () => {
    const r = await runScoped({ diffOnly: true, changedFiles: ['lib/old.js'] });
    assert.ok(names(r).includes('rule:absolute-untouched'));
    assert.ok(!names(r).includes('rule:in-untouched'));
  });

  it('applies the same filter to --since / --pr incremental mode', async () => {
    const r = await runScoped({ incrementalFiles: new Set([path.join(tmp, 'src', 'changed.js')]) });
    assert.ok(names(r).includes('rule:in-changed'));
    assert.ok(!names(r).includes('rule:in-untouched'));
  });

  it('leaves a full scan untouched', async () => {
    const r = await runScoped({});
    assert.strictEqual(r.checks.length, 8);
    assert.strictEqual(r.scopedOut, 0);
  });

  it('exempts modules in incremental.alwaysRunList by configuration', async () => {
    const r = await runScoped(
      { diffOnly: true, changedFiles: ['src/changed.js'] },
      { incremental: { alwaysRunList: ['walker'] } },
    );
    assert.strictEqual(r.checks.length, 8);
  });

  it('the gate verdict is computed on the scoped result', async () => {
    // Only the untouched file carries a blocking error once the changed one
    // is excluded, so a diff of src/other.js alone must PASS.
    const config = new GateTestConfig(tmp);
    const runner = new GateTestRunner(config, { diffOnly: true, changedFiles: ['src/other.js'] });
    let summary;
    runner.on('suite:end', (s) => { summary = s; });
    runner.register('walker', wholeTreeModule());
    await runner.run(['walker']);
    assert.strictEqual(summary.gateStatus, 'PASSED', JSON.stringify(summary.results[0].checks.map((c) => c.name)));
  });
});
