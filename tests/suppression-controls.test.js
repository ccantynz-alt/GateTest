/**
 * THE TRIPWIRE FOR THE DEFECT CLASS THAT KEEPS COMING BACK.
 *
 * On 2026-08-31 the same bug was found five times in one day, across two
 * products: a suppression written to silence ONE false positive, widened until
 * it silenced a whole real class, with nothing afterwards proving the rule
 * still fired.
 *
 *   secrets.js   `if (/process\.env\b/.test(line)) continue;`
 *                → every env-var fallback credential unreachable
 *   secrets.js   `if (/===|!==/.test(line)) continue;`
 *                → any hardcoded key sharing a line with a comparison
 *   secrets.js   my own first fix ended in `continue`, rebuilding the skip
 *   datetime-bug `if (/\b(?:import|require)\b/.test(line)) continue;`
 *                → guarded nothing (an import specifier never contains
 *                  `moment(`) while silencing real calls
 *   /api/status  detected the fake credential, then reported ready: true
 *
 * The convention "every suppression ships a positive control" has now been
 * written down twice and rotted twice. A convention is a habit; this is a test.
 *
 * THE RULE, and why it is drawn here:
 *
 * An ANCHORED whole-line skip (`/^\s*#/`, or the comment-line one) is
 * structural — it
 * identifies what a line IS: a comment, a blank. That cannot silence a class
 * of findings hiding elsewhere on the line, so it needs no control.
 *
 * An UNANCHORED one (`/process\.env\b/`, `/===|!==/`) asks only whether a
 * substring appears ANYWHERE on the line, then discards the entire line. That
 * is the dangerous shape: the thing it was aimed at and every real finding
 * that happens to share the line die together. Those must carry
 *
 *     // suppression-control: tests/<file>.test.js
 *
 * naming a test that proves the rule STILL FIRES on a genuine defect.
 *
 * If this test fails on code you just wrote: do not add the annotation to make
 * it pass. Narrow the skip so it stops discarding whole lines — that is what
 * the fixes above did, and in one case the skip turned out to protect nothing
 * at all and was simply deleted.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// `if (<regex>.test(<lineVar>)) continue;` — a whole-line skip in a scan loop.
const SKIP_RE = /if\s*\(\s*(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+\/[a-z]*)\s*\.test\(\s*(?:line|trimmed|raw|l)\s*\)\s*\)\s*continue\s*;/g;

const ANNOTATION_RE = /\/\/\s*suppression-control:\s*(tests\/[\w.-]+\.test\.js)/;

// A control file must show the rule still catching something real.
const POSITIVE_CONTROL_RE =
  /positive control|still fires?|must still (?:be )?(?:caught|found|fire|report)|finds a real/i;

function sourceFiles() {
  const dirs = [path.join(ROOT, 'src', 'modules'), path.join(ROOT, 'src', 'core')];
  const out = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.js')) out.push(path.join(dir, name));
    }
  }
  return out;
}

/** Anchored at line start = structural (identifies what the line IS). */
function isAnchored(regexLiteral) {
  const body = regexLiteral.replace(/^\//, '').replace(/\/[a-z]*$/, '');
  return body.startsWith('^');
}

function findSkips() {
  const found = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      SKIP_RE.lastIndex = 0;
      const m = SKIP_RE.exec(lines[i]);
      if (!m) continue;
      // A skip quoted inside a `//` comment does not execute. Modules explain
      // removed skips by quoting them (that is how the fix is documented), and
      // flagging the explanation would push the next author to re-add the
      // annotation instead of reading why the code went away.
      const commentAt = lines[i].indexOf('//');
      if (commentAt !== -1 && commentAt < m.index) continue;
      if (isAnchored(m[1])) continue;
      // The annotation may sit on any of the 8 lines above (these skips carry
      // real explanations, so the marker is not always immediately adjacent).
      const preamble = lines.slice(Math.max(0, i - 8), i).join('\n');
      found.push({
        file: path.relative(ROOT, file).split(path.sep).join('/'),
        line: i + 1,
        regex: m[1],
        annotation: (ANNOTATION_RE.exec(preamble) || [])[1] || null,
      });
    }
  }
  return found;
}

describe('suppression controls', () => {
  it('every unanchored whole-line skip names a control test', () => {
    const unannotated = findSkips().filter((s) => !s.annotation);
    assert.deepStrictEqual(
      unannotated.map((s) => `${s.file}:${s.line}  ${s.regex}`),
      [],
      'An unanchored `.test(line) → continue` discards the WHOLE line, so it '
      + 'silences every real finding that happens to share it. Narrow the skip '
      + 'so it stops discarding whole lines; only if it genuinely must stay, '
      + 'add `// suppression-control: tests/<file>.test.js` naming a test that '
      + 'proves the rule still fires on a real defect.',
    );
  });

  it('every named control test exists and proves the rule still fires', () => {
    const problems = [];
    for (const s of findSkips()) {
      if (!s.annotation) continue;
      const abs = path.join(ROOT, s.annotation);
      if (!fs.existsSync(abs)) {
        problems.push(`${s.file}:${s.line} names ${s.annotation}, which does not exist`);
        continue;
      }
      if (!POSITIVE_CONTROL_RE.test(fs.readFileSync(abs, 'utf8'))) {
        problems.push(
          `${s.file}:${s.line} names ${s.annotation}, but that file contains no `
          + 'positive control — nothing in it asserts the rule still catches a real defect',
        );
      }
    }
    assert.deepStrictEqual(problems, []);
  });

  // ---- the detector must itself work -------------------------------------
  // Without these, this whole file could silently match nothing and pass
  // forever — which is the exact failure it exists to prevent.

  it('POSITIVE CONTROL: the detector catches the shapes that caused the incidents', () => {
    const hits = [];
    for (const src of [
      `        if (/process\\.env\\b/.test(line)) continue;`,
      `        if (/===|!==/.test(line)) continue;`,
      `        if (/\\b(?:import|require)\\b/.test(line)) continue;`,
    ]) {
      SKIP_RE.lastIndex = 0;
      const m = SKIP_RE.exec(src);
      hits.push(Boolean(m) && !isAnchored(m[1]));
    }
    assert.deepStrictEqual(hits, [true, true, true],
      'the detector must match the three real skips that shipped bugs');
  });

  it('NEGATIVE CONTROL: anchored structural skips are not flagged', () => {
    for (const src of [
      `      if (/^\\s*#/.test(line)) continue;`,
      `        if (/^\\s*\\*/.test(line)) continue;`,
    ]) {
      SKIP_RE.lastIndex = 0;
      const m = SKIP_RE.exec(src);
      assert.ok(m, `expected the skip to parse: ${src}`);
      assert.strictEqual(isAnchored(m[1]), true, `expected anchored: ${src}`);
    }
  });

  it('the detector is actually scanning a real corpus', () => {
    // Guards against a refactor that quietly points this at an empty directory.
    assert.ok(sourceFiles().length > 100,
      `expected to scan the module + core corpus, saw ${sourceFiles().length} files`);
  });
});
