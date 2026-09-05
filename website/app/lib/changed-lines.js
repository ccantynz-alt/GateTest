'use strict';

/**
 * Which lines of a file did a change touch?
 *
 * The hosted scan tags every finding `inDiff` so a PR comment can say "in
 * this change" and strict mode can enforce only on what the change did
 * (gate-verdict.js). Until 2026-09-05 that tag was FILE-level: touch one
 * line of a 900-line file and every old finding in it became "in this
 * change" — which is the SonarQube complaint about old code counted as new,
 * moved one level down. Line-level is what "new code" means everywhere else
 * (Sonar's new-code period, reviewdog's `added` filter, GitHub's own
 * in-diff annotations).
 *
 * `changedLines(before, after)` returns the 1-based line numbers of `after`
 * that a change inserted or modified — the right-hand side of a line diff —
 * or the sentinel ALL when the whole file counts as changed: a new file,
 * or a rewrite so large that attributing individual lines would be a
 * fiction. Deleted lines have no line in `after` and so cannot carry a
 * finding.
 *
 * No dependency: a Myers O(ND) diff over line arrays. D is capped — past
 * REWRITE_EDIT_CAP edits the file is treated as rewritten, which keeps a
 * 20,000-line generated file from costing a quadratic amount of memory and
 * is also the honest answer for it.
 */

const ALL = 'all';
const REWRITE_EDIT_CAP = 4000;

function splitLines(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  // A trailing newline is a terminator, not an empty last line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Myers' greedy diff. Returns the set of indices into `b` that are not part
 * of the longest common subsequence — i.e. inserted lines — or null when
 * the edit distance exceeds `cap`.
 */
function insertedIndices(a, b, cap) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return new Set();
  const limit = Math.min(max, cap);
  const offset = limit + 1;
  const size = 2 * offset + 1;
  let v = new Int32Array(size).fill(0);
  v[offset + 1] = 0;
  const trace = [];

  for (let d = 0; d <= limit; d += 1) {
    const vd = Int32Array.from(v);
    trace.push(vd);
    for (let k = -d; k <= d; k += 2) {
      const ki = offset + k;
      let x;
      if (k === -d || (k !== d && vd[ki - 1] < vd[ki + 1])) x = vd[ki + 1];
      else x = vd[ki - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[ki] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset);
    }
  }
  return null;
}

/** Walk the trace back from (n, m) and collect the `b` indices of insertions. */
function backtrack(trace, a, b, dFinal, offset) {
  const inserted = new Set();
  let x = a.length;
  let y = b.length;
  for (let d = dFinal; d > 0; d -= 1) {
    const vd = trace[d];
    const k = x - y;
    const ki = offset + k;
    let prevK;
    if (k === -d || (k !== d && vd[ki - 1] < vd[ki + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    // Undo the snake (matching lines) first.
    while (x > prevX && y > prevY) { x -= 1; y -= 1; }
    // Then the single edit: a vertical step is an insertion into b.
    if (x === prevX) inserted.add(prevY);
    x = prevX;
    y = prevY;
  }
  return inserted;
}

/**
 * @param {string|undefined|null} before  file content at the base commit; undefined/null = file did not exist
 * @param {string} after                   file content at the head commit
 * @returns {Set<number>|'all'}            1-based line numbers of `after` that the change touched
 */
function changedLines(before, after) {
  if (before === undefined || before === null) return ALL;
  if (before === after) return new Set();
  const a = splitLines(before);
  const b = splitLines(after);
  const inserted = insertedIndices(a, b, REWRITE_EDIT_CAP);
  if (inserted === null) return ALL;
  const lines = new Set();
  for (const i of inserted) lines.add(i + 1);
  return lines;
}

/**
 * Does a finding at `line` fall inside what the change touched? A finding
 * with no line anchor in a changed file is attributed to the change — the
 * conservative direction, since the alternative hides it.
 */
function lineInChange(changed, line) {
  if (changed === ALL) return true;
  if (!(changed instanceof Set)) return false;
  if (typeof line !== 'number' || !Number.isFinite(line)) return true;
  return changed.has(line);
}

module.exports = { changedLines, lineInChange, ALL, REWRITE_EDIT_CAP };
