// =============================================================================
// src/core/entrypoints.js — the one definition of "run, not imported" (KI #96)
// =============================================================================
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isEntryPoint, manifestEntrypoints } = require('../src/core/entrypoints');

let root;
const abs = (rel) => path.join(root, rel);
const write = (rel, body) => { fs.mkdirSync(path.dirname(abs(rel)), { recursive: true }); fs.writeFileSync(abs(rel), body); };

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-entrypoints-'));
  write('package.json', JSON.stringify({ name: 'x', main: 'lib/entry.js', bin: { x: './cli/run.js' }, scripts: { gen: 'node tools/generate.js --out y', build: 'tsc -p .' } }));
  write('ext/package.json', JSON.stringify({ name: 'ext', main: './out/extension.js' }));
  write('ext/src/extension.ts', '');
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

describe('isEntryPoint — directories are matched by segment, not by prefix', () => {
  it('a nested Next.js pages dir and a nested bin dir count', () => {
    assert.equal(isEntryPoint(abs('website/pages/about.tsx'), root), true);
    assert.equal(isEntryPoint(abs('packages/cli/bin/run.js'), root), true);
    assert.equal(isEntryPoint(abs('tools/scripts/x.js'), root), true);
  });
  it('a component or lib inside a Next.js app dir is NOT an entrypoint — only its route files are', () => {
    assert.equal(isEntryPoint(abs('website/app/components/Lonely.tsx'), root), false);
    assert.equal(isEntryPoint(abs('website/app/lib/cn.ts'), root), false);
    assert.equal(isEntryPoint(abs('website/app/compare/x/page.tsx'), root), true);
    assert.equal(isEntryPoint(abs('website/app/api/scan/route.ts'), root), true);
  });
  it('a substring is not a segment', () => {
    assert.equal(isEntryPoint(abs('src/binary-search.js'), root), false);
    assert.equal(isEntryPoint(abs('src/testing-utils.js'), root), false);
  });
});

describe('isEntryPoint — files loaded by their tooling, hooks, assets, fixtures', () => {
  it('tool configs, Next instrumentation and middleware, type declarations', () => {
    for (const f of ['eslint.config.mjs', 'website/next.config.ts', 'playwright.config.ts', 'website/instrumentation-client.ts', 'website/middleware.ts', 'website/next-env.d.ts']) {
      assert.equal(isEntryPoint(abs(f), root), true, f);
    }
  });
  it('git hooks and browser-served assets', () => {
    assert.equal(isEntryPoint(abs('src/hooks/pre-push.js'), root), true);
    assert.equal(isEntryPoint(abs('plugin/assets/js/admin.js'), root), true);
  });
  it('fixture corpora are inputs, not modules', () => {
    assert.equal(isEntryPoint(abs('reliability-corpus/cases/a.js'), root), true);
    assert.equal(isEntryPoint(abs('benchmarks/target/x.js'), root), true);
    assert.equal(isEntryPoint(abs('src/fixtures/sample.js'), root), true);
    assert.equal(isEntryPoint(abs('src/corpus-reader.js'), root), false);
  });
});

describe('manifestEntrypoints — what a package.json names is run, not imported', () => {
  it('main, bin and a script argument resolve to absolute paths', () => {
    const refs = manifestEntrypoints([root]);
    assert.ok(refs.has(abs('lib/entry.js')));
    assert.ok(refs.has(abs('cli/run.js')));
    assert.ok(refs.has(abs('tools/generate.js')));
    assert.ok(!refs.has(abs('tsc')));
  });
  it('a compiled main names its source under src/', () => {
    const refs = manifestEntrypoints([abs('ext')]);
    assert.ok(refs.has(abs('ext/out/extension.js')));
    assert.ok(refs.has(abs('ext/src/extension.ts')));
    assert.equal(isEntryPoint(abs('ext/src/extension.ts'), root, refs), true);
    assert.equal(isEntryPoint(abs('ext/src/helper.ts'), root, refs), false);
  });
  it('a directory without a manifest, or with an unparseable one, contributes nothing', () => {
    write('bad/package.json', '{ not json');
    assert.equal(manifestEntrypoints([abs('nowhere'), abs('bad')]).size, 0);
  });
});
