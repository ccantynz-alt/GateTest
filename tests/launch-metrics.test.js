/**
 * Launch metrics (launch checklist §5): pipeline movement, push-to-result
 * latency, dead letters, and the suppression feedback channel — all from
 * tables the pipeline already writes. Sections degrade independently.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { getLaunchMetrics } = require('../website/app/lib/launch-metrics');

function fakeSql(handlers) {
  return async (strings, ...values) => {
    const text = strings.join('?');
    for (const [pattern, rows] of handlers) {
      if (pattern.test(text)) {
        return typeof rows === 'function' ? rows(values) : rows;
      }
    }
    throw new Error(`no handler for: ${text.slice(0, 80)}`);
  };
}

describe('getLaunchMetrics', () => {
  it('assembles all four sections from queue + suppression data', async () => {
    const sql = fakeSql([
      [/GROUP BY 1, 2/, [
        { day: '2026-08-25', status: 'done', n: 4 },
        { day: '2026-08-25', status: 'dead', n: 1 },
        { day: '2026-08-24', status: 'done', n: 2 },
      ]],
      [/PERCENTILE_CONT/, [{ completed: 6, avg_wait_s: 12, p95_wait_s: 40, avg_total_s: 95, p95_total_s: 210, avg_attempts: '1.17' }]],
      [/status = 'dead'/, [
        { repository: 'octo/gone', attempts: 1, last_error: '[terminal] GitHub API 404: Not Found' },
        { repository: 'octo/flaky', attempts: 5, last_error: 'upstream returned 503' },
      ]],
      [/FROM rule_suppressions\s+GROUP BY/, [{ rule: 'security:no-helmet', n: 3 }]],
      [/COUNT\(\*\)::int AS n FROM rule_suppressions/, [{ n: 3 }]],
    ]);

    const m = await getLaunchMetrics(sql, { days: 14 });
    assert.strictEqual(m.windowDays, 14);
    assert.deepStrictEqual(m.pipeline['2026-08-25'], { queued: 0, running: 0, done: 4, dead: 1 });
    assert.strictEqual(m.latency.completed, 6);
    assert.strictEqual(m.latency.queue_wait_s.p95, 40);
    assert.strictEqual(m.latency.avg_attempts, 1.17);
    assert.strictEqual(m.failures.length, 2);
    assert.strictEqual(m.failures[0].terminal, true, 'terminal dead letters are labelled');
    assert.strictEqual(m.failures[1].terminal, false);
    assert.strictEqual(m.suppressions.total, 3);
    assert.deepStrictEqual(m.suppressions.byRule[0], { rule: 'security:no-helmet', count: 3 });
  });

  it('a missing rule_suppressions table degrades that section only', async () => {
    const sql = fakeSql([
      [/GROUP BY 1, 2/, []],
      [/PERCENTILE_CONT/, [{}]],
      [/status = 'dead'/, []],
      [/rule_suppressions/, () => { throw new Error('relation "rule_suppressions" does not exist'); }],
    ]);
    const m = await getLaunchMetrics(sql);
    assert.ok(m.suppressions.error, 'suppressions section reports its own failure');
    assert.deepStrictEqual(m.failures, [], 'other sections still work');
  });

  it('clamps the window and requires sql', async () => {
    const seen = [];
    const sql = fakeSql([
      [/GROUP BY 1, 2/, (values) => { seen.push(values[0]); return []; }],
      [/PERCENTILE_CONT/, (values) => { seen.push(values[0]); return [{}]; }],
      [/status = 'dead'/, []],
      [/rule_suppressions/, []],
      [/COUNT\(\*\)::int AS n FROM rule_suppressions/, [{ n: 0 }]],
    ]);
    await getLaunchMetrics(sql, { days: 5000 });
    assert.ok(seen.every((d) => d === 90), 'window clamps to 90 days');
    await assert.rejects(() => getLaunchMetrics(), /sql tagged-template is required/);
  });
});

describe('feedback affordances', () => {
  it('the PR comment footer carries the suppression command and the support email', () => {
    const { buildMarkdownComment } = require('../website/app/lib/github-callback');
    const md = buildMarkdownComment('octo/demo', 'a'.repeat(40),
      { status: 'complete', totalIssues: 0, modules: [] }, 'https://gatetest.io/scan/status');
    assert.match(md, /@gatetest ignore <module:rule>/);
    assert.match(md, /hello@gatetest\.ai|@gatetest\.io/, 'support email present');
  });
});
