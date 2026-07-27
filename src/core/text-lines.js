'use strict';

/**
 * CRLF-safe line splitting — the one place modules should get their lines.
 *
 * Why this exists (KI #49, then KI #77):
 *   `content.split('\n')` leaves a trailing `\r` on every line of a CRLF
 *   file. Whether that corrupts a check depends entirely on what the check
 *   then does with the line:
 *
 *     /foo$/.test(line)        → `$` will not match before `\r`  → MISSED finding
 *     line.endsWith(';')       → false on every line             → MISSED finding
 *     /^\s*import/.test(line)  → unaffected
 *     line.trim()              → unaffected (trim strips \r)
 *
 *   So the bug class is invisible on a Unix checkout and fires on any
 *   Windows or `core.autocrlf=true` clone. KI #49 was one instance of it —
 *   found by hand, one module at a time — and an audit on 2026-07-27 found
 *   135 more bare splits across 74 module files, with no lint rule or test
 *   preventing the next one.
 *
 * NOT a drop-in for every call site. If a module splits, edits, and then
 * re-joins with '\n' to WRITE a file back, switching the split here silently
 * strips `\r` from the customer's file and rewrites their line endings. Those
 * call sites must be converted deliberately, together with their join. The
 * guard test in tests/crlf-safety.test.js tracks which files are still
 * unconverted so the debt shrinks instead of drifting.
 */

/**
 * Split text into lines, tolerating LF, CRLF, and a trailing newline.
 *
 * @param {string} text
 * @returns {string[]} lines with no trailing `\r`
 */
function splitLines(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/);
}

/**
 * The line terminator `text` actually uses — for call sites that split,
 * modify, and re-join, so a CRLF file stays CRLF.
 *
 * @param {string} text
 * @returns {'\r\n'|'\n'}
 */
function detectEol(text) {
  return typeof text === 'string' && text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Re-join lines using the terminator the original text used. Pair with
 * splitLines() when a module rewrites file content.
 *
 * @param {string[]} lines
 * @param {string} originalText — the text the lines came from
 * @returns {string}
 */
function joinLines(lines, originalText) {
  return (Array.isArray(lines) ? lines : []).join(detectEol(originalText));
}

module.exports = { splitLines, detectEol, joinLines };
