/**
 * The consumer of a scan result is another dev agent, not a human reading a
 * terminal. That changes what "a good report" means, and the MCP formatter
 * used to get it wrong in three ways at once.
 *
 * 1. IT TRUNCATED BLOCKING FINDINGS. `flaggedChecks.slice(0, 5)` plus
 *    "…and N more". A human reads that and scrolls. An agent reads it, fixes
 *    five things, and reports done — so a truncated list is not a shorter
 *    answer, it is a WRONG one, and the agent's user never learns.
 *
 * 2. IT DROPPED CONFIDENCE. The engine computes a per-finding confidence and
 *    the formatter discarded it, leaving the agent no way to separate a
 *    certain defect from a guess. That is not academic: on this repo, 26 of 33
 *    blocking findings were our own false positives. An agent with no signal
 *    to distrust a finding will confidently "fix" working code — and one of
 *    those fixes would have added auth to the free scan funnel.
 *
 * 3. IT DROPPED THE FINDING ID. Without a stable id an agent cannot attribute
 *    a fix to a finding, dedupe across calls, or prove on re-scan that the
 *    thing it changed is the thing that was wrong.
 *
 * All three already existed, ranked and deduped, in
 * src/core/finding-registry.js — used by the PR comment and the hosted result
 * while this surface re-derived a worse version. Same shape as every other bug
 * found on 2026-08-31: the truth was in the system and the surface published
 * something else.
 *
 * These tests pin the CONTRACT, not the prose. Wording may change; "an agent
 * is never handed a silently short list of blocking findings" may not.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeFindings } = require('../src/core/finding-registry');

const MCP_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'bin', 'gatetest-mcp.mjs'), 'utf8',
);

/** Build a scan result with `n` blocking findings in one module. */
function resultWith(n, opts = {}) {
  const checks = [];
  for (let i = 0; i < n; i++) {
    checks.push({
      name: `rule-${i}`,
      passed: false,
      severity: 'error',
      confidence: opts.confidence === undefined ? 1 : opts.confidence,
      message: `finding number ${i}`,
      file: `src/file-${i}.js`,
      line: i + 1,
      suggestion: `fix number ${i}`,
    });
  }
  return [{ module: 'secrets', errors: n, warnings: 0, checks }];
}

describe('MCP agent output contract', () => {
  it('the formatter uses the shared finding registry, not its own derivation', () => {
    assert.match(
      MCP_SRC,
      /require\(['"]\.\.\/src\/core\/finding-registry\.js['"]\)/,
      'the agent surface must consume the same registry as the PR comment and hosted result',
    );
  });

  it('REGRESSION: the 5-per-module slice is gone', () => {
    assert.doesNotMatch(
      MCP_SRC,
      /flaggedChecks\.slice\(\s*0\s*,\s*5\s*\)/,
      'blocking findings must never be silently capped at 5 per module',
    );
  });

  // ---- the registry supplies what an agent needs -------------------------

  it('every finding carries a stable id, confidence and blocking flag', () => {
    const findings = normalizeFindings(resultWith(3));
    assert.strictEqual(findings.length, 3);
    for (const f of findings) {
      assert.match(f.id, /^secrets:rule-\d$/, 'id must be stable and module-qualified');
      assert.strictEqual(typeof f.confidence, 'number');
      assert.strictEqual(typeof f.blocking, 'boolean');
      assert.ok(f.file && f.line, 'an agent needs a location it can open');
      assert.ok(f.suggestion, 'an agent needs the suggested fix, not just the complaint');
    }
  });

  it('POSITIVE CONTROL: low confidence is preserved, so an agent can distrust a finding', () => {
    const [f] = normalizeFindings(resultWith(1, { confidence: 0.4 }));
    assert.strictEqual(f.confidence, 0.4);
    assert.strictEqual(f.blocking, false,
      'a low-confidence error must not be presented to an agent as blocking');
  });

  it('POSITIVE CONTROL: a high-confidence error still blocks', () => {
    const [f] = normalizeFindings(resultWith(1, { confidence: 1 }));
    assert.strictEqual(f.blocking, true);
  });

  it('ids are unique per finding, so a fix can be attributed to one', () => {
    const ids = normalizeFindings(resultWith(25)).map((f) => f.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids make attribution impossible');
  });

  it('a large blocking set stays complete — no cap anywhere in the path', () => {
    // 25 is well past the old per-module limit of 5.
    const findings = normalizeFindings(resultWith(25));
    assert.strictEqual(findings.filter((f) => f.blocking).length, 25);
  });

  it('any cap that does remain is announced with the call that lifts it', () => {
    // Non-blocking findings ARE capped — an agent's context is finite. What
    // must never happen is a cap the agent cannot detect.
    const capBlock = /further non-blocking finding\(s\) not listed here[\s\S]{0,160}get_report/;
    assert.match(MCP_SRC, capBlock,
      'a truncated list must name the call that returns the rest, in the same breath');
  });
});
