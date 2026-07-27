/**
 * KI #77 — CRLF line-splitting ratchet.
 *
 * `content.split('\n')` leaves a trailing `\r` on every line of a CRLF file.
 * KI #49 was a real instance of the resulting bug class, found by hand. An
 * audit on 2026-07-27 found 135 more bare splits across 74 module files with
 * no lint rule or test preventing the next one.
 *
 * HONEST SCOPE — read before trusting this file to mean more than it does.
 * Converting the 52 analysis-only modules did NOT fix an observed defect.
 * A LF-vs-CRLF parity scan over a fixture repo produced identical findings
 * both before and after the change. The reason is that most `$`-anchored
 * rules in this codebase are written `/...\s*$/`, and `\s` matches `\r`, so
 * they were already CRLF-tolerant by accident. The change is preventive
 * hardening plus a uniform invariant — not a bug fix. Claiming otherwise
 * would be exactly the kind of overstatement KI #78 had to be corrected for.
 *
 * What this test DOES enforce:
 *   1. New bare `.split('\n')` cannot be added to an already-converted module.
 *   2. The remaining debt is an explicit, shrinking list — not silent drift.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');
const BARE_SPLIT = /\.split\(\s*(['"])\\n\1\s*\)/g;
const BARE_JOIN = /\.join\(\s*(['"])\\n\1\s*\)/;

/**
 * Modules still using a bare split. Every one of these ALSO contains a
 * `.join('\n')`, which is why they were not converted mechanically: if the
 * split feeds an edit that is re-joined and written back, changing the split
 * strips `\r` and silently rewrites the customer's line endings. Each needs
 * its split and its join converted together, by hand, with the file-writing
 * path checked.
 *
 * This list may only ever SHRINK. Use src/core/text-lines.js when converting.
 */
const KNOWN_UNCONVERTED = new Set([
  'ai-review.js',
  'auth-bypass.js',
  'ci-security.js',
  'code-quality.js',
  'cross-file-taint.js',
  'duplicate-code.js',
  'error-swallow.js',
  'fake-fix-detector.js',
  'hardcoded-url.js',
  'integration-tests.js',
  'kubernetes.js',
  'lint.js',
  'mutation.js',
  'n-plus-one.js',
  'race-condition.js',
  'regression-predictor.js',
  'retry-hygiene.js',
  'rollback-honesty.js',
  'runtime-errors.js',
  'sql-migrations.js',
  'ssrf.js',
  'terraform.js',
]);

function moduleFiles() {
  return fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith('.js'));
}

describe('KI #77 — CRLF ratchet over src/modules', () => {
  it('no CONVERTED module regrows a bare split', () => {
    const offenders = [];
    for (const f of moduleFiles()) {
      if (KNOWN_UNCONVERTED.has(f)) continue;
      const src = fs.readFileSync(path.join(MODULES_DIR, f), 'utf8');
      const hits = src.match(BARE_SPLIT);
      if (hits) offenders.push(`${f} (${hits.length})`);
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'use split(/\\r?\\n/) or src/core/text-lines.js splitLines() — see this file\'s header',
    );
  });

  it('the debt list only shrinks — every entry must still have a bare split', () => {
    const stale = [];
    for (const f of KNOWN_UNCONVERTED) {
      const p = path.join(MODULES_DIR, f);
      if (!fs.existsSync(p)) { stale.push(`${f} (file gone)`); continue; }
      if (!BARE_SPLIT.test(fs.readFileSync(p, 'utf8'))) stale.push(`${f} (already clean)`);
      BARE_SPLIT.lastIndex = 0;
    }
    assert.deepStrictEqual(stale, [], 'converted a module? remove it from KNOWN_UNCONVERTED');
  });

  it('every unconverted module is unconverted for the documented reason', () => {
    // The list is not "modules we did not get to" — it is specifically
    // "modules where the split may feed a file rewrite". If one of these
    // loses its join, it becomes mechanically convertible and should be.
    const noJoin = [];
    for (const f of KNOWN_UNCONVERTED) {
      const p = path.join(MODULES_DIR, f);
      if (!fs.existsSync(p)) continue;
      if (!BARE_JOIN.test(fs.readFileSync(p, 'utf8'))) noJoin.push(f);
    }
    assert.deepStrictEqual(
      noJoin,
      [],
      'these no longer join on newline, so the rewrite risk is gone — convert them',
    );
  });
});

describe('KI #77 — text-lines helper', () => {
  const { splitLines, detectEol, joinLines } = require('../src/core/text-lines');

  it('splits LF and CRLF identically', () => {
    assert.deepStrictEqual(splitLines('a\nb\nc'), ['a', 'b', 'c']);
    assert.deepStrictEqual(splitLines('a\r\nb\r\nc'), ['a', 'b', 'c']);
  });

  it('leaves no carriage return behind — the whole point', () => {
    assert.ok(splitLines('x = 1;\r\ny = 2;\r\n').every((l) => !l.includes('\r')));
  });

  it('tolerates non-strings rather than throwing', () => {
    assert.deepStrictEqual(splitLines(null), []);
    assert.deepStrictEqual(splitLines(undefined), []);
    assert.deepStrictEqual(splitLines(42), []);
  });

  it('detectEol + joinLines round-trip preserves the original endings', () => {
    assert.strictEqual(detectEol('a\r\nb'), '\r\n');
    assert.strictEqual(detectEol('a\nb'), '\n');
    const crlf = 'a\r\nb\r\nc';
    assert.strictEqual(joinLines(splitLines(crlf), crlf), crlf, 'a CRLF file must stay CRLF');
    const lf = 'a\nb\nc';
    assert.strictEqual(joinLines(splitLines(lf), lf), lf);
  });

  it('a $-anchored rule matches on CRLF only after splitLines', () => {
    // Concretely why the invariant matters, even though the audit found the
    // existing rules were accidentally tolerant.
    const crlf = 'const a = 1;\r\nconst b = 2;\r\n';
    const bare = crlf.split('\n');
    const safe = splitLines(crlf);
    assert.strictEqual(bare.filter((l) => /;$/.test(l)).length, 0, 'bare split: $ blocked by \\r');
    assert.strictEqual(safe.filter((l) => /;$/.test(l)).length, 2, 'splitLines: rule fires');
  });
});
