/**
 * One definition of "a JavaScript/TypeScript source file".
 *
 * Twenty-one call sites across the modules collected
 * `['.js', '.ts', '.jsx', '.tsx']` and none of them included `.mjs` or
 * `.cjs`. Those are not exotic: `.mjs` is how Node marks an ES module and
 * `.cjs` how it marks CommonJS inside an ESM package. GateTest's own MCP
 * server is `bin/gatetest-mcp.mjs`.
 *
 * The consequence in the security module was total, not partial: the entire
 * dangerous-pattern scan — eval, the Function constructor, shell exec with
 * interpolated input, NoSQL injection, path traversal, open redirect,
 * Math.random for secrets — never ran on a `.mjs` file at all.
 *
 * Found 2026-09-01 by a cross-engine diff, not by reading code. Gluecron's
 * scanner reported three `no-eval` findings on `ccantynz/Gluecron.com`
 * @e168803 that GateTest did not. Two were their false positives — comments
 * reading "we never `eval()`" and "NO eval(), NO Function constructor",
 * which our comment guard correctly suppresses. The third was real:
 *
 *     scripts/interaction-audit.mjs:180   return eval(checkSrc)(panel);
 *
 * A live eval of a fetched string, invisible to us because of a file
 * extension. Their noisier rule saw what our more careful one could not,
 * because precision on files you never open is not precision.
 *
 * The knowledge already existed in this codebase — `src/core/confidence.js`
 * has SOURCE_EXT_RE listing mjs/cjs/mts/cts — and had not been generalised.
 * That is the fourth instance of this pattern found in one day; hence a
 * shared module rather than a fifth local list.
 */

/** Extensions the JS/TS scanners should open. */
const JS_SOURCE_EXTS = Object.freeze([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
]);

/** The non-JSX subset, for scanners that only parse plain modules. */
const JS_SOURCE_EXTS_NO_JSX = Object.freeze([
  '.js', '.mjs', '.cjs',
  '.ts', '.mts', '.cts',
]);

module.exports = { JS_SOURCE_EXTS, JS_SOURCE_EXTS_NO_JSX };
