'use strict';

// src/core/workspaces.js — the one reader of "which packages make up this
// monorepo" (KI #106). Shapes come from trpc (pnpm: examples/*, examples/.*/*,
// www), prisma (packages/**, test/**, !**/dist-*), nest (package.json
// workspaces: packages/*), and the conventional-dirs fallback.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ws = require('../src/core/workspaces');

describe('workspaces — declared patterns', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ws-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const w = (rel, c) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof c === 'string' ? c : JSON.stringify(c)); };

  it('reads package.json workspaces as an array or as {packages}', () => {
    w('package.json', { workspaces: ['packages/*'] });
    assert.deepEqual(ws.readWorkspacePatterns(tmp), ['packages/*']);
    w('package.json', { workspaces: { packages: ['apps/*', 'libs/*'] } });
    assert.deepEqual(ws.readWorkspacePatterns(tmp), ['apps/*', 'libs/*']);
  });

  it('reads pnpm-workspace.yaml packages: — quoted entries, comments, and stops at the next key (prisma, trpc)', () => {
    w('package.json', { name: 'root' });
    w('pnpm-workspace.yaml', "packages:\n  - packages/**\n  - 'examples/*'\n  - \"www\"   # the site\n  - '!**/dist-*'\n\nallowBuilds:\n  'esbuild@1': true\n  - not-a-package\n");
    assert.deepEqual(ws.readWorkspacePatterns(tmp), ['packages/**', 'examples/*', 'www', '!**/dist-*']);
  });

  it('reads lerna.json packages and de-duplicates across sources', () => {
    w('package.json', { workspaces: ['packages/*'] });
    w('lerna.json', { packages: ['packages/*', 'tools/*'] });
    assert.deepEqual(ws.readWorkspacePatterns(tmp), ['packages/*', 'tools/*']);
  });
});

describe('workspaces — members', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ws-m-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const pkg = (rel, name) => { const f = path.join(tmp, rel, 'package.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ name })); };
  const rels = () => ws.listWorkspacePackages(tmp).map((m) => m.rel);

  it('`x/*` lists one level; `x/**` lists nested members; a dir without package.json is not a member', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - packages/**\n  - examples/*\n');
    pkg('packages/client', '@acme/client');
    pkg('packages/adapters/pg', '@acme/adapter-pg');
    pkg('examples/todo', 'todo');
    fs.mkdirSync(path.join(tmp, 'examples', 'scratch'), { recursive: true }); // no manifest
    fs.mkdirSync(path.join(tmp, 'packages', 'client', 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'packages', 'client', 'node_modules', 'left-pad', 'package.json'), '{"name":"left-pad"}');
    assert.deepEqual(rels(), ['examples/todo', 'packages/adapters/pg', 'packages/client']);
  });

  it('dot-directories are entered only when the pattern asks (`examples/.*/*`, trpc); a negation removes matches (`!**/dist-*`, prisma)', () => {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), "packages:\n  - 'examples/*'\n  - 'examples/.*/*'\n  - 'packages/**'\n  - '!**/dist-*'\n");
    pkg('examples/.experimental/next-app', 'next-app');
    pkg('examples/.hidden', 'hidden-root');
    pkg('examples/basic', 'basic');
    pkg('packages/core', '@acme/core');
    pkg('packages/core/dist-esm', '@acme/core-built');
    assert.deepEqual(rels(), ['examples/.experimental/next-app', 'examples/basic', 'packages/core']);
  });

  it('a literal member (`www`) and a layer are recorded; layer is the first path segment', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ workspaces: ['www', 'apps/*'] }));
    pkg('www', 'site');
    pkg('apps/api', 'api');
    const m = ws.listWorkspacePackages(tmp);
    assert.deepEqual(m.map((x) => [x.rel, x.layer, x.name]), [['apps/api', 'apps', 'api'], ['www', 'www', 'site']]);
  });

  it('with nothing declared, falls back to apps/ packages/ libs/ services/; with nothing at all, is empty', () => {
    pkg('apps/web', 'web');
    pkg('libs/ui', '@acme/ui');
    pkg('modules/x', 'x'); // not conventional, not declared
    assert.deepEqual(rels(), ['apps/web', 'libs/ui']);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ws-e-'));
    try { assert.deepEqual(ws.listWorkspacePackages(empty), []); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });

  it('map and name-set helpers keep the shapes deadCodeIndex and aiHallucination consume', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    pkg('packages/a', '@acme/a');
    assert.equal(ws.workspacePackageMap(tmp).get('@acme/a'), path.join(tmp, 'packages', 'a'));
    assert.deepEqual([...ws.workspacePackageNames(tmp)], ['@acme/a']);
  });
});
