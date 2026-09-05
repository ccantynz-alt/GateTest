'use strict';
/**
 * One definition of where a string or comment begins and ends:
 * src/core/source-strip.js, reached by modules as BaseModule._maskedLines.
 * A per-line quote counter — `isInString(line, idx)`, `_isInsideStringLiteral`,
 * `_stripJsStrings` — is a second stripper that cannot see a template literal
 * or a block comment spanning lines. Twenty-one modules carried one on
 * 2026-09-05 (KI #77); this guard fails on the SHAPE of a new one (Doctrine §5).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCANNED = ['src/modules', 'src/core'];
// test-runner.js parses a COMMAND LINE (shell quoting), not source text.
const ALLOW = new Set(['src/core/source-strip.js', 'src/core/test-runner.js']);
const SHAPES = [
  // the names the copies went by
  /function\s+(?:_?isInString|_isInsideStringText|_?matchOutsideString|_?stripJsStrings|_?maskNonCode|_?stripLineLiterals|_maskedSource)\s*\(/,
  /\b_isInsideStringLiteral\s*\(/,
  /\b_stripJsStrings\s*\(/,
  // the counter itself: toggling an in-quote flag per character, or a quote
  // variable assigned from the character being walked
  /in(?:Single|Double|Tick|S|D|T)\s*=\s*!in(?:Single|Double|Tick|S|D|T)\b/,
  /\bquote\s*=\s*ch\b/,
];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no module or core file carries its own string/comment guard', () => {
  const offenders = [];
  for (const rel of SCANNED) {
    for (const full of walk(path.join(ROOT, rel), [])) {
      const r = path.relative(ROOT, full).split(path.sep).join('/');
      if (ALLOW.has(r)) continue;
      const src = fs.readFileSync(full, 'utf-8');
      for (const re of SHAPES) if (re.test(src)) { offenders.push(`${r} (${re.source.slice(0, 40)})`); break; }
    }
  }
  assert.deepEqual(offenders, [], `private string guards — use BaseModule._maskedLines / src/core/source-strip.js:\n  ${offenders.join('\n  ')}`);
});
