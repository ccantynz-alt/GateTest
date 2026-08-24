/**
 * Path allow-list on fix write targets (2026-08-18 audit #7).
 * Existing-file fixes: structural safety only. New (model-invented) files:
 * additionally no .github/, no root dotfiles, extension allow-list.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateFixPath, filterFixesByPath } = require('../website/app/lib/fix-path-guard');

test('existing-file fixes: ordinary repo paths pass', () => {
  assert.equal(validateFixPath({ file: 'src/a.js', original: 'x' }).ok, true);
  assert.equal(validateFixPath({ file: 'deep/dir/with space/file.py', original: 'x' }).ok, true);
  // Modules legitimately FIX existing workflows (ciSecurity SHA-pinning).
  assert.equal(validateFixPath({ file: '.github/workflows/ci.yml', original: 'old' }).ok, true);
  assert.equal(validateFixPath({ file: '.env.example', original: 'old' }).ok, true);
});

test('structural rejections apply to every trust level', () => {
  for (const file of ['../evil.js', 'a/../../b.js', '/etc/passwd', 'C:/x.js', '~/x.js', 'a\\b.js', 'a//b.js', '', 'x/'.padEnd(600, 'a')]) {
    const r = validateFixPath({ file, original: 'x' });
    assert.equal(r.ok, false, `${JSON.stringify(file)} must be rejected`);
  }
});

test('control characters in a path are rejected', () => {
  const r = validateFixPath({ file: 'a\u0000b.js', original: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /control character/);
});

test('new files may not land in the CI execution surface or as dotfiles', () => {
  assert.equal(validateFixPath({ file: '.github/workflows/steal.yml', original: '' }).ok, false);
  assert.equal(validateFixPath({ file: '.github/actions/x/action.yml', original: '' }).ok, false);
  assert.equal(validateFixPath({ file: '.npmrc', original: '' }).ok, false);
  assert.equal(validateFixPath({ file: 'src/.env', original: '' }).ok, false);
});

test('new files need an allow-listed extension', () => {
  assert.equal(validateFixPath({ file: 'bin/run.sh', original: '' }).ok, false);
  assert.equal(validateFixPath({ file: 'tests/gen.test.js', original: '' }).ok, true);
  assert.equal(validateFixPath({ file: 'reports/ciso-report.md', original: '' }).ok, true);
});

test('filterFixesByPath partitions and preserves order', () => {
  const { allowed, rejected } = filterFixesByPath([
    { file: 'src/a.js', original: 'x', fixed: 'y', issues: [] },
    { file: '../evil.js', original: 'x', fixed: 'y', issues: [] },
    { file: 'tests/t.test.js', original: '', fixed: 'y', issues: [] },
  ]);
  assert.deepEqual(allowed.map((f) => f.file), ['src/a.js', 'tests/t.test.js']);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /traversal/);
});
