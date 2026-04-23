// ============================================================================
// PRE-LAUNCH CHECKOUT DISABLED TEST — asserts Stripe is unreachable during
// the pre-launch phase.
// ============================================================================
// Guards the one-line revert shape in website/app/api/checkout/route.ts:
// the POST handler must short-circuit with 503 + a friendly pre-launch
// message before touching any Stripe code. The real checkout logic must
// remain in the file (commented) so restoration is a one-line revert.
//
// Why a source-level test: the route is TypeScript + Next's `NextResponse`,
// which we can't transpile or import without adding a Next runtime to the
// node --test harness (blocked: "no new deps, no npm install"). Asserting
// the response shape at the source level is the lightest possible tripwire
// that still proves Stripe cannot be reached through the checkout route.
// ============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROUTE_PATH = path.resolve(
  __dirname,
  '..',
  'website',
  'app',
  'api',
  'checkout',
  'route.ts'
);

const PRE_LAUNCH_MESSAGE =
  'Scan purchases are not yet available. Join the waitlist at gatetest.ai for launch notifications.';

function loadRouteSource() {
  return fs.readFileSync(ROUTE_PATH, 'utf-8');
}

// ---------------------------------------------------------------------------
// Extract the POST handler's raw body so assertions are scoped to it and
// don't accidentally pass on text that lives in the commented-out block or
// the GET handler below it.
// ---------------------------------------------------------------------------
function extractPostHandler(src) {
  const start = src.indexOf('export async function POST(');
  assert.ok(start !== -1, 'POST handler not found in route.ts');

  // Walk brace depth from the first `{` after the signature to find the
  // matching close brace. String-aware so a `}` in a string literal doesn't
  // close the function early.
  const bodyStart = src.indexOf('{', start);
  let depth = 0;
  let i = bodyStart;
  let inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i + 1);
    }
  }
  assert.fail('Unterminated POST handler body');
}

// ---------------------------------------------------------------------------
// The pre-launch short-circuit must come FIRST — before any line that could
// lead to a Stripe call. We prove this by finding the `return NextResponse`
// that carries the pre-launch status and ensuring no Stripe-reaching code
// sits between the function opening and it.
// ---------------------------------------------------------------------------
describe('POST /api/checkout — pre-launch short-circuit', () => {
  it('route.ts exists', () => {
    assert.ok(fs.existsSync(ROUTE_PATH), `missing: ${ROUTE_PATH}`);
  });

  it('POST handler returns 503 with the pre-launch payload before any Stripe call', () => {
    const src = loadRouteSource();
    const body = extractPostHandler(src);

    // The first executable return in the POST body must be the pre-launch
    // 503. We locate it by matching the status: 503 literal, then verify
    // everything preceding it in the function body is comment-only
    // (// PRE-LAUNCH: ...) — no awaits, no Stripe access, no branching.
    const statusIdx = body.indexOf('status: 503');
    assert.ok(statusIdx !== -1, 'expected `status: 503` in POST body');

    const returnIdx = body.lastIndexOf('return NextResponse.json', statusIdx);
    assert.ok(
      returnIdx !== -1,
      'expected `return NextResponse.json` preceding the 503 status'
    );

    const preamble = body.slice(1, returnIdx); // skip opening `{`
    const preambleSansComments = preamble
      .split('\n')
      .map((line) => line.replace(/^\s*\/\/.*$/, '').trim())
      .filter(Boolean)
      .join('\n');

    assert.strictEqual(
      preambleSansComments,
      '',
      'no executable code may precede the pre-launch 503 return — ' +
        'otherwise Stripe could be reached during pre-launch. Saw: ' +
        JSON.stringify(preambleSansComments)
    );
  });

  it('response body carries status: "pre-launch" and the waitlist message', () => {
    const src = loadRouteSource();
    const body = extractPostHandler(src);

    // Grab the pre-launch return block (from the first `return NextResponse`
    // through the `{ status: 503 }` close).
    const returnIdx = body.indexOf('return NextResponse.json');
    assert.ok(returnIdx !== -1);
    const block = body.slice(returnIdx, body.indexOf('{ status: 503 }', returnIdx) + '{ status: 503 }'.length);

    assert.match(
      block,
      /status:\s*["']pre-launch["']/,
      'response body must carry status: "pre-launch"'
    );
    assert.ok(
      block.includes(PRE_LAUNCH_MESSAGE),
      'response body must carry the exact waitlist message: ' + PRE_LAUNCH_MESSAGE
    );
  });

  it('carries the PRE-LAUNCH restore comment for one-line revert', () => {
    const src = loadRouteSource();
    assert.match(
      src,
      /PRE-LAUNCH: disabled until attorney review \+ launch\. Restore this block to re-enable\./,
      'restore marker comment must be present so the revert is obvious'
    );
  });

  it('real Stripe logic is preserved (commented) so revert is a one-line change', () => {
    const src = loadRouteSource();
    // These tokens are from the genuine pre-disable checkout flow. If any
    // disappear, the "one-line revert" promise is broken.
    for (const needle of [
      '/v1/checkout/sessions',
      'payment_intent_data[capture_method]',
      'Invalid tier',
    ]) {
      assert.ok(
        src.includes(needle),
        `expected Stripe-logic token preserved (commented): ${needle}`
      );
    }
  });
});
