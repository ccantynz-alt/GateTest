/**
 * AI evidence gate (2026-08-18 audit advancement #5, complaint #9):
 * no AI finding ships unless the code it quotes actually appears in a
 * reviewed file. Positive controls prove real findings survive (including
 * ones with wrong line numbers); negative controls prove hallucinations die.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');

const { verifyAiFinding, gateAiReview } = require('../src/core/ai-evidence-gate');

const FILE = [
  'const express = require("express");',
  'const app = express();',
  '',
  'app.get("/users/:id", (req, res) => {',
  '  const id = req.params.id;',
  '  db.query("SELECT * FROM users WHERE id = " + id);',
  '  res.send("ok");',
  '});',
].join('\n');

const FILES = [{ path: 'src/server.js', content: FILE }];
const MAP = new Map([['src/server.js', FILE]]);

describe('verifyAiFinding', () => {
  it('confirms a finding whose quote sits at the claimed line', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 6, evidence: 'db.query("SELECT * FROM users WHERE id = " + id);' },
      MAP);
    assert.strictEqual(v.verdict, 'confirmed');
    assert.strictEqual(v.line, 6);
  });

  it('confirms with a corrected line when the model is off by a couple', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 8, evidence: 'db.query("SELECT * FROM users WHERE id = " + id);' },
      MAP);
    assert.strictEqual(v.verdict, 'confirmed');
    assert.strictEqual(v.line, 6, 'line must be corrected to where the code actually is');
  });

  it('relocates a real quote with a wildly wrong line number', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 400, evidence: 'const id = req.params.id;' },
      MAP);
    assert.strictEqual(v.verdict, 'relocated');
    assert.strictEqual(v.line, 5);
  });

  it('matches re-indented quotes (whitespace-normalized)', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 6, evidence: '    db.query("SELECT * FROM users WHERE id = "  +  id);' },
      MAP);
    assert.strictEqual(v.verdict, 'confirmed');
  });

  it('matches a multi-line quote', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 4, evidence: 'app.get("/users/:id", (req, res) => {\n  const id = req.params.id;' },
      MAP);
    assert.strictEqual(v.verdict, 'confirmed');
    assert.strictEqual(v.line, 4);
  });

  it('rejects a quote that appears nowhere in the file', () => {
    const v = verifyAiFinding(
      { file: 'src/server.js', line: 6, evidence: 'eval(userInput) // classic hallucination' },
      MAP);
    assert.strictEqual(v.verdict, 'rejected');
    assert.match(v.reason, /does not appear/);
  });

  it('rejects a file that was never reviewed', () => {
    const v = verifyAiFinding(
      { file: 'src/imaginary.js', line: 1, evidence: 'const app = express();' },
      MAP);
    assert.strictEqual(v.verdict, 'rejected');
    assert.match(v.reason, /not in the review batch/);
  });

  it('rejects a finding with no evidence at all', () => {
    const v = verifyAiFinding({ file: 'src/server.js', line: 6 }, MAP);
    assert.strictEqual(v.verdict, 'rejected');
    assert.match(v.reason, /no evidence/);
  });

  it('handles windows-style paths from the model', () => {
    const v = verifyAiFinding(
      { file: 'src\\server.js', line: 5, evidence: 'const id = req.params.id;' },
      MAP);
    assert.strictEqual(v.verdict, 'confirmed');
  });
});

describe('gateAiReview', () => {
  it('partitions accepted (with corrected lines) from rejected (with reasons)', () => {
    const { accepted, rejected } = gateAiReview([
      { file: 'src/server.js', line: 6, title: 'SQLi', evidence: 'db.query("SELECT * FROM users WHERE id = " + id);' },
      { file: 'src/server.js', line: 2, title: 'made up', evidence: 'process.exit(1)' },
      { file: 'src/other.js', line: 1, title: 'wrong file', evidence: 'const app = express();' },
    ], FILES);
    assert.strictEqual(accepted.length, 1);
    assert.strictEqual(accepted[0].title, 'SQLi');
    assert.strictEqual(accepted[0].evidenceVerdict, 'confirmed');
    assert.strictEqual(rejected.length, 2);
    assert.ok(rejected.every((r) => typeof r.reason === 'string' && r.reason.length > 0));
  });

  it('empty inputs are safe', () => {
    assert.deepStrictEqual(gateAiReview([], FILES), { accepted: [], rejected: [] });
    assert.deepStrictEqual(gateAiReview(null, null), { accepted: [], rejected: [] });
  });
});

describe('ai-review module wiring', () => {
  it('rejected findings become one aggregate info line, accepted ones become checks', () => {
    const AiReview = require('../src/modules/ai-review');
    const mod = new AiReview();
    const result = {
      checks: [],
      addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
    };
    mod._processReview(
      {
        issues: [
          { file: 'src/server.js', line: 6, severity: 'error', category: 'security', title: 'SQL injection via string concat', evidence: 'db.query("SELECT * FROM users WHERE id = " + id);' },
          { file: 'src/server.js', line: 3, severity: 'error', category: 'security', title: 'python 3.14 does not exist yet', evidence: 'requires-python = ">=3.14"' },
        ],
        summary: 'one real, one hallucinated',
      },
      result,
      null,
      FILES
    );
    const defects = result.checks.filter((c) => !c.passed);
    assert.strictEqual(defects.length, 1, 'only the evidence-backed finding ships');
    assert.match(defects[0].message, /SQL injection/);
    assert.strictEqual(defects[0].evidence, 'db.query("SELECT * FROM users WHERE id = " + id);');
    const rejectedLine = result.checks.find((c) => c.name === 'ai-review:evidence-rejected');
    assert.ok(rejectedLine, 'rejects must be visible, not silent');
    assert.match(rejectedLine.message, /python 3\.14/);
  });

  it('a review where everything fails the gate reads as "nothing verifiable", not clean-with-defects', () => {
    const AiReview = require('../src/modules/ai-review');
    const mod = new AiReview();
    const result = {
      checks: [],
      addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
    };
    mod._processReview(
      { issues: [{ file: 'nope.js', line: 1, title: 'x', evidence: 'y' }], summary: '' },
      result,
      null,
      FILES
    );
    assert.strictEqual(result.checks.filter((c) => !c.passed).length, 0);
    assert.ok(result.checks.some((c) => /nothing verifiable/.test(c.message || '')));
  });
});

// ── evidence travels: registry field + PR comment line ─────────────────────
describe('evidence-attached in the PR pipeline', () => {
  it('finding-registry carries the evidence field through normalization', () => {
    const { normalizeFindings } = require('../src/core/finding-registry');
    const findings = normalizeFindings([
      { module: 'aiReview', checks: [{ name: 'ai-review:security:src/a.js:6', passed: false, severity: 'error', file: 'src/a.js', line: 6, message: '[AI] SQLi', evidence: 'db.query("..." + id)', confidence: 0.9 }] },
    ]);
    assert.strictEqual(findings[0].evidence, 'db.query("..." + id)');
  });

  it('buildMarkdownComment renders an evidence line under the ranked item', () => {
    const { buildMarkdownComment } = require('../website/app/lib/github-callback');
    const { normalizeFindings } = require('../src/core/finding-registry');
    // The comment reads scanResult.findings — the registry-normalized view
    // the runner attaches — so build it the same way the runner does.
    const findings = normalizeFindings([
      { module: 'aiReview', checks: [{ name: 'ai-review:security:src/a.js:6', passed: false, severity: 'error', file: 'src/a.js', line: 6, message: '[AI] SQL injection via concat', evidence: 'db.query("SELECT * FROM users WHERE id = " + id);', confidence: 0.9 }] },
    ]);
    const scanResult = {
      status: 'complete',
      totalIssues: 1,
      findings,
      modules: [{ name: 'aiReview', passed: false, issues: 1, details: ['src/a.js:6 [AI] SQLi'] }],
    };
    const md = buildMarkdownComment('octo/demo', 'a'.repeat(40), scanResult, 'https://gatetest.io/scan/status');
    assert.match(md, /evidence: `db\.query\("SELECT \* FROM users WHERE id = " \+ id\);`/);
  });
});
