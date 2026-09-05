'use strict';

// src/core/tree-copy.js — the sandbox copy anything that must WRITE runs in
// (the Fifty, move 20). The controls: what is copied, what is linked, what
// is left out, and the bound that turns into a refusal rather than a fall
// back to the user's tree.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { copyTreeForSandbox, removeTree } = require('../src/core/tree-copy');

describe('copyTreeForSandbox', () => {
  let root; let made;
  const write = (rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-tc-src-'));
    made = [];
    write('package.json', '{"name":"x"}');
    write('src/a.js', 'a');
    write('packages/api/src/b.js', 'b');
    write('node_modules/dep/index.js', 'dep');
    write('packages/api/node_modules/dep2/index.js', 'dep2');
    write('.git/HEAD', 'ref');
    write('dist/bundle.js', 'built');
    write('.gatetest/reports/r.json', '{}');
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); for (const d of made) removeTree(d); });

  it('copies files, symlinks node_modules at any depth, leaves .git / dist / .gatetest out', () => {
    const r = copyTreeForSandbox(root);
    assert.ok(!r.error, r.error);
    made.push(r.dir);
    assert.equal(fs.readFileSync(path.join(r.dir, 'src/a.js'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(r.dir, 'packages/api/src/b.js'), 'utf8'), 'b');
    assert.ok(fs.lstatSync(path.join(r.dir, 'node_modules')).isSymbolicLink());
    assert.ok(fs.lstatSync(path.join(r.dir, 'packages/api/node_modules')).isSymbolicLink());
    assert.equal(fs.readFileSync(path.join(r.dir, 'node_modules/dep/index.js'), 'utf8'), 'dep', 'the link resolves to the real install');
    assert.equal(fs.existsSync(path.join(r.dir, '.git')), false);
    assert.equal(fs.existsSync(path.join(r.dir, 'dist')), false);
    assert.equal(fs.existsSync(path.join(r.dir, '.gatetest')), false);
    assert.deepEqual(r.symlinked.sort(), ['node_modules', 'packages/api/node_modules']);
    assert.equal(r.files, 3);
  });

  it('writing into the copy never touches the source tree', () => {
    const r = copyTreeForSandbox(root);
    made.push(r.dir);
    fs.writeFileSync(path.join(r.dir, 'src/a.js'), 'MUTANT');
    assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), 'a');
  });

  it('past the bound the copy is refused, cleaned up, and the reason says the numbers', () => {
    const r = copyTreeForSandbox(root, { maxFiles: 2 });
    assert.match(r.error, /exceeds the sandbox bound \(3 files/);
    assert.equal(r.dir, undefined);
    const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('gt-sandbox-'));
    assert.ok(!left.some((n) => fs.existsSync(path.join(os.tmpdir(), n, 'src', 'a.js'))), 'a refused copy is removed');
  });

  it('a symlink inside the tree is not followed', () => {
    fs.symlinkSync(os.tmpdir(), path.join(root, 'escape'), 'junction');
    const r = copyTreeForSandbox(root);
    made.push(r.dir);
    assert.equal(fs.existsSync(path.join(r.dir, 'escape')), false);
  });
});
