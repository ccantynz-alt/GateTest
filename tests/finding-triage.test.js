/**
 * Finding triage — what a first-time user actually reads.
 *
 * A scan of this repo produced 813 streamed warnings. Every one was real,
 * and that is exactly the problem: "813 warnings" tells a developer nothing
 * they can act on, reads as noise, and they close the terminal. The engine
 * already scored every finding's confidence — nothing was using it to
 * decide what to SHOW.
 *
 * The two rules this file exists to defend:
 *   1. Never hide a blocking error's EXISTENCE. They stop the build.
 *   2. Never hide anything silently. `hiddenCount` is the contract with the
 *      reader; showing 3 of 813 without saying so is the same dishonesty as
 *      dumping 813, pointed the other way.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { priorityOf, collectFindings, triageFindings } = require('../src/core/finding-triage');

const check = (over = {}) => ({
  name: 'mod:rule', passed: false, severity: 'warning', confidence: 1, ...over,
});
const mod = (module, checks) => ({ module, checks });

describe('finding-triage — priority', () => {
  it('an error outranks a warning outranks an info', () => {
    const e = priorityOf(check({ severity: 'error' }));
    const w = priorityOf(check({ severity: 'warning' }));
    const i = priorityOf(check({ severity: 'info' }));
    assert.ok(e > w && w > i);
  });

  it('confidence scales priority — a shaky error yields to a solid one', () => {
    assert.ok(priorityOf(check({ severity: 'error', confidence: 1 }))
      > priorityOf(check({ severity: 'error', confidence: 0.2 })));
  });

  it('impact separates findings that share a severity', () => {
    // Everything the security module emits is severity:'error', so without
    // this "Math.random() for security" (moderate) ranked alongside SQL
    // injection (critical) and sometimes above it.
    const crit = priorityOf(check({ severity: 'error', impact: 'critical' }));
    const modr = priorityOf(check({ severity: 'error', impact: 'moderate' }));
    assert.ok(crit > modr, 'critical must outrank moderate at equal severity');
  });

  it('a finding with no impact field is unaffected', () => {
    // Modules that never opt in must not be reordered by this.
    assert.strictEqual(
      priorityOf(check({ severity: 'error' })),
      priorityOf(check({ severity: 'error', impact: undefined })),
    );
  });

  it('an actionable finding outranks an abstract one', () => {
    // file:line means the reader can go and look. That is worth more than
    // a true statement about the repo in general.
    assert.ok(priorityOf(check({ file: 'a.js', line: 4 })) > priorityOf(check({ file: 'a.js' })));
    assert.ok(priorityOf(check({ file: 'a.js' })) > priorityOf(check({})));
  });

  it('passed and suppressed findings score zero', () => {
    assert.strictEqual(priorityOf(check({ passed: true })), 0);
    assert.strictEqual(priorityOf(check({ suppressed: true })), 0);
    assert.strictEqual(priorityOf(null), 0);
  });
});

describe('finding-triage — what gets shown', () => {
  it('every blocking error is kept, however many there are', () => {
    // Rule 1. These stop the build.
    const many = Array.from({ length: 25 }, (_, i) =>
      check({ severity: 'error', confidence: 1, name: `sec:r${i}` }));
    const { blocking } = triageFindings([mod('security', many)]);
    assert.strictEqual(blocking.length, 25);
  });

  it('blocking errors come back worst-first', () => {
    const { blocking } = triageFindings([mod('security', [
      check({ severity: 'error', impact: 'moderate', name: 'sec:rand', file: 'a.js', line: 1 }),
      check({ severity: 'error', impact: 'critical', name: 'sec:sqli', file: 'a.js', line: 2 }),
    ])]);
    assert.strictEqual(blocking[0].check.name, 'sec:sqli',
      'the first thing a new user reads must be the worst thing found');
  });

  it('caps the non-blocking shortlist', () => {
    const many = Array.from({ length: 40 }, (_, i) => check({ name: `w:${i}` }));
    const { top } = triageFindings([mod('lint', many)], { limit: 3 });
    assert.strictEqual(top.length, 3);
  });

  it('spreads the shortlist ACROSS modules', () => {
    // One noisy module filling all three slots would reproduce exactly the
    // problem this exists to solve.
    const noisy = Array.from({ length: 30 }, (_, i) => check({ name: `noisy:${i}`, confidence: 1 }));
    const { top } = triageFindings([
      mod('noisy', noisy),
      mod('quiet', [check({ name: 'quiet:1', confidence: 0.9 })]),
      mod('other', [check({ name: 'other:1', confidence: 0.9 })]),
    ], { limit: 3 });
    assert.strictEqual(new Set(top.map((t) => t.module)).size, 3,
      'three findings from one module is the failure mode, not the goal');
  });

  it('falls back gracefully when there are fewer modules than slots', () => {
    const { top } = triageFindings([mod('only', [check({ name: 'a' }), check({ name: 'b' })])], { limit: 3 });
    assert.strictEqual(top.length, 2);
  });
});

describe('finding-triage — nothing disappears silently', () => {
  it('reports exactly how many are not shown', () => {
    // Rule 2. This number is the contract with the reader.
    const many = Array.from({ length: 20 }, (_, i) => check({ name: `w:${i}` }));
    const r = triageFindings([mod('lint', many)], { limit: 3 });
    assert.strictEqual(r.top.length, 3);
    assert.strictEqual(r.hiddenCount, 17);
    assert.strictEqual(r.totalFindings, 20);
    assert.strictEqual(r.top.length + r.hiddenCount, r.totalFindings,
      'shown + hidden must account for every finding');
  });

  it('a clean repo produces an empty, honest result', () => {
    const r = triageFindings([mod('lint', [check({ passed: true })])]);
    assert.deepStrictEqual([r.blocking.length, r.top.length, r.hiddenCount], [0, 0, 0]);
  });

  it('suppressed findings are excluded from every count', () => {
    // They were silenced deliberately; counting them as "hidden" would
    // nag about a decision the user already made.
    const r = triageFindings([mod('lint', [check({ suppressed: true }), check({ name: 'real' })])]);
    assert.strictEqual(r.totalFindings, 1);
  });

  it('survives a malformed summary', () => {
    assert.strictEqual(triageFindings(null).totalFindings, 0);
    assert.strictEqual(collectFindings(undefined).length, 0);
    assert.strictEqual(triageFindings([{ module: 'x' }]).totalFindings, 0);
  });
});

describe('finding-triage — wired into the reporter', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'reporters', 'console-reporter.js'), 'utf8');

  it('the per-module warning dump is behind --all', () => {
    // Streaming every warning inline is what produced the 813-line wall.
    assert.match(src, /if \(this\.showAll\) \{[\s\S]*?warningChecks/);
  });

  it('the shortlist always discloses what it is not showing', () => {
    assert.match(src, /more finding\(s\) not shown/);
    assert.match(src, /gatetest --all/);
  });

  it('blocking errors are never hidden without saying so', () => {
    assert.match(src, /worst \$\{BLOCKING_SHOWN\} of \$\{blocking\.length\}/);
    assert.match(src, /more blocking finding\(s\)/);
  });
});
