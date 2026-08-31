/**
 * `ready: true` must mean the credentials actually work, not that the
 * variables are non-empty.
 *
 * Production incident, verified 2026-08-31: `GET gatetest.io/api/status`
 * answered `ready: true` / HTTP 200 with `required_set: 6/6`, while
 * GATETEST_PRIVATE_KEY held the pasted documentation example, GitHub returned
 * `401 Bad credentials`, and every private-repo scan 502'd on both hosts.
 *
 * The route was ALREADY detecting the fake value — it appeared in the
 * `invalid_placeholders` array in the very same response. The detection was
 * simply never wired to the verdict:
 *
 *     const ready = missing.length === 0;   // computed from presence only
 *
 * So this is not "add a check". The check existed and was correct. This pins
 * the wiring: a variable holding filler must be counted as NOT SET everywhere,
 * because filler is not a value.
 *
 * That is the same defect shape as the secrets module's blanket skips fixed
 * earlier today — a component that knows the truth and reports something else.
 * For a QA vendor that class matters more than a crash: a green dashboard over
 * a dead product is the one failure our customers cannot detect for us.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { inspectEnvValue } = require('../src/core/env-placeholder');

// The route's isSet(), extracted to its post-fix definition. Kept in lockstep
// with website/app/api/status/route.ts by the assertion at the bottom, which
// reads the real file — a copied helper that silently drifts would make this
// whole suite decorative.
function isSet(name, env) {
  const v = env[name];
  if (typeof v !== 'string' || v.trim().length === 0) return false;
  return inspectEnvValue(name, v).ok;
}

describe('status: readiness must reflect validity, not presence', () => {
  it('the exact production value is not "set"', () => {
    // The shape that shipped: PEM markers, no key body.
    const pasted = '-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----';
    assert.strictEqual(
      isSet('GATETEST_PRIVATE_KEY', { GATETEST_PRIVATE_KEY: pasted }),
      false,
      'a PEM with no body must not count as configured',
    );
  });

  it('common filler shapes are not "set"', () => {
    const cases = {
      SESSION_SECRET: 'changeme',
      STRIPE_SECRET_KEY: 'your_stripe_key_here',
      ANTHROPIC_API_KEY: 'sk-ant-...',
    };
    for (const [name, value] of Object.entries(cases)) {
      assert.strictEqual(isSet(name, { [name]: value }), false, `${name}=${value} must not count as set`);
    }
  });

  // ---- NEGATIVE CONTROLS -------------------------------------------------
  // A readiness probe that fails toward "not ready" on real credentials is
  // its own outage. These must stay green.

  it('a real-shaped credential IS set', () => {
    const realish = 'sk_live_' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3';
    assert.strictEqual(isSet('STRIPE_SECRET_KEY', { STRIPE_SECRET_KEY: realish }), true);
    assert.strictEqual(
      isSet('DATABASE_URL', { DATABASE_URL: 'postgres://u:p@db.internal:5432/gatetest' }),
      true,
    );
  });

  it('a real PEM with a genuine body IS set', () => {
    // Length matters: a real RSA-2048 PEM is ~1700 chars and the detector
    // enforces a 500-char floor. An under-length fixture here would pass for
    // the WRONG reason and hide a probe that rejects valid keys.
    const body = 'MIIEowIBAAKCAQEA' + 'x'.repeat(1700);
    const pem = `-----BEGIN RSA PRIVATE KEY-----\\n${body}\\n-----END RSA PRIVATE KEY-----`;
    assert.ok(pem.length > 1700, 'fixture must be realistic length');
    assert.strictEqual(isSet('GATETEST_PRIVATE_KEY', { GATETEST_PRIVATE_KEY: pem }), true);
  });

  it('an absent var is simply not set, with no crash', () => {
    assert.strictEqual(isSet('GATETEST_PRIVATE_KEY', {}), false);
    assert.strictEqual(isSet('GATETEST_PRIVATE_KEY', { GATETEST_PRIVATE_KEY: '   ' }), false);
  });

  // ---- THE WIRING ITSELF -------------------------------------------------

  it('the route computes isSet through the placeholder detector', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'website', 'app', 'api', 'status', 'route.ts'),
      'utf-8',
    );
    assert.match(
      src,
      /function isSet\([\s\S]*?inspectEnvValue\(/,
      'isSet() must consult inspectEnvValue — without it, `ready` is a presence check again',
    );
    assert.match(
      src,
      /inspectEnvValue/,
      'route must import inspectEnvValue, not only findPlaceholders',
    );
  });

  it('the GitHub App credentials are classified, not just placeholder-scanned', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'website', 'app', 'api', 'status', 'route.ts'),
      'utf-8',
    );
    // They must appear in a classified list (with a `why`), otherwise a fake
    // value is reported by findPlaceholders and acted on by nothing.
    assert.match(
      src,
      /name: "GATETEST_PRIVATE_KEY", why:/,
      'GATETEST_PRIVATE_KEY must be classified with a `why`, not only listed for placeholder scanning',
    );
    assert.match(src, /name: "GATETEST_APP_ID", why:/);
  });
});
