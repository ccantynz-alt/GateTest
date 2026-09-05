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
  for (const must of ['node_modules', '.git', '.gatetest', 'dist', 'build', 'coverage', '.next', 'vendor', '.claude']) {
    assert.ok(WALK_EXCLUDES.includes(must), `${must} missing`);
  }
});

test('the three walkers import it rather than carrying a copy', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of ['src/modules/base-module.js', 'src/core/migration-dirs.js', 'src/core/tree-copy.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
    assert.match(src, /walk-excludes/, `${rel} does not import the list`);
    assert.doesNotMatch(src, /'node_modules',\s*'\.git',\s*'dist'/, `${rel} carries its own copy`);
  }
});
