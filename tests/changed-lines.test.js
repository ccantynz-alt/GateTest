// =============================================================================
// changed-lines — "in this change" means the lines, not the file
// =============================================================================
// The hosted PR comment and strict-mode enforcement both key off `inDiff`.
// File-level attribution turned every old finding in a touched file into
// "in this change"; this helper is what makes the tag mean what it says.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { changedLines, lineInChange, ALL, REWRITE_EDIT_CAP } = require('../website/app/lib/changed-lines');

const sorted = (s) => Array.from(s).sort((x, y) => x - y);

describe('changedLines', () => {
  it('identical content touches nothing', () => {
    assert.deepStrictEqual(sorted(changedLines('a\nb\nc\n', 'a\nb\nc\n')), []);
  });

  it('a new file is all change', () => {
    assert.strictEqual(changedLines(undefined, 'a\nb\n'), ALL);
    assert.strictEqual(changedLines(null, 'a\nb\n'), ALL);
  });

  it('an inserted line is the only changed line', () => {
    assert.deepStrictEqual(sorted(changedLines('a\nb\nc\n', 'a\nb\nNEW\nc\n')), [3]);
  });

  it('a modified line is reported at its new position', () => {
    assert.deepStrictEqual(sorted(changedLines('a\nb\nc\n', 'a\nB\nc\n')), [2]);
  });

  it('a deleted line touches no surviving line', () => {
    assert.deepStrictEqual(sorted(changedLines('a\nb\nc\n', 'a\nc\n')), []);
  });

  it('an insertion above an old finding does not make the old line "changed"', () => {
    // The finding on `eval(x)` moves from line 2 to line 3 but the line
    // itself is untouched — the whole point of doing this at line level.
    const before = 'import x\neval(x)\nexport y\n';
    const after = 'import x\nimport z\neval(x)\nexport y\n';
    const changed = changedLines(before, after);
    assert.deepStrictEqual(sorted(changed), [2]);
    assert.strictEqual(lineInChange(changed, 3), false);
    assert.strictEqual(lineInChange(changed, 2), true);
  });

  it('handles CRLF and a missing trailing newline the same as LF', () => {
    assert.deepStrictEqual(sorted(changedLines('a\r\nb\r\nc\r\n', 'a\nb\nc')), []);
    assert.deepStrictEqual(sorted(changedLines('a\nb\nc', 'a\nb\nc\nd')), [4]);
  });

  it('a multi-hunk change reports every hunk', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const lines = before.split('\n');
    lines[4] = 'changed 5';
    lines.splice(20, 0, 'inserted after 20');
    lines[27] = 'changed 27';
    const changed = changedLines(before, lines.join('\n'));
    assert.deepStrictEqual(sorted(changed), [5, 21, 28]);
  });

  // No wall-clock assertions here — our own flakyTests module flags them,
  // and it is right: a timing bound is a CI-load lottery. The cap IS the
  // bound: past REWRITE_EDIT_CAP edits the diff stops and answers ALL.
  it('a rewrite past the edit cap is all change', () => {
    const before = Array.from({ length: REWRITE_EDIT_CAP + 500 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: REWRITE_EDIT_CAP + 500 }, (_, i) => `new ${i}`).join('\n');
    assert.strictEqual(changedLines(before, after), ALL);
  });

  it('a large file with a small edit is exact', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `const v${i} = ${i};`);
    const before = lines.join('\n');
    lines[12345] = 'const v12345 = eval(input);';
    assert.deepStrictEqual(sorted(changedLines(before, lines.join('\n'))), [12346]);
  });
});

describe('lineInChange', () => {
  it('a finding with no line in a changed file is attributed to the change', () => {
    assert.strictEqual(lineInChange(new Set([3]), null), true);
    assert.strictEqual(lineInChange(new Set([3]), undefined), true);
  });
  it('ALL admits every line; a non-set admits none', () => {
    assert.strictEqual(lineInChange(ALL, 999), true);
    assert.strictEqual(lineInChange(null, 1), false);
  });
});
