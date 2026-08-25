/**
 * Launch metrics — the numbers that say, within days of a soft launch,
 * whether real users are being served (launch checklist §5; Craig
 * 2026-08-26: "what else can we do for successful feedback from users").
 *
 * Everything here reads tables the pipeline already writes — scan_queue
 * and rule_suppressions. No new collection, no new consent surface, no
 * per-user tracking: these are operational aggregates.
 *
 *   pipeline   — is the loop moving? counts by status, day by day
 *   latency    — time-to-first-status (claim wait) and time-to-result,
 *                the two numbers a push-to-comment product lives on
 *   failures   — the last dead letters, split terminal vs exhausted,
 *                because each one is a customer who saw nothing
 *   suppressions — the built-in negative-feedback channel: which rules
 *                real reviewers are dismissing (feeds precision work)
 *
 * sql is injected (Neon tagged template) — unit-testable with a fake.
 * Every section degrades independently: one failed query reports itself
 * and never takes the endpoint down.
 */

'use strict';

async function section(fn) {
  try {
    return await fn();
  } catch (err) {
    return { error: err && err.message ? err.message : 'unavailable' };
  }
}

async function getLaunchMetrics(sql, { days = 14 } = {}) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('getLaunchMetrics: sql tagged-template is required');
  }
  const windowDays = Math.max(1, Math.min(90, Number(days) || 14));

  const pipeline = await section(async () => {
    const rows = await sql`
      SELECT created_at::date AS day, status, COUNT(*)::int AS n
      FROM scan_queue
      WHERE created_at > NOW() - (${windowDays} || ' days')::interval
      GROUP BY 1, 2
      ORDER BY 1 DESC`;
    const byDay = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10);
      if (!byDay[day]) byDay[day] = { queued: 0, running: 0, done: 0, dead: 0 };
      if (r.status in byDay[day]) byDay[day][r.status] = r.n;
    }
    return byDay;
  });

  const latency = await section(async () => {
    const rows = await sql`
      SELECT
        COUNT(*)::int AS completed,
        AVG(EXTRACT(EPOCH FROM (started_at - created_at)))::int AS avg_wait_s,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (started_at - created_at)))::int AS p95_wait_s,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::int AS avg_total_s,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)))::int AS p95_total_s,
        AVG(attempts)::numeric(4,2) AS avg_attempts
      FROM scan_queue
      WHERE status = 'done'
        AND completed_at IS NOT NULL AND started_at IS NOT NULL
        AND created_at > NOW() - (${windowDays} || ' days')::interval`;
    const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
    return {
      completed: r.completed || 0,
      queue_wait_s: { avg: r.avg_wait_s ?? null, p95: r.p95_wait_s ?? null },
      push_to_result_s: { avg: r.avg_total_s ?? null, p95: r.p95_total_s ?? null },
      avg_attempts: r.avg_attempts != null ? Number(r.avg_attempts) : null,
    };
  });

  const failures = await section(async () => {
    const rows = await sql`
      SELECT repository, attempts, last_error, completed_at
      FROM scan_queue
      WHERE status = 'dead'
      ORDER BY id DESC
      LIMIT 10`;
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      repository: r.repository,
      attempts: r.attempts,
      terminal: String(r.last_error || '').startsWith('[terminal]'),
      error: String(r.last_error || '').slice(0, 160),
    }));
  });

  const suppressions = await section(async () => {
    const rows = await sql`
      SELECT rule, COUNT(*)::int AS n
      FROM rule_suppressions
      GROUP BY rule
      ORDER BY n DESC
      LIMIT 10`;
    const total = await sql`SELECT COUNT(*)::int AS n FROM rule_suppressions`;
    return {
      total: Array.isArray(total) && total[0] ? total[0].n : 0,
      byRule: (Array.isArray(rows) ? rows : []).map((r) => ({ rule: r.rule, count: r.n })),
    };
  });

  return { windowDays, pipeline, latency, failures, suppressions };
}

module.exports = { getLaunchMetrics };
