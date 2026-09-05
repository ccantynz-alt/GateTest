'use strict';
/**
 * Monorepo path filters — `.gatetest.json`:
 *
 *   "paths": { "include": ["packages/api/**"], "exclude": ["**\/fixtures/**"] }
 *
 * One definition of "is this path in scope for this repository's gate"
 * (Doctrine §4), applied at the one seam every module's file set passes
 * through (`BaseModule._collectFiles`) and, for modules with their own
 * lookups, to their findings at the runner. A bare directory (`packages/api`)
 * means everything under it; globs use the same grammar as workspace
 * patterns (`*` one segment, `**` any depth). Exclude wins over include.
 * With neither key set there is no filter and nothing changes (the Fifty,
 * move 27).
 */

const { globToRegExp } = require('./workspaces');

function compile(patterns) {
  const out = [];
  for (const raw of Array.isArray(patterns) ? patterns : []) {
    if (typeof raw !== 'string') continue;
    const g = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!g) continue;
    // A bare directory: the directory and everything below it.
    if (!/[*?]/.test(g)) { out.push(globToRegExp(g)); out.push(globToRegExp(`${g}/**`)); continue; }
    out.push(globToRegExp(g));
  }
  return out;
}

/**
 * @param {object} config  a GateTestConfig (or anything with .get)
 * @returns {{include:RegExp[], exclude:RegExp[], raw:{include:string[], exclude:string[]}}|null}
 */
function readPathFilter(config) {
  const paths = config && typeof config.get === 'function' ? config.get('paths') : null;
  const include = paths && Array.isArray(paths.include) ? paths.include.filter((s) => typeof s === 'string' && s.trim()) : [];
  const exclude = paths && Array.isArray(paths.exclude) ? paths.exclude.filter((s) => typeof s === 'string' && s.trim()) : [];
  if (include.length === 0 && exclude.length === 0) return null;
  return { include: compile(include), exclude: compile(exclude), raw: { include, exclude } };
}

/** `rel` is '/'-joined and relative to the project root. */
function pathInScope(filter, rel) {
  if (!filter) return true;
  const p = String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
  if (filter.exclude.some((re) => re.test(p))) return false;
  if (filter.include.length === 0) return true;
  return filter.include.some((re) => re.test(p));
}

module.exports = { readPathFilter, pathInScope, compilePatterns: compile };
