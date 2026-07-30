const { describe, it } = require('node:test');
const assert = require('node:assert');

const AiReviewModule = require('../src/modules/ai-review');

describe('AiReviewModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new AiReviewModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});

// ============================================================================
// FALSE-CLEAN GUARD — a failed review must never report as a clean one
// ============================================================================
// Found 2026-07-30 chasing the residual weakness noted in KI #78. Two paths
// asserted cleanliness for a review that never produced a verdict:
//
//   1. `_callClaude` resolved `{issues: [], summary: ''}` when a 200 carried no
//      content, and the caller reported "AI review complete — code looks clean".
//   2. `_processReview` reported "no issues found" whenever `review.issues` was
//      missing — e.g. valid JSON in an unexpected shape.
//
// On a paid AI feature an outage, a refusal and genuinely clean code were
// indistinguishable to the customer. Bible Forbidden #16 — never silently fail.

const { interpretAnthropicResponse } = AiReviewModule;

const body = (text) => JSON.stringify({ content: [{ type: 'text', text }] });

describe('interpretAnthropicResponse', () => {
  it('THROWS on a 200 that carries no content (the false-clean bug)', () => {
    assert.throws(
      () => interpretAnthropicResponse(200, body('')),
      /no content — the review did not run/
    );
  });

  it('throws on whitespace-only content too', () => {
    assert.throws(() => interpretAnthropicResponse(200, body('   \n  ')), /no content/);
  });

  it('throws when the content array is absent entirely', () => {
    assert.throws(() => interpretAnthropicResponse(200, JSON.stringify({})), /no content/);
  });

  it('throws on a non-200, surfacing the API error message', () => {
    const err = JSON.stringify({ error: { message: 'model not found' } });
    assert.throws(() => interpretAnthropicResponse(404, err), /API returned 404: model not found/);
  });

  it('throws on a body that is not JSON at all', () => {
    assert.throws(() => interpretAnthropicResponse(200, '<html>502</html>'), /Failed to parse AI response/);
  });

  it('marks a non-JSON reply as unparsed rather than clean', () => {
    const out = interpretAnthropicResponse(200, body('I cannot review this code.'));
    assert.equal(out.unparsed, true);
    assert.deepEqual(out.issues, []);
    assert.match(out.summary, /cannot review/);
  });

  it('marks valid JSON with no issues array as unparsed rather than clean', () => {
    const out = interpretAnthropicResponse(200, body('{"summary":"looks fine"}'));
    assert.equal(out.unparsed, true);
    assert.deepEqual(out.issues, []);
  });

  it('POSITIVE CONTROL — a real clean verdict still parses as clean', () => {
    const out = interpretAnthropicResponse(200, body('{"issues":[],"summary":"No issues found."}'));
    assert.deepEqual(out.issues, []);
    assert.ok(!out.unparsed, 'a genuine empty issues array must NOT be marked unparsed');
  });

  it('POSITIVE CONTROL — real issues survive, including markdown-wrapped JSON', () => {
    const md = '```json\n{"issues":[{"file":"a.js","issue":"bug","severity":"error"}],"summary":"1 issue"}\n```';
    const out = interpretAnthropicResponse(200, body(md));
    assert.equal(out.issues.length, 1);
    assert.equal(out.issues[0].file, 'a.js');
  });
});

describe('_processReview never claims clean for a review that did not happen', () => {
  const makeResult = () => {
    const checks = [];
    return { checks, addCheck: (id, passed, opts) => checks.push({ id, passed, ...opts }) };
  };
  const mod = new AiReviewModule();

  it('reports inconclusive (not clean) when issues is missing', () => {
    const r = makeResult();
    mod._processReview({ summary: 'hmm' }, r, null);
    assert.equal(r.checks.length, 1);
    assert.equal(r.checks[0].id, 'ai-review:inconclusive');
    assert.equal(r.checks[0].severity, 'warning');
    assert.match(r.checks[0].message, /NOT reviewed/);
  });

  it('reports inconclusive when the reply was unparsed', () => {
    const r = makeResult();
    mod._processReview({ issues: [], summary: 'I refuse', unparsed: true }, r, null);
    assert.equal(r.checks[0].id, 'ai-review:inconclusive');
    assert.match(r.checks[0].message, /I refuse/);
  });

  it('reports inconclusive for a null review', () => {
    const r = makeResult();
    mod._processReview(null, r, null);
    assert.equal(r.checks[0].id, 'ai-review:inconclusive');
  });

  it('does NOT block the gate — inconclusive is a warning, never an error', () => {
    // Forbidden #25: an AI hiccup must not become the bottleneck.
    const r = makeResult();
    mod._processReview(null, r, null);
    assert.notEqual(r.checks[0].severity, 'error');
  });

  it('POSITIVE CONTROL — a genuinely clean review still reports clean', () => {
    const r = makeResult();
    mod._processReview({ issues: [], summary: 'No issues found.' }, r, null);
    assert.equal(r.checks[0].id, 'ai-review:clean');
    assert.equal(r.checks[0].passed, true);
  });
});
