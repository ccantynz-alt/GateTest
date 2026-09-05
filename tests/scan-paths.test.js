'use strict';

// src/core/scan-paths.js — `.gatetest.json` "paths": the one answer to "is
// this path in scope for this repository's gate" (the Fifty, move 27),
// applied at BaseModule._collectFiles and to findings at the runner.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readPathFilter, pathInScope } = require('../src/core/scan-paths');
const { GateTestConfig } = require('../src/core/config');
const { GateTestRunner } = require('../src/core/runner');
const BaseModule = require('../src/modules/base-module');
const { buildProvenance } = require('../src/core/report-provenance');

const cfg = (paths) => ({ get: (k) => (k === 'paths' ? paths : undefined) });

describe('scan-paths — grammar', () => {
  it('no paths key, or empty lists, means no filter', () => {
    assert.equal(readPathFilter(cfg(undefined)), null);
    assert.equal(readPathFilter(cfg({ include: [], exclude: [] })), null);
    assert.equal(pathInScope(null, 'anything/at/all.js'), true);
  });

  it('a bare directory means everything under it, segment-anchored', () => {
    const f = readPathFilter(cfg({ include: ['packages/api'] }));
    assert.equal(pathInScope(f, 'packages/api/src/x.ts'), true);
    assert.equal(pathInScope(f, 'packages/api'), true);
    assert.equal(pathInScope(f, 'packages/api-legacy/src/x.ts'), false, 'packages/api must not claim packages/api-legacy');
    assert.equal(pathInScope(f, 'packages/web/src/x.ts'), false);
  });

  it('globs: * is one segment, ** any depth; exclude wins over include', () => {
    const f = readPathFilter(cfg({ include: ['packages/*/src/**'], exclude: ['**/fixtures/**', 'packages/web'] }));
    assert.equal(pathInScope(f, 'packages/api/src/a.ts'), true);
    assert.equal(pathInScope(f, 'packages/api/src/deep/er/a.ts'), true);
    assert.equal(pathInScope(f, 'packages/api/test/a.ts'), false);
    assert.equal(pathInScope(f, 'packages/api/src/fixtures/a.ts'), false, 'excluded even though included');
    assert.equal(pathInScope(f, 'packages/web/src/a.ts'), false);
  });

  it('exclude alone keeps everything else; backslashes and ./ are normalised', () => {
    const f = readPathFilter(cfg({ exclude: ['docs'] }));
    assert.equal(pathInScope(f, 'src/a.js'), true);
    assert.equal(pathInScope(f, 'docs/a.md'), false);
    assert.equal(pathInScope(f, './docs/a.md'), false);
    assert.equal(pathInScope(f, 'docs\\a.md'), false);
  });
});

describe('scan-paths — applied at the walk and at the runner', () => {
  let tmp;
  const write = (rel, content) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-paths-'));
    write('packages/api/src/a.js', 'const x = 1;\n');
    write('packages/web/src/b.js', 'const y = 2;\n');
    write('docs/c.js', 'const z = 3;\n');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('_collectFiles sees only in-scope files once the runner stamps the filter', () => {
    const mod = new BaseModule('t', 't');
    const all = mod._collectFiles(tmp, ['.js']).map((f) => path.relative(tmp, f).split(path.sep).join('/')).sort();
    assert.deepEqual(all, ['docs/c.js', 'packages/api/src/a.js', 'packages/web/src/b.js']);
    mod._scanPathFilter = readPathFilter(cfg({ include: ['packages/api'] }));
    const scoped = mod._collectFiles(tmp, ['.js']).map((f) => path.relative(tmp, f).split(path.sep).join('/'));
    assert.deepEqual(scoped, ['packages/api/src/a.js']);
  });

  it('a module with its own lookup has out-of-scope findings dropped at the runner, counted and reported', async () => {
    write('.gatetest.json', JSON.stringify({ paths: { include: ['packages/api'] } }));
    const config = new GateTestConfig(tmp);
    const runner = new GateTestRunner(config);
    runner.register('ownWalk', {
      async run(result) {
        result.addCheck('rule:in-scope', false, { severity: 'error', file: 'packages/api/src/a.js', line: 1, message: 'in scope' });
        result.addCheck('rule:out-of-scope', false, { severity: 'error', file: 'packages/web/src/b.js', line: 1, message: 'out of scope' });
        result.addCheck('rule:repo-wide', false, { severity: 'warning', message: 'no .nvmrc' });
      },
    });
    const summary = await runner.run(['ownWalk']);
    const names = summary.results[0].checks.filter((c) => !c.passed).map((c) => c.name).sort();
    assert.deepEqual(names, ['rule:in-scope', 'rule:repo-wide']);
    assert.equal(summary.results[0].scopedOut, 1);
    assert.deepEqual(summary.pathFilter, { include: ['packages/api'], exclude: [], findingsDropped: 1 });
    assert.deepEqual(buildProvenance(summary).scope.paths, summary.pathFilter, 'the signed provenance says what was out of scope');
  });

  it('without a paths key nothing changes: no filter on the summary, nothing dropped', async () => {
    const config = new GateTestConfig(tmp);
    const runner = new GateTestRunner(config);
    runner.register('ownWalk', { async run(result) { result.addCheck('rule:x', false, { severity: 'error', file: 'docs/c.js', line: 1, message: 'x' }); } });
    const summary = await runner.run(['ownWalk']);
    assert.equal(summary.pathFilter, null);
    assert.equal(summary.results[0].scopedOut, 0);
  });
});
