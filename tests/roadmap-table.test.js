'use strict';
/**
 * The Known Issues table must stay machine-readable.
 *
 * `docs/ROADMAP.md` is the work queue — CLAUDE.md sends every session to it to
 * pick up work. So a structurally broken row is not a cosmetic problem: it
 * changes what gets worked on.
 *
 * Found 2026-07-30: KI #75's row had been split across two physical lines, so the
 * line starting `| 75 |` carried the description but no Severity or Status cell —
 * the "RESOLVED" status was orphaned on the following line. Consequence: triaging
 * open issues by filtering rows on "RESOLVED" listed #75 as OPEN, and a session
 * nearly re-did work that had already shipped. The same row also carried a stray
 * empty cell, giving it 5 columns against a 4-column header.
 *
 * A markdown table tolerates this visually enough that nobody notices, which is
 * exactly why it needs a test rather than a proofread.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { splitLines } = require('../src/core/text-lines');

const ROADMAP = path.join(__dirname, '..', 'docs', 'ROADMAP.md');

/** The Known Issues table: its header, separator, and every row after it. */
function knownIssuesTable() {
  const lines = splitLines(fs.readFileSync(ROADMAP, 'utf-8'));
  const start = lines.findIndex((l) => /^##\s+KNOWN ISSUES/i.test(l));
  assert.ok(start >= 0, 'could not find the "## KNOWN ISSUES" heading');

  const header = lines.findIndex((l, i) => i > start && /^\|\s*#\s*\|/.test(l));
  assert.ok(header > start, 'could not find the table header row');

  const rows = [];
  for (let i = header + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;                 // next section ends the table
    if (/^\|\s*\d+\s*\|/.test(line)) rows.push({ line, no: i + 1 });
    else if (/^---\s*$/.test(line)) break;
  }
  return { lines, header, rows, headerLine: lines[header] };
}

/**
 * Cells of a pipe-delimited row, excluding the empty edges.
 *
 * Splits on UNESCAPED pipes only. A naive `split('|')` reports a false positive
 * on every row that legitimately contains `\|` inside code — and this table has
 * several (`tier \|\| "quick"`, `$ ( ) ; & \|`, `gitlab\|circleci`). Those rows
 * are correct markdown; a guard that flagged them would train people to ignore it.
 *
 * Note a raw `|` still breaks a cell even inside backticks, which is a real
 * defect and stays reported — that is how KI #89 was found with 10 cells.
 */
function cells(line) {
  const parts = line.split(/(?<!\\)\|/);
  return parts.slice(1, parts.length - 1);
}

describe('ROADMAP Known Issues table — structure', () => {
  const { rows, headerLine } = knownIssuesTable();
  const expected = cells(headerLine).length;

  it('has a 4-column header (#, Issue, Severity, Status)', () => {
    assert.strictEqual(expected, 4, `header declares ${expected} columns`);
  });

  it('found a plausible number of issue rows', () => {
    // Guards against the selector silently matching nothing, which would make
    // every assertion below vacuously true.
    assert.ok(rows.length > 40, `only found ${rows.length} issue rows — selector is probably wrong`);
  });

  it('every row has exactly as many cells as the header', () => {
    const bad = rows
      .filter((r) => cells(r.line).length !== expected)
      .map((r) => `line ${r.no}: KI ${cells(r.line)[0].trim()} has ${cells(r.line).length} cells, expected ${expected}`);
    assert.deepStrictEqual(bad, [],
      'A row split across two lines, or carrying a stray/unescaped "|", loses its Severity '
      + 'and Status cells — which is how a RESOLVED issue reads as open.');
  });

  it('every row has a non-empty Severity and Status', () => {
    const bad = [];
    for (const r of rows) {
      const c = cells(r.line);
      if (c.length !== expected) continue;                    // reported above
      if (!c[2].trim()) bad.push(`line ${r.no}: KI ${c[0].trim()} has an empty Severity`);
      if (!c[3].trim()) bad.push(`line ${r.no}: KI ${c[0].trim()} has an empty Status`);
    }
    assert.deepStrictEqual(bad, []);
  });

  it('has no continuation lines inside the table', () => {
    // The exact shape of the #75 corruption: a line that does not start with a
    // pipe but ends with one, sitting between rows.
    const { lines, header } = knownIssuesTable();
    const bad = [];
    for (let i = header + 2; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) break;
      const l = lines[i];
      if (!l.trim()) continue;
      if (!l.startsWith('|') && /\|\s*$/.test(l)) {
        bad.push(`line ${i + 1}: continuation of the previous row — [${l.slice(0, 50)}…]`);
      }
    }
    assert.deepStrictEqual(bad, []);
  });

  it('issue numbers are unique', () => {
    const seen = new Map();
    const dupes = [];
    for (const r of rows) {
      const n = cells(r.line)[0].trim();
      if (seen.has(n)) dupes.push(`KI ${n} appears on lines ${seen.get(n)} and ${r.no}`);
      else seen.set(n, r.no);
    }
    assert.deepStrictEqual(dupes, []);
  });
});
