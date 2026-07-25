// ============================================================================
// Model / cost-table integrity — the "melting iceberg" guard.
//
// Every one of these tests exists because a real bug shipped:
//
//  * fake-fix-detector.js set MODEL_SONNET and MODEL_HAIKU to the SAME model
//    id. Because MODEL_PRICING is keyed by those constants, the table
//    collapsed to a single entry and the LATER literal won — so Sonnet calls
//    were priced at Haiku's rate, a 3.75x under-count of real AI spend against
//    the per-scan ceiling. The 80% "downgrade to Haiku" brake was also a no-op,
//    because it downgraded to the model it was already using.
//
//  * try-fix.js's CLAUDE_PRICING had 'claude-sonnet-5' as a duplicate object
//    key, silently clobbering the row for a pricier model.
//
// Both are the same failure mode: a model rename done by find-and-replace,
// with no test asserting the tables stayed distinct. These tests assert the
// STRUCTURAL invariants rather than specific prices, so they keep working as
// models and rates change.
// ============================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const detector = require('../src/modules/fake-fix-detector');
const tracker = require('../website/app/lib/budget-tracker.js');

describe('fake-fix-detector — cost ledger integrity', () => {
  it('the cheap fallback model is genuinely a DIFFERENT model from the default', () => {
    assert.notEqual(
      detector.MODEL_HAIKU,
      detector.MODEL_SONNET,
      'MODEL_HAIKU === MODEL_SONNET collapses the pricing table and makes the ' +
        'cost-cap downgrade a no-op — see this file\'s header',
    );
  });

  it('the pricing table keeps one distinct entry per model', () => {
    const keys = Object.keys(detector.MODEL_PRICING);
    assert.equal(keys.length, 2, `expected 2 priced models, got: ${keys.join(', ')}`);
    assert.ok(keys.includes(detector.MODEL_SONNET));
    assert.ok(keys.includes(detector.MODEL_HAIKU));
  });

  it('the downgrade model is actually cheaper than the default (or the brake does nothing)', () => {
    const std = detector.MODEL_PRICING[detector.MODEL_SONNET];
    const cheap = detector.MODEL_PRICING[detector.MODEL_HAIKU];
    assert.ok(
      cheap.inputPerMTok < std.inputPerMTok && cheap.outputPerMTok < std.outputPerMTok,
      `downgrade target must be cheaper: ${JSON.stringify(cheap)} vs ${JSON.stringify(std)}`,
    );
  });

  it('costs the default model at its own rate, not the cheap one', () => {
    const oneMTokIn = 1_000_000;
    const std = detector.estimateCostUsd(detector.MODEL_SONNET, oneMTokIn, 0);
    const cheap = detector.estimateCostUsd(detector.MODEL_HAIKU, oneMTokIn, 0);
    assert.ok(std > cheap, `default model must cost more per token: ${std} vs ${cheap}`);
    assert.equal(std, detector.MODEL_PRICING[detector.MODEL_SONNET].inputPerMTok);
  });

  it('an unknown model is costed at the most expensive known rate (fail safe)', () => {
    const oneMTokOut = 1_000_000;
    const unknown = detector.estimateCostUsd('claude-something-6', 0, oneMTokOut);
    const dearest = Math.max(
      ...Object.values(detector.MODEL_PRICING).map((p) => p.outputPerMTok),
    );
    assert.equal(
      unknown,
      dearest,
      'an unrecognised model must never be costed cheaper than the priciest known one',
    );
  });
});

describe('pricing tables — no duplicate keys', () => {
  // A duplicate key in an object literal is legal JS and silently drops the
  // earlier row, so it cannot be caught by requiring the module. Read the
  // source and count the literal keys instead.
  const files = [
    'website/app/lib/budget-tracker.js',
    'website/app/lib/try-fix.js',
    'src/modules/fake-fix-detector.js',
  ];

  for (const rel of files) {
    it(`${rel} declares each claude-* pricing key at most once`, () => {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      const keys = [...src.matchAll(/^\s*'(claude-[a-z0-9.-]+)'\s*:/gm)].map((m) => m[1]);
      const seen = new Set();
      const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      assert.deepEqual(dupes, [], `duplicate pricing keys silently clobber rows: ${dupes.join(', ')}`);
    });
  }
});

describe('budget-tracker — every user-selectable model has a real price', () => {
  const { allowedModelIds } = require('../website/app/lib/engine-models.js');

  it('no selectable model falls through to the unknown-model fallback', () => {
    for (const id of allowedModelIds()) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(tracker.MODEL_PRICING, id),
        `${id} is user-selectable but has no explicit price row — spend would be ` +
          'estimated at the fail-safe rate instead of its real one',
      );
    }
  });
});
