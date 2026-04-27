/**
 * Anthropic spend cap — bounded budget tracking for any caller that
 * makes Claude API requests.
 *
 * Why this exists: a pathological repo + an unlucky module loop could
 * burn $100+ of Anthropic credit on a single $399 Nuclear scan. That
 * destroys the margin and risks an ops emergency. This helper gives
 * every caller a hard ceiling expressed in USD.
 *
 * Usage:
 *   const cap = createSpendCap({ scope: 'scan-123', maxUsd: 5 });
 *   ...
 *   if (!cap.canSpend(estimatedUsd)) throw new Error('spend cap reached');
 *   const response = await callClaude(...);
 *   cap.record({ inputTokens: 1234, outputTokens: 567, model: 'claude-sonnet-4-6' });
 *
 * Pure JS, no I/O, fully unit-testable.
 *
 * Env vars (read by the default factory):
 *   GATETEST_SPEND_CAP_USD              — overall per-process budget (default $50)
 *   GATETEST_SPEND_CAP_PER_SCAN_USD     — per-scan budget (default $10)
 *   GATETEST_SPEND_WARN_USD             — warn when spend crosses (default $3)
 */

// Sonnet 4.6 published pricing per million tokens. Source: Anthropic
// console at the time of writing. Keep in sync if pricing changes.
const MODEL_PRICING_USD_PER_MILLION = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':         { input: 3.00,  output: 15.00 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00 },
  'claude-haiku-4-5':          { input: 0.80,  output: 4.00 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00 },
  // Fallback used when the model isn't in the table — conservative
  // (assumes opus pricing) so unknown models don't accidentally
  // under-budget.
  '__default__':               { input: 15.00, output: 75.00 },
};

const DEFAULT_OVERALL_CAP_USD = 50;
const DEFAULT_PER_SCAN_CAP_USD = 10;
const DEFAULT_WARN_USD = 3;

/**
 * Estimate USD cost for a single Claude API response.
 */
function estimateCallCostUsd({ inputTokens, outputTokens, model }) {
  const price = MODEL_PRICING_USD_PER_MILLION[model] || MODEL_PRICING_USD_PER_MILLION.__default__;
  const inputCost = ((inputTokens || 0) / 1_000_000) * price.input;
  const outputCost = ((outputTokens || 0) / 1_000_000) * price.output;
  return inputCost + outputCost;
}

/**
 * Create a spend cap instance.
 *
 * @param {Object} opts
 * @param {string} [opts.scope]     Logical name (e.g. 'scan-abc123'). Used in messages.
 * @param {number} [opts.maxUsd]    Hard ceiling — calls beyond this throw / report cap-reached.
 * @param {number} [opts.warnUsd]   When crossed, record a warning event.
 * @returns {{
 *   spentUsd: () => number,
 *   record: (call: { inputTokens, outputTokens, model }) => void,
 *   canSpend: (estimatedUsd: number) => boolean,
 *   remainingUsd: () => number,
 *   warningTriggered: () => boolean,
 *   summary: () => string,
 * }}
 */
function createSpendCap(opts = {}) {
  const scope = String(opts.scope || 'global');
  const maxUsd = Number.isFinite(opts.maxUsd) ? opts.maxUsd : DEFAULT_PER_SCAN_CAP_USD;
  const warnUsd = Number.isFinite(opts.warnUsd) ? opts.warnUsd : DEFAULT_WARN_USD;

  if (maxUsd <= 0) throw new RangeError('maxUsd must be > 0');
  if (warnUsd < 0) throw new RangeError('warnUsd must be >= 0');

  let spent = 0;
  let warned = false;
  let calls = 0;

  return {
    spentUsd: () => spent,
    remainingUsd: () => Math.max(0, maxUsd - spent),
    warningTriggered: () => warned,
    record(call) {
      const cost = estimateCallCostUsd(call);
      spent += cost;
      calls += 1;
      if (!warned && spent >= warnUsd) warned = true;
    },
    canSpend(estimatedUsd) {
      const e = Number.isFinite(estimatedUsd) ? estimatedUsd : 0;
      return (spent + e) <= maxUsd;
    },
    summary() {
      return `spend-cap[${scope}]: $${spent.toFixed(4)} / $${maxUsd} across ${calls} call(s) (remaining $${(maxUsd - spent).toFixed(4)})`;
    },
  };
}

/**
 * Convenience: build a spend cap whose ceilings come from env vars.
 * Used by routes that don't want to hardcode budget values. Falls
 * through to the documented defaults if env is empty.
 */
function spendCapFromEnv(scope) {
  const overallCap = Number(process.env.GATETEST_SPEND_CAP_USD) || DEFAULT_OVERALL_CAP_USD;
  const perScanCap = Number(process.env.GATETEST_SPEND_CAP_PER_SCAN_USD) || DEFAULT_PER_SCAN_CAP_USD;
  const warnUsd = Number(process.env.GATETEST_SPEND_WARN_USD) || DEFAULT_WARN_USD;
  // The PER-SCAN cap is what the route enforces. The OVERALL cap is
  // for monitoring across the process; not enforced here because
  // serverless functions are one-shot anyway.
  void overallCap; // documented but not enforced inside one process
  return createSpendCap({ scope, maxUsd: perScanCap, warnUsd });
}

module.exports = {
  createSpendCap,
  spendCapFromEnv,
  estimateCallCostUsd,
  // Constants exported for tests and observability.
  DEFAULT_OVERALL_CAP_USD,
  DEFAULT_PER_SCAN_CAP_USD,
  DEFAULT_WARN_USD,
  MODEL_PRICING_USD_PER_MILLION,
};
