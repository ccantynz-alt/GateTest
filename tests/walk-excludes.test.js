'use strict';

// src/core/walk-excludes.js — the one directory-exclude list every walk
// shares (145 files depend on it transitively; our own scanner asked for a
// test file to match). The list is data; the tests pin its contract.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { WALK_EXCLUDES } = require('../src/core/walk-excludes');

test('the list is frozen, unique, and names directories by segment — never a substring or a path', () => {
  assert.ok(Object.isFrozen(WALK_EXCLUDES));
  assert.equal(new Set(WALK_EXCLUDES).size, WALK_EXCLUDES.length, 'duplicate entry');
  for (const name of WALK_EXCLUDES) {
    assert.match(name, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/, `${name} is not a directory name`);
    assert.notEqual(name, '.', 'excluding "." would exclude the project');
  }
});

test('the entries every walk must skip are present', () => {
  for (const must of ['node_modules', '.git', '.gatetest', 'dist', 'build', 'coverage', '.next', 'vendor', '.claude', '.terraform', '.venv', 'obj', '.idea']) {
    assert.ok(WALK_EXCLUDES.includes(must), `${must} missing`);
  }
});

test('every walker imports it rather than carrying a copy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of [
    'src/modules/base-module.js', 'src/core/migration-dirs.js', 'src/core/tree-copy.js',
    // 2026-09-05: nine more, each with its own subset and its own extra
    'src/core/import-graph.js', 'src/core/workspaces.js', 'src/core/dependency-reachability.js',
    'src/core/safe-fs.js', 'src/core/universal-checker.js', 'src/core/gitignore.js',
    'src/modules/cross-file-taint.js', 'src/modules/undefined-ref.js', 'src/modules/openapi-drift.js',
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
    assert.match(src, /walk-excludes/, `${rel} does not import the list`);
    assert.doesNotMatch(src, /'node_modules',\s*'\.git'/, `${rel} carries its own copy`);
  }
});

test('no file under src/ declares a private exclude list (the shape, not the name — Doctrine §5)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const rel = path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/');
      if (rel === 'src/core/walk-excludes.js') continue;
      const src = fs.readFileSync(full, 'utf-8');
      // A literal array/Set that lists node_modules alongside .git is a walk-exclude list.
      if (/\[[^\]]*'node_modules'[^\]]*'\.git'[^\]]*\]/s.test(src) || /\[[^\]]*'\.git'[^\]]*'node_modules'[^\]]*\]/s.test(src)) offenders.push(rel);
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `private walk-exclude lists: ${offenders.join(', ')} — import src/core/walk-excludes.js`);
});
