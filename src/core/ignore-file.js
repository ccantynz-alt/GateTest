'use strict';
/**
 * .gatetestignore — user-facing suppression for findings.
 *
 * A repo-root .gatetestignore lets a team silence noise WITHOUT weakening the
 * gate globally. Suppressed findings are excluded from the block decision AND
 * the soft/warning counts, but stay visible in a "suppressed" list so nothing
 * is hidden — the difference between "we don't block on this" and "we pretend
 * it isn't there."
 *
 * Grammar (one rule per line, # comments and blank lines ignored):
 *   module:rule          suppress a specific rule in a module
 *   module:*  OR  module suppress an entire module
 *   *:rule               suppress a rule across all modules
 *   module:rule@glob     suppress only in files matching the glob
 *   path/glob/**         suppress any finding whose file matches the glob
 *
 * Matching is case-insensitive on module/rule; globs use a minimal glob→regex
 * (`*` = any non-slash run, `**` = any run incl. slashes, `?` = one char).
 * Pure — no I/O beyond the single file read in load(); parse() takes text.
 */

const fs = require('fs');
const path = require('path');

const IGNORE_FILENAME = '.gatetestignore';

function _globToRegExp(glob) {
  // Escape regex metachars except our glob tokens, then expand tokens.
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i += 1; } // ** → any incl. /
      else re += '[^/]*';                              // *  → any non-/
    } else if (c === '?') {
      re += '[^/]';
    } else if ('/.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function _normPath(p) {
  return typeof p === 'string' ? p.replace(/\\/g, '/') : '';
}

// Module/rule tokens appear in two spellings: the registry name is camelCase
// (`hardcodedUrl`) while check names render kebab-case (`hardcoded-url`).
// Users copy whichever they saw, so comparisons strip all separators —
// `hardcoded-url`, `hardcoded_url`, and `hardcodedUrl` are the same token.
function _normToken(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9*]/g, '');
}

/**
 * Parse .gatetestignore text into a matcher.
 * @param {string} text
 * @returns {{ matches: (f: {module?:string, ruleKey?:string, name?:string, file?:string}) => boolean,
 *             rules: object[], isEmpty: boolean }}
 */
function parse(text) {
  const rules = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    // Split off an optional @glob file scope.
    let body = line;
    let fileGlob = null;
    const at = line.indexOf('@');
    if (at > 0) { body = line.slice(0, at).trim(); fileGlob = line.slice(at + 1).trim(); }

    if (body.includes(':')) {
      // module:rule form
      const [modRaw, ruleRaw] = body.split(':');
      const module = _normToken(modRaw.trim());
      const rule = _normToken(ruleRaw.trim());
      rules.push({
        kind: 'moduleRule',
        module: module === '*' ? null : module,
        rule: rule === '*' || rule === '' ? null : rule,
        fileRe: fileGlob ? _globToRegExp(fileGlob) : null,
      });
    } else if (body.includes('/') || body.includes('*') || /\.[a-z0-9]+$/i.test(body)) {
      // bare path/glob form
      rules.push({ kind: 'path', fileRe: _globToRegExp(body) });
    } else {
      // bare word → whole module
      rules.push({ kind: 'moduleRule', module: _normToken(body), rule: null, fileRe: fileGlob ? _globToRegExp(fileGlob) : null });
    }
  }

  function ruleKeyMatches(rule, finding) {
    // A finding's rule identity is its ruleKey (may be "module:rule") or name.
    const key = String(finding.ruleKey || finding.name || '').toLowerCase();
    if (!rule) return true;
    // Match the tail after a colon or the whole key. Check names often carry
    // trailing file:line segments (`hardcoded-url:localhost:src/x.ts:12`), so
    // also try the segment right after the module prefix.
    const segments = key.split(':');
    const candidates = new Set([
      _normToken(key),
      _normToken(key.includes(':') ? key.slice(key.indexOf(':') + 1) : key),
    ]);
    if (segments.length >= 2) candidates.add(_normToken(segments[1]));
    return candidates.has(rule);
  }

  /**
   * Which KIND of rule silenced this finding: 'moduleRule', 'path', or null.
   *
   * The distinction matters to the noise model. `hardcodedUrl:localhost` is
   * the user saying "this module's rule is wrong about my repo" — a genuine
   * accuracy signal. `benchmarks/bench-target/**` is the user saying "this
   * DIRECTORY is not real code" — it says nothing at all about any module.
   *
   * Counting path globs as module dismissals made GateTest down-weight
   * accurate modules for firing inside a deliberately-bad fixture corpus:
   * on this repo, 5 ignore lines softened 555 findings across `secrets`,
   * `codeQuality`, `deadCode` and more, purely because two of those lines
   * were directory excludes (found 2026-07-28).
   */
  function matchKind(finding) {
    if (!finding) return null;
    const mod = _normToken(finding.module);
    const file = _normPath(finding.file || finding.filePath);
    for (const r of rules) {
      if (r.kind === 'path') {
        if (file && r.fileRe.test(file)) return 'path';
        continue;
      }
      // moduleRule
      if (r.module && r.module !== mod) continue;
      if (!ruleKeyMatches(r.rule, finding)) continue;
      if (r.fileRe && !(file && r.fileRe.test(file))) continue;
      return 'moduleRule';
    }
    return null;
  }

  function matches(finding) {
    return matchKind(finding) !== null;
  }

  return { matches, matchKind, rules, isEmpty: rules.length === 0 };
}

/**
 * Load + parse the .gatetestignore at a project root. Returns an empty matcher
 * when absent/unreadable. Never throws.
 * @param {string} projectRoot
 */
function load(projectRoot) {
  try {
    const text = fs.readFileSync(path.join(projectRoot || process.cwd(), IGNORE_FILENAME), 'utf-8');
    return parse(text);
  } catch {
    return parse('');
  }
}

module.exports = { parse, load, IGNORE_FILENAME, _globToRegExp };
