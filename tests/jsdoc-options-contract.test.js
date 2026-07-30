'use strict';

// ============================================================================
// JSDoc OPTION CONTRACT — a function must read what it claims to accept
// ============================================================================
// KI #95 was a parameter threaded through three layers and silently discarded.
// Three attempts to detect that class statically all failed on INDIRECTION
// (registry path strings, bare-name matching, a DI function reference) — see
// KI #96. This check succeeds because it never crosses a boundary: it compares
// what ONE function's JSDoc claims to accept against what that SAME function
// body actually reads.
//
// It found three real phantom parameters on first run, two of them passed by
// live callers and discarded:
//   composePrBody(repoUrl)        <- passed by /api/scan/fix
//   sendGithubCallback(ref)       <- passed by the worker tick
//   renderInitialReport(metadata) <- documented, never passed
// None had ever been read since the day it was introduced.
//
// The guards below deliberately SKIP rather than report whenever use cannot be
// proven from the body alone (rest elements, whole-bag forwarding). A false
// positive here would block the gate on a lie, which is worse than missing one
// — Forbidden #25.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.gatetest',
  // Fixture corpora: deliberately imperfect code used as scan targets.
  'reliability-corpus', 'arena-scaffold',
]);
const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts']);

const isTestPath = (p) => /(^|[\\/])tests?[\\/]|\.(test|spec)\./.test(p);

function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (EXCLUDED_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else if (SOURCE_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * Find options documented on a function's JSDoc that the function never reads.
 * Pure string analysis so it can be exercised by the controls below.
 */
function analyseSource(src) {
  const findings = [];
  if (!src.includes('@param')) return findings;

  // A docblock must not itself contain `*/`, or the non-greedy match backtracks
  // across several blocks and attributes one function's @param tags to another
  // function's body. (That mistake produced 36 fake findings while developing.)
  const re = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;

  let m;
  while ((m = re.exec(src))) {
    const [, doc, fnName, params] = m;

    const documented = [];
    const paramRe = /@param\s+\{[^}]*\}\s+\[?([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
    let d;
    while ((d = paramRe.exec(doc))) documented.push({ bag: d[1], key: d[2] });
    if (documented.length === 0) continue;

    // Balanced body scan from the opening brace.
    let i = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;

    const body = src.slice(m.index + m[0].length, end);
    const surface = params + '\n' + body;

    for (const { bag, key } of documented) {
      // Rest element — everything is captured.
      if (/\.\.\./.test(params) || new RegExp('\\.\\.\\.\\s*' + bag).test(body)) continue;

      // Whole-bag forwarding: the bag is handed to another function or returned,
      // so the keys are consumed a level down and non-use cannot be proven here.
      const forwarded = new RegExp(
        '[({,[]\\s*' + bag + '\\s*[),\\]}|]|\\breturn\\s+' + bag + '\\b'
      ).test(body);
      if (forwarded) continue;

      const used = new RegExp('\\b' + key + '\\b').test(surface)
        || new RegExp("\\[['\"]" + key + "['\"]\\]").test(surface);
      if (!used) findings.push({ fn: fnName, key });
    }
  }
  return findings;
}

// ─── the repo-wide assertion ─────────────────────────────────────────────────

test('no production function documents an option it never reads', () => {
  const files = walk(REPO_ROOT).filter((f) => !isTestPath(f));
  assert.ok(files.length > 300, `expected to walk the codebase, found ${files.length} files`);

  const violations = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const v of analyseSource(src)) {
      violations.push(`${path.relative(REPO_ROOT, file).replace(/\\/g, '/')}  ${v.fn}() documents "${v.key}" but never reads it`);
    }
  }

  assert.deepEqual(
    violations.sort(),
    [],
    'Documented-but-unread option(s):\n  ' + violations.sort().join('\n  ') +
      '\n\nEither read the option or stop documenting it. A caller that passes it ' +
      'is having its argument silently discarded — that is exactly how KI #95 hid ' +
      'in the paid Forensic path.'
  );
});

// ─── controls: the check must actually detect, and must not over-detect ──────

test('POSITIVE CONTROL — a planted phantom option is detected', () => {
  const planted = `
/**
 * @param {object} opts
 * @param {string} opts.used
 * @param {string} [opts.phantom]
 */
function widget(opts) {
  const { used } = opts;
  return used.trim();
}
`;
  const found = analyseSource(planted);
  assert.equal(found.length, 1, 'expected exactly one finding');
  assert.equal(found[0].fn, 'widget');
  assert.equal(found[0].key, 'phantom');
});

test('NEGATIVE CONTROL — an option that IS read is not reported', () => {
  const clean = `
/**
 * @param {object} opts
 * @param {string} opts.alpha
 * @param {string} [opts.beta]
 */
function widget({ alpha, beta }) {
  return alpha + (beta || '');
}
`;
  assert.deepEqual(analyseSource(clean), []);
});

test('NEGATIVE CONTROL — whole-bag forwarding is not reported', () => {
  // The keys are read one level down; proving non-use from this body is
  // impossible, so the check must stay silent rather than guess.
  const forwarding = `
/**
 * @param {object} entry
 * @param {string} entry.layer
 * @param {boolean} entry.success
 */
function record(entry) {
  return sanitise(entry);
}
`;
  assert.deepEqual(analyseSource(forwarding), []);
});

test('NEGATIVE CONTROL — a rest element captures everything', () => {
  const rest = `
/**
 * @param {object} opts
 * @param {string} opts.anything
 */
function widget({ known, ...rest }) {
  return { known, rest };
}
`;
  assert.deepEqual(analyseSource(rest), []);
});

test('the docblock matcher does not span multiple comment blocks', () => {
  // Regression guard for the bug that produced 36 fake findings: a non-greedy
  // match that backtracks across `*/` attributes one function's @param tags to
  // a later function's body.
  const twoBlocks = `
/**
 * @param {object} opts
 * @param {string} opts.alpha
 */
function first({ alpha }) { return alpha; }

/**
 * Unrelated helper.
 */
function second(x) { return x; }
`;
  assert.deepEqual(analyseSource(twoBlocks), []);
});
