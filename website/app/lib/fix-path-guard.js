/**
 * Fix-path guard — allow-list validation for every path the fix pipeline
 * is about to write into a customer's branch (2026-08-18 audit #7:
 * "path allow-list on overwrite targets").
 *
 * Two trust levels:
 *
 *  EXISTING files (fix.original !== "") — the path came from the customer's
 *  own scanned repo, so only STRUCTURAL safety applies: repo-relative,
 *  forward slashes, no traversal, no absolute paths, no control characters.
 *  No target deny-list here: modules legitimately fix `.github/workflows/`
 *  (ciSecurity SHA-pinning) and dotfiles the scan flagged.
 *
 *  NEW files (fix.original === "") — the path was INVENTED by the model
 *  (generated regression tests, CISO reports), so it additionally must:
 *   - not create anything under `.github/` (a new workflow file executes
 *     code in the customer's CI the moment the PR runs);
 *   - not create root dotfiles (`.npmrc`, `.env`, `.bashrc`, ...);
 *   - carry a known source/test/doc extension.
 *
 * Pure functions, no fs — tested directly.
 */

'use strict';

const NEW_FILE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|java|php|rs|json|md|txt)$/i;

// Built via constructor so the source file itself contains no raw control
// bytes (a scanner that flags binary-looking source would be right to).
const CONTROL_CHAR_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

/**
 * Structural safety shared by both trust levels.
 * @returns {string|null} rejection reason, or null when safe
 */
function structuralReason(p) {
  if (typeof p !== 'string' || p.length === 0) return 'empty path';
  if (p.length > 512) return 'path too long';
  if (CONTROL_CHAR_RE.test(p)) return 'control character in path';
  if (p.includes('\\')) return 'backslash in path (repo paths are forward-slash)';
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('~')) return 'absolute or home-relative path';
  const segs = p.split('/');
  if (segs.some((s) => s === '..')) return 'path traversal (..)';
  if (segs.some((s) => s === '')) return 'empty path segment (// or trailing /)';
  return null;
}

/**
 * Validate one fix entry's target path.
 *
 * @param {{ file: string, original?: string }} fix
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateFixPath(fix) {
  const p = fix && fix.file;
  const structural = structuralReason(p);
  if (structural) return { ok: false, reason: structural };

  const isNewFile = !fix.original; // "" or undefined → model-invented path
  if (isNewFile) {
    const lower = p.toLowerCase();
    if (lower.startsWith('.github/')) {
      return { ok: false, reason: 'new files may not be created under .github/ (CI execution surface)' };
    }
    const base = p.split('/').pop() || '';
    if (base.startsWith('.')) {
      return { ok: false, reason: `new dotfile "${base}" is not an allowed fix target` };
    }
    if (!NEW_FILE_EXT_RE.test(p)) {
      return { ok: false, reason: `new file extension not on the allow-list: ${p}` };
    }
  }
  return { ok: true };
}

/**
 * Partition a fix list into committable and rejected.
 *
 * @param {Array<{ file: string, original?: string }>} fixes
 * @returns {{ allowed: Array<object>, rejected: Array<{ fix: object, reason: string }> }}
 */
function filterFixesByPath(fixes) {
  const allowed = [];
  const rejected = [];
  for (const fix of Array.isArray(fixes) ? fixes : []) {
    const v = validateFixPath(fix || {});
    if (v.ok) allowed.push(fix);
    else rejected.push({ fix, reason: v.reason });
  }
  return { allowed, rejected };
}

module.exports = { validateFixPath, filterFixesByPath };
