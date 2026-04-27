// ============================================================================
// ANTHROPIC SPEND CAP TEST
// ============================================================================
// Locks in the bounded-budget tracker that any caller making Claude
// API requests should consult. Without this cap, one pathological
// repo + an unlucky module loop could burn $100+ of credit on a
// single scan and destroy the tier margin.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSpendCap,
  spendCapFromEnv,
  estimateCallCostUsd,
  DEFAULT_PER_SCAN_CAP_USD,
  DEFAULT_OVERALL_CAP_USD,
  DEFAULT_WARN_USD,
  MODEL_PRICING_USD_PER_MILLION,
} = require('../website/app/lib/anthropic-spend-cap.js');

// ---------- Pricing table ----------

test('pricing table — Sonnet 4.6 has correct per-million cost', () => {
  const p = MODEL_PRICING_USD_PER_MILLION['claude-sonnet-4-6'];
  assert.equal(p.input, 3.00);
  assert.equal(p.output, 15.00);
});

test('pricing table — Opus 4.7 priced higher than Sonnet', () => {
  const opus = MODEL_PRICING_USD_PER_MILLION['claude-opus-4-7'];
  const sonnet = MODEL_PRICING_USD_PER_MILLION['claude-sonnet-4-6'];
  assert.ok(opus.input > sonnet.input);
  assert.ok(opus.output > sonnet.output);
});

test('pricing table — fallback exists and is conservative (>= opus)', () => {
  const fallback = MODEL_PRICING_USD_PER_MILLION.__default__;
  const opus = MODEL_PRICING_USD_PER_MILLION['claude-opus-4-7'];
  assert.ok(fallback.input >= opus.input);
  assert.ok(fallback.output >= opus.output);
});

// ---------- estimateCallCostUsd ----------

test('estimateCallCostUsd — Sonnet 1k in / 1k out costs roughly 1.8 cents', () => {
  const cost = estimateCallCostUsd({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  // 1000 in @ $3/M = $0.003. 1000 out @ $15/M = $0.015. Total = $0.018
  assert.ok(Math.abs(cost - 0.018) < 0.0001, `expected ~0.018, got ${cost}`);
});

test('estimateCallCostUsd — Haiku is the cheapest tier', () => {
  const haiku = estimateCallCostUsd({ inputTokens: 10000, outputTokens: 10000, model: 'claude-haiku-4-5' });
  const sonnet = estimateCallCostUsd({ inputTokens: 10000, outputTokens: 10000, model: 'claude-sonnet-4-6' });
  assert.ok(haiku < sonnet, 'haiku should be cheaper than sonnet');
});

test('estimateCallCostUsd — unknown model falls back to conservative pricing', () => {
  const unknown = estimateCallCostUsd({ inputTokens: 1000, outputTokens: 1000, model: 'claude-mythical-99' });
  const opus = estimateCallCostUsd({ inputTokens: 1000, outputTokens: 1000, model: 'claude-opus-4-7' });
  // Fallback is opus-priced so unknown models don't sneak under-budget
  assert.equal(unknown, opus);
});

test('estimateCallCostUsd — zero / missing tokens is zero cost', () => {
  assert.equal(estimateCallCostUsd({ inputTokens: 0, outputTokens: 0, model: 'claude-sonnet-4-6' }), 0);
  assert.equal(estimateCallCostUsd({ model: 'claude-sonnet-4-6' }), 0);
});

// ---------- createSpendCap ----------

test('createSpendCap — fresh cap reports zero spend, full budget remaining', () => {
  const cap = createSpendCap({ scope: 'test', maxUsd: 5 });
  assert.equal(cap.spentUsd(), 0);
  assert.equal(cap.remainingUsd(), 5);
  assert.equal(cap.warningTriggered(), false);
});

test('createSpendCap — record() accumulates spend across calls', () => {
  const cap = createSpendCap({ scope: 'test', maxUsd: 5 });
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  // Each call ~$0.018, so two ~ $0.036
  assert.ok(Math.abs(cap.spentUsd() - 0.036) < 0.0001);
  assert.ok(Math.abs(cap.remainingUsd() - 4.964) < 0.0001);
});

test('createSpendCap — canSpend returns true when under budget', () => {
  const cap = createSpendCap({ scope: 'test', maxUsd: 5 });
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  assert.equal(cap.canSpend(0.10), true);  // $0.018 + $0.10 < $5
  assert.equal(cap.canSpend(4.99), false); // $0.018 + $4.99 > $5
});

test('createSpendCap — canSpend handles zero / missing estimate', () => {
  const cap = createSpendCap({ scope: 'test', maxUsd: 5 });
  assert.equal(cap.canSpend(0), true);
  assert.equal(cap.canSpend(), true);
  assert.equal(cap.canSpend(NaN), true); // NaN coerced to 0
});

test('createSpendCap — warning fires once when crossing warnUsd threshold', () => {
  const cap = createSpendCap({ scope: 'test', maxUsd: 5, warnUsd: 0.05 });
  assert.equal(cap.warningTriggered(), false);
  // First call: $0.018 — under warnUsd
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  assert.equal(cap.warningTriggered(), false);
  // Second call: cumulative $0.036 — still under
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  assert.equal(cap.warningTriggered(), false);
  // Third call: cumulative $0.054 — crosses $0.05 warning
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  assert.equal(cap.warningTriggered(), true);
  // Stays triggered after additional spend
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  assert.equal(cap.warningTriggered(), true);
});

test('createSpendCap — exceeding budget does NOT auto-throw (caller decides)', () => {
  // The cap is advisory, not enforcing. Callers check canSpend() before
  // each call. record() never throws — it just bookkeeps actual spend
  // (which may exceed the cap if the caller ignored the warning).
  const cap = createSpendCap({ scope: 'test', maxUsd: 0.001 });
  assert.doesNotThrow(() => {
    cap.record({ inputTokens: 1_000_000, outputTokens: 1_000_000, model: 'claude-sonnet-4-6' });
  });
  assert.ok(cap.spentUsd() > 0.001);
  assert.equal(cap.remainingUsd(), 0); // remaining never goes negative
});

test('createSpendCap — summary includes scope, spent, max, call count', () => {
  const cap = createSpendCap({ scope: 'scan-abc', maxUsd: 5 });
  cap.record({ inputTokens: 1000, outputTokens: 1000, model: 'claude-sonnet-4-6' });
  cap.record({ inputTokens: 500, outputTokens: 500, model: 'claude-sonnet-4-6' });
  const s = cap.summary();
  assert.match(s, /scan-abc/);
  assert.match(s, /\$0\.0270/);
  assert.match(s, /\$5/);
  assert.match(s, /2 call\(s\)/);
  assert.match(s, /remaining \$4\.973/);
});

test('createSpendCap — input validation', () => {
  assert.throws(() => createSpendCap({ maxUsd: 0 }), RangeError);
  assert.throws(() => createSpendCap({ maxUsd: -5 }), RangeError);
  assert.throws(() => createSpendCap({ maxUsd: 5, warnUsd: -1 }), RangeError);
});

test('createSpendCap — defaults are sensible (per-scan default = $10)', () => {
  const cap = createSpendCap();
  assert.equal(cap.remainingUsd(), DEFAULT_PER_SCAN_CAP_USD);
});

// ---------- spendCapFromEnv ----------

test('spendCapFromEnv — uses defaults when env empty', () => {
  // Clear env for test
  const prev = {
    a: process.env.GATETEST_SPEND_CAP_USD,
    b: process.env.GATETEST_SPEND_CAP_PER_SCAN_USD,
    c: process.env.GATETEST_SPEND_WARN_USD,
  };
  delete process.env.GATETEST_SPEND_CAP_USD;
  delete process.env.GATETEST_SPEND_CAP_PER_SCAN_USD;
  delete process.env.GATETEST_SPEND_WARN_USD;
  try {
    const cap = spendCapFromEnv('test');
    assert.equal(cap.remainingUsd(), DEFAULT_PER_SCAN_CAP_USD);
  } finally {
    if (prev.a) process.env.GATETEST_SPEND_CAP_USD = prev.a;
    if (prev.b) process.env.GATETEST_SPEND_CAP_PER_SCAN_USD = prev.b;
    if (prev.c) process.env.GATETEST_SPEND_WARN_USD = prev.c;
  }
});

test('spendCapFromEnv — honours env overrides', () => {
  const prev = process.env.GATETEST_SPEND_CAP_PER_SCAN_USD;
  process.env.GATETEST_SPEND_CAP_PER_SCAN_USD = '7.50';
  try {
    const cap = spendCapFromEnv('test');
    assert.equal(cap.remainingUsd(), 7.50);
  } finally {
    if (prev !== undefined) process.env.GATETEST_SPEND_CAP_PER_SCAN_USD = prev;
    else delete process.env.GATETEST_SPEND_CAP_PER_SCAN_USD;
  }
});

// ---------- Defaults exported ----------

test('default constants exported and sensible', () => {
  assert.ok(Number.isFinite(DEFAULT_PER_SCAN_CAP_USD));
  assert.ok(Number.isFinite(DEFAULT_OVERALL_CAP_USD));
  assert.ok(Number.isFinite(DEFAULT_WARN_USD));
  // Per-scan cap should be less than overall cap
  assert.ok(DEFAULT_PER_SCAN_CAP_USD <= DEFAULT_OVERALL_CAP_USD);
  // Warn should be less than per-scan
  assert.ok(DEFAULT_WARN_USD <= DEFAULT_PER_SCAN_CAP_USD);
});
