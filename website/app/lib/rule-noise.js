'use strict';
/**
 * Rule-noise leaderboard maths (the Fifty, move 07) — pure, so it is tested
 * without a database. Input: one row per scan, each carrying the per-rule
 * `{ id, fired, silenced }` counts the recorder ships. Output: per rule, how
 * often it appeared, how often a team had silenced it, and the silenced rate.
 *
 * The rate is a PROXY for false positives, named honestly: a silenced rule is
 * a rule someone judged not worth acting on in their repository, which is the
 * strongest signal the flywheel has without reading their code. A rule seen
 * in fewer than MIN_SCANS scans is reported with `thin: true` rather than
 * ranked — three repos are not a population.
 */

const MIN_SCANS = 5;
const DEFAULT_MIN_SILENCED_RATE = 0.2; // the Fifty, move 08: "retire any rule above 20%"

function aggregateRuleNoise(rows, opts = {}) {
  const minScans = Number.isInteger(opts.minScans) ? opts.minScans : MIN_SCANS;
  const byRule = new Map();
  let scans = 0;
  for (const row of rows || []) {
    const rules = row && Array.isArray(row.rules) ? row.rules : [];
    if (rules.length === 0) continue;
    scans++;
    for (const r of rules) {
      if (!r || typeof r.id !== 'string') continue;
      const fired = Math.max(0, Number(r.fired) || 0);
      const silenced = Math.max(0, Number(r.silenced) || 0);
      if (fired + silenced === 0) continue;
      const e = byRule.get(r.id) || { id: r.id, module: r.id.split(':')[0], scans: 0, scansSilenced: 0, fired: 0, silenced: 0 };
      e.scans++;
      if (silenced > 0) e.scansSilenced++;
      e.fired += fired;
      e.silenced += silenced;
      byRule.set(r.id, e);
    }
  }
  const rules = [...byRule.values()].map((e) => ({
    ...e,
    // Findings the team silenced, over every finding the rule produced.
    silencedRate: e.fired + e.silenced > 0 ? e.silenced / (e.fired + e.silenced) : 0,
    // Repos-as-scans that silenced it, over scans it appeared in.
    silencedScanRate: e.scans > 0 ? e.scansSilenced / e.scans : 0,
    thin: e.scans < minScans,
  }));
  rules.sort((a, b) => {
    if (a.thin !== b.thin) return a.thin ? 1 : -1;
    if (b.silencedRate !== a.silencedRate) return b.silencedRate - a.silencedRate;
    if (b.silenced !== a.silenced) return b.silenced - a.silenced;
    return a.id < b.id ? -1 : 1;
  });
  return { scans, rules, minScans };
}

/** Rules over the retirement line (move 08), ranked and not thin. */
function candidatesForRetirement(agg, rate = DEFAULT_MIN_SILENCED_RATE) {
  return agg.rules.filter((r) => !r.thin && r.silencedRate > rate);
}

module.exports = { aggregateRuleNoise, candidatesForRetirement, MIN_SCANS, DEFAULT_MIN_SILENCED_RATE };
