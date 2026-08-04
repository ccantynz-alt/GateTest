/**
 * Pricing-consistency tripwire (Bible Forbidden #17).
 *
 * Tier prices are intentionally defined/checked in more than one place:
 *   1. website/app/lib/checkout-tiers.ts       — TIERS (source of truth, cents)
 *      — imported by both checkout/route.ts and stripe-checkout.js, NOT
 *        re-declared in either (2026-07-20: was duplicated in both, drifted;
 *        see docs/ROADMAP.md). checkout/route.ts itself intentionally has
 *        no priceInCents literals to scrape anymore.
 *   2. website/app/components/Pricing.tsx      — UI display strings ("$29")
 *   3. website/app/api/stripe-webhook/route.ts — tierPrices (USD, DB logging)
 *
 * This test parses/requires all of them and fails the suite the moment any
 * disagree — a price change that doesn't touch every surface can't ship.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** First `priceInCents: N` after `<tierKey>: {` in the given source. */
function centsFor(source, tierKey) {
  const re = new RegExp(`${tierKey}:\\s*\\{[\\s\\S]*?priceInCents:\\s*(\\d+)`);
  const m = source.match(re);
  return m ? Number(m[1]) : null;
}

const tiersSrc = read('website/app/lib/checkout-tiers.ts');
const checkoutSrc = read('website/app/api/checkout/route.ts');
const pricingSrc = read('website/app/components/Pricing.tsx');
const webhookSrc = read('website/app/api/stripe-webhook/route.ts');

// Source of truth — parsed, not hand-written, so this test tracks checkout-tiers.ts.
const TIER_KEYS = ['quick', 'full', 'scan_fix', 'nuclear', 'continuous', 'mcp'];
const truth = Object.fromEntries(TIER_KEYS.map((k) => [k, centsFor(tiersSrc, k)]));

describe('checkout-tiers.ts TIERS (source of truth)', () => {
  test('defines a price for all six tiers', () => {
    for (const key of TIER_KEYS) {
      assert.ok(
        Number.isInteger(truth[key]) && truth[key] > 0,
        `checkout-tiers.ts is missing priceInCents for tier "${key}"`
      );
    }
  });

  test('checkout/route.ts imports TIERS from checkout-tiers.ts rather than re-declaring it', () => {
    assert.match(
      checkoutSrc,
      /import\s*\{\s*TIERS\s*\}\s*from\s*["']@\/app\/lib\/checkout-tiers["']/,
      'checkout/route.ts should import TIERS, not define its own copy — that duplication is exactly what drifted before (KI: stripe-checkout.js stale "all-84" module count)'
    );
    assert.doesNotMatch(
      checkoutSrc,
      /priceInCents:\s*\d+/,
      'checkout/route.ts should have no priceInCents literals of its own — they belong only in checkout-tiers.ts'
    );
  });
});

describe('Pricing.tsx display strings match checkout cents', () => {
  // UI tier name → checkout tier key
  const UI_TIERS = [
    ['Quick Scan', 'quick'],
    ['Full Scan', 'full'],
    ['Scan + Fix', 'scan_fix'],
    ['Forensic Scan', 'nuclear'],
    ['Continuous', 'continuous'],
    ['MCP Integration', 'mcp'],
  ];

  for (const [uiName, tierKey] of UI_TIERS) {
    test(`${uiName} shows $${truth[tierKey] / 100}`, () => {
      const re = new RegExp(
        `name:\\s*"${uiName.replace(/[+]/g, '\\+')}"[\\s\\S]{0,200}?price:\\s*"\\$(\\d+)"`
      );
      const m = pricingSrc.match(re);
      assert.ok(m, `Pricing.tsx has no price string for "${uiName}"`);
      assert.strictEqual(
        Number(m[1]) * 100,
        truth[tierKey],
        `Pricing.tsx shows $${m[1]} for "${uiName}" but checkout charges ${truth[tierKey]}¢`
      );
    });
  }
});

describe('stripe-webhook tierPrices (DB logging) match checkout cents', () => {
  test('one-time tiers agree', () => {
    const m = webhookSrc.match(/tierPrices[\s\S]{0,300}?\{([\s\S]*?)\}/);
    assert.ok(m, 'stripe-webhook/route.ts has no tierPrices map');
    const map = m[1];
    for (const key of ['quick', 'full', 'scan_fix', 'nuclear']) {
      const entry = map.match(new RegExp(`${key}:\\s*(\\d+)`));
      assert.ok(entry, `tierPrices is missing "${key}"`);
      assert.strictEqual(
        Number(entry[1]) * 100,
        truth[key],
        `tierPrices logs $${entry[1]} for "${key}" but checkout charges ${truth[key]}¢`
      );
    }
  });
});

describe('stripe-checkout.js test helper matches checkout cents', () => {
  // stripe-checkout.js no longer has its own priceInCents literals to
  // scrape — it require()s TIERS from checkout-tiers.ts (2026-07-20 fix
  // for the exact drift this test file exists to catch). Verify the
  // require wiring directly instead of regex-scraping for now-absent text.
  const helperSrc = read('website/app/lib/stripe-checkout.js');

  test('requires TIERS from checkout-tiers.ts rather than re-declaring it', () => {
    assert.match(
      helperSrc,
      /require\(["']\.\/checkout-tiers\.ts["']\)/,
      'stripe-checkout.js should require TIERS from checkout-tiers.ts, not define its own copy'
    );
    assert.doesNotMatch(
      helperSrc,
      /priceInCents:\s*\d+/,
      'stripe-checkout.js should have no priceInCents literals of its own'
    );
  });

  // stripe-checkout.js require()s checkout-tiers.ts, which needs Node >= 22.18
  // (type-stripping). On older runtimes the require throws a SyntaxError on
  // TS-only syntax — skip the runtime-load tests there rather than hard-fail,
  // matching the graceful-degradation pattern in extraction-regex.test.js.
  // The static require-wiring + regex checks above still run everywhere.
  let loadedTiers = null;
  let tsRequireSupported = true;
  try {
    // eslint-disable-next-line global-require
    ({ TIERS: loadedTiers } = require('../website/app/lib/stripe-checkout.js'));
  } catch {
    tsRequireSupported = false;
  }

  for (const key of ['quick', 'full']) {
    test(`helper "${key}" agrees (loaded at runtime)`, { skip: !tsRequireSupported && 'runtime cannot require .ts (needs Node >= 22.18 type-stripping)' }, () => {
      const TIERS = loadedTiers;
      assert.strictEqual(
        TIERS[key].priceInCents,
        truth[key],
        `stripe-checkout.js's loaded TIERS.${key}.priceInCents is ${TIERS[key] && TIERS[key].priceInCents} but checkout-tiers.ts has ${truth[key]}¢`
      );
    });
  }
});

/**
 * Billing-honesty tripwire (added 2026-08-04).
 *
 * GateTest charged upfront at checkout from 2026-05-18 (Craig) — there is no
 * `capture_method: manual` in the checkout path. But "pay-on-completion" /
 * "card hold" copy from the PREVIOUS model survived on nine public surfaces
 * for months, including the homepage pricing headline and a ✅ differentiator
 * row on /compare/sonarqube. That is a false statement about when a
 * customer's card is charged — worse than a stale module count, and exactly
 * the kind of claim a GitHub Marketplace reviewer or Stripe checks.
 *
 * Nothing caught it: every price matched, so pricing-consistency passed.
 * These two tests tie the WORDS to the MECHANISM, in both directions.
 */
describe('billing copy matches what Stripe actually does', () => {
  const CHECKOUT_PATHS = [
    'website/app/lib/stripe-checkout.js',
    'website/app/api/checkout/route.ts',
  ];

  // Surfaces a customer or a Marketplace reviewer actually reads.
  const PUBLIC_COPY = [
    'website/app/components/Pricing.tsx',
    'website/app/components/Install.tsx',
    'website/app/compare/sonarqube/page.tsx',
    'website/app/compare/github-code-scanning/page.tsx',
    'website/app/for/nextjs/page.tsx',
    'website/app/for/typescript/page.tsx',
    'website/app/for/[country]/page.tsx',
    'vscode-extension/package.json',
    'docs/marketplace/install-guide.md',
    'MARKETING.md',
  ];

  // "pay-on-completion" is legitimate INSIDE the guard comment that forbids
  // it, and in the anti-abuse clause of the Terms; match only the claim forms.
  const DEFERRED_PAYMENT_CLAIM =
    /(pay|charged|charge)\s+(only\s+)?(when|after|if|on)\s+(we\s+|the\s+scan\s+|it\s+|results?\s+|work\s+)?(deliver|delivers|delivered|completes?|completed|land|lands|runs|fixes)|card hold/i;

  test('the checkout path does NOT use manual capture', () => {
    for (const rel of CHECKOUT_PATHS) {
      const src = read(rel);
      const uncommented = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(\/\/|\*).*$/gm, '');
      assert.ok(
        !/capture_method['"\s:]+.*manual/i.test(uncommented),
        `${rel} sets capture_method: manual. If the billing model genuinely ` +
          'moved back to authorize-then-capture, update the public copy in ' +
          'PUBLIC_COPY and this test together — do not leave them disagreeing.'
      );
    }
  });

  for (const rel of PUBLIC_COPY) {
    test(`${rel} does not promise deferred payment`, () => {
      const src = read(rel);
      const offending = src
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => DEFERRED_PAYMENT_CLAIM.test(line))
        // The MARKETING.md guard note quotes the banned phrasing on purpose.
        .filter(([, line]) => !/DO NOT reintroduce|banned|guard/i.test(line));

      assert.deepStrictEqual(
        offending.map(([n, l]) => `${n}: ${l.trim()}`),
        [],
        `${rel} tells the customer they are charged on delivery, but the ` +
          'card is captured at checkout (no capture_method: manual). Say ' +
          '"charged at checkout" / "per scan, not per seat" instead.'
      );
    });
  }
});
