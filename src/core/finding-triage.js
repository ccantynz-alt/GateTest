'use strict';

/**
 * Finding triage — decide the handful of things worth a human's attention.
 *
 * WHY THIS EXISTS. A scan of this repo prints 813 warnings. Every one is a
 * real finding, and that is precisely the problem: a tool that answers "813
 * warnings" has told the developer nothing they can act on, and it reads as
 * noise even when it is not. They close the terminal. A tool that answers
 * "3 things, here they are, here is the line" gets trusted and gets run
 * again. The engine already scores every finding's confidence; nothing was
 * using it to decide what to SHOW.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   * It never hides a blocking error. Those stop your build — you must see
 *     all of them, always, however many there are.
 *   * It never silently drops anything. The caller is handed `hiddenCount`
 *     and is expected to say so. Quietly showing 3 of 813 would be the same
 *     dishonesty as reporting 813 (Forbidden #16), just in the other
 *     direction.
 *   * It does not change the gate decision. Ranking is presentation. What
 *     blocks is decided elsewhere and is unaffected.
 *
 * Pure module — no I/O, no state.
 */

const SEVERITY_WEIGHT = { error: 100, warning: 10, info: 1 };

/**
 * Optional second axis. `severity` says whether a finding blocks; `impact`
 * says how bad it is if you are wrong about it. A module may set it (see
 * security.js) and everything without one is treated as neutral, so this
 * can never reorder modules that do not opt in.
 */
const IMPACT_WEIGHT = { critical: 3, high: 2, moderate: 1, low: 0.6 };
const DEFAULT_LIMIT = 3;
const DEFAULT_BLOCK_THRESHOLD = 0.7;

/**
 * How much does this finding deserve the one slot it is competing for?
 *
 * severity × confidence, then two nudges that reflect what makes a finding
 * ACTIONABLE rather than merely true:
 *   * a file:line is worth more than a repo-wide assertion, because the
 *     reader can go and look at it
 *   * a concrete fix suggestion is worth more than a bare statement
 *
 * @param {object} check
 * @returns {number}
 */
function priorityOf(check) {
  if (!check || check.passed || check.suppressed) return 0;
  const sev = SEVERITY_WEIGHT[check.severity] ?? SEVERITY_WEIGHT.info;
  const conf = typeof check.confidence === 'number' ? check.confidence : 1;
  let score = sev * conf;
  const impact = typeof check.impact === 'string' ? IMPACT_WEIGHT[check.impact.toLowerCase()] : undefined;
  if (impact) score *= impact;
  if (check.file && check.line) score *= 1.5;
  else if (check.file) score *= 1.2;
  if (check.suggestion) score *= 1.1;
  return score;
}

function isBlocking(check, threshold) {
  if (!check || check.passed || check.suppressed) return false;
  if (check.severity !== 'error') return false;
  const conf = typeof check.confidence === 'number' ? check.confidence : 1;
  return conf >= threshold;
}

/**
 * Flatten a runner's per-module results into scored findings.
 * @returns {Array<{module: string, check: object, priority: number}>}
 */
function collectFindings(results) {
  const out = [];
  for (const r of Array.isArray(results) ? results : []) {
    for (const c of (r && r.checks) || []) {
      if (c.passed || c.suppressed) continue;
      // Cross-module duplicates (stamped by src/core/finding-registry.js —
      // the same file:line:class already shown under its owning module)
      // are folded here; the gate counts them, the reader does not need
      // to read them three times.
      if (c.duplicateOf) continue;
      out.push({ module: r.module, check: c, priority: priorityOf(c) });
    }
  }
  return out;
}

/** How many checks were folded as cross-module duplicates (for the footer). */
function countFoldedDuplicates(results) {
  let n = 0;
  for (const r of Array.isArray(results) ? results : []) {
    for (const c of (r && r.checks) || []) if (c && !c.passed && c.duplicateOf) n++;
  }
  return n;
}

/**
 * Pick what to show.
 *
 * Blocking errors are shown in full — no cap, no diversity rule. Everything
 * else competes for `limit` slots, and competes ACROSS modules: one noisy
 * module must not fill the whole list, or the triage reproduces exactly the
 * problem it exists to solve. Highest-priority finding from each distinct
 * module first, then the next round, and so on.
 *
 * @param {Array} results — runner summary.results
 * @param {object} [opts]
 * @param {number} [opts.limit=3]
 * @param {number} [opts.blockThreshold=0.7]
 * @returns {{blocking: Array, top: Array, hiddenCount: number, totalFindings: number}}
 */
function triageFindings(results, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? Math.max(0, opts.limit) : DEFAULT_LIMIT;
  const threshold = Number.isFinite(opts.blockThreshold) ? opts.blockThreshold : DEFAULT_BLOCK_THRESHOLD;

  const all = collectFindings(results);
  const blocking = all.filter((f) => isBlocking(f.check, threshold));
  const rest = all.filter((f) => !isBlocking(f.check, threshold));

  // Worst first. Blocking errors were previously emitted in collection
  // order, which put "Math.random() for security" above SQL injection — the
  // first thing a new user reads should be the scariest thing found, not
  // whichever module happened to run first.
  blocking.sort((a, b) => b.priority - a.priority);

  rest.sort((a, b) => b.priority - a.priority
    || String(a.check.name || '').localeCompare(String(b.check.name || '')));

  // Round-robin across modules so the list shows a SPREAD of problems
  // rather than three symptoms of one.
  const byModule = new Map();
  for (const f of rest) {
    if (!byModule.has(f.module)) byModule.set(f.module, []);
    byModule.get(f.module).push(f);
  }
  const queues = [...byModule.values()];
  const top = [];
  let progressed = true;
  while (top.length < limit && progressed) {
    progressed = false;
    for (const q of queues) {
      if (top.length >= limit) break;
      const next = q.shift();
      if (next) { top.push(next); progressed = true; }
    }
  }
  top.sort((a, b) => b.priority - a.priority);

  return {
    blocking,
    top,
    hiddenCount: rest.length - top.length,
    totalFindings: all.length,
  };
}

module.exports = {
  countFoldedDuplicates,
  SEVERITY_WEIGHT,
  DEFAULT_LIMIT,
  priorityOf,
  collectFindings,
  triageFindings,
};
