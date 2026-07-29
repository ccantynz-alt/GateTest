/**
 * Scheduler endpoints must authorise on a SECRET, never on a header a
 * client can set.
 *
 * LIVE AUTH BYPASS, found 2026-07-28. /api/watches/tick returned true for
 * any request carrying `x-vercel-cron: 1`. That was safe on Vercel, where
 * the platform owns and strips that header. We left Vercel on 2026-07-14
 * and run on Vapron, where nothing strips it — so it became a boolean
 * password anyone could send. Verified against live production:
 *
 *   curl https://gatetest.io/api/watches/tick              -> 401
 *   curl -H 'x-vercel-cron: 1' https://gatetest.io/...     -> 200 + data
 *
 * The 200 ran the tick unauthenticated and returned customer watch targets
 * and their health to an anonymous caller.
 *
 * Second bypass in the same function: `NODE_ENV !== "production"` authorises
 * everything whenever NODE_ENV is UNSET — the default for a bare Node
 * process. Inverted to require an explicit "development" so it fails closed.
 *
 * These are source-level assertions because the handlers need a live DB and
 * Next request plumbing to execute; the property being guarded is "the
 * bypass is not in the code", which source text captures exactly.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CRON_ROUTES = [
  'website/app/api/watches/tick/route.ts',
  'website/app/api/scan/worker/tick/route.ts',
];

describe('cron auth — no client-settable header may authorise', () => {
  for (const rel of CRON_ROUTES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    it(`${rel} does not trust a bare x-vercel-cron header`, () => {
      // The exact shape of the bypass: compare the header to a constant and
      // return true. A header carrying the SECRET is fine — that is
      // x-vercel-cron-secret, checked against CRON_SECRET.
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      assert.ok(
        !/x-vercel-cron["']\s*\)\s*===\s*["']1["']/.test(code),
        `${rel}: a boolean header is a password anyone can type. We are Vapron-only — `
          + 'nothing strips this header, so it authorises the public.',
      );
    });

    it(`${rel} does not fail open on an unset NODE_ENV`, () => {
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      assert.ok(
        !/NODE_ENV\s*!==\s*["']production["']/.test(code),
        `${rel}: "NODE_ENV !== production" authorises everything when NODE_ENV is UNSET, `
          + 'which is the default for a bare Node process. Require an explicit "development".',
      );
    });
  }

  it('watches/tick compares the secret in constant time and denies when unset', () => {
    const src = fs.readFileSync(path.join(ROOT, CRON_ROUTES[0]), 'utf8');
    assert.match(src, /timingSafeEqual/, 'secret comparison must be timing-safe');
    assert.match(src, /const cronSecret = process\.env\.CRON_SECRET \|\| ""/);
    // An unset secret must reach `return false`, never an early true.
    assert.match(src, /if \(cronSecret && bearer\)/,
      'an unset CRON_SECRET must fall through to deny, not skip the check');
  });

  it('the Vercel-era comment does not survive to mislead the next reader', () => {
    const src = fs.readFileSync(path.join(ROOT, CRON_ROUTES[0]), 'utf8');
    assert.ok(
      !/Vercel Cron sets a specific header, or allow manual trigger/.test(src),
      'the old comment described the bypass as intended behaviour',
    );
  });
});
