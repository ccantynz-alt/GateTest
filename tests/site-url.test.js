/**
 * Canonical site origin.
 *
 * The domain used to be a 148-occurrence string literal spread across SEO
 * canonicals, Stripe redirect URLs, the GitHub OAuth callback and badge
 * embed snippets. A domain move meant a find-and-replace where missing one
 * site silently pointed a paying customer at a domain we no longer own.
 *
 * These tests defend three things:
 *   1. One environment variable decides the domain.
 *   2. Malformed env values fall back rather than emitting a broken URL.
 *   3. New hardcoded literals cannot creep back into the routes that break
 *      customers when they are wrong.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_SITE_URL, siteUrl, badgeUrl, resolveSiteUrl, normaliseOrigin,
} = require('../website/app/lib/site-url');

const REPO = path.join(__dirname, '..');

describe('site-url — origin resolution', () => {
  it('prefers NEXT_PUBLIC_BASE_URL', () => {
    assert.strictEqual(
      resolveSiteUrl({ NEXT_PUBLIC_BASE_URL: 'https://gatetest.io' }),
      'https://gatetest.io',
    );
  });

  it('falls back to the server-side name the CLI and engine use', () => {
    assert.strictEqual(
      resolveSiteUrl({ GATETEST_PUBLIC_BASE_URL: 'https://gatetest.io' }),
      'https://gatetest.io',
    );
  });

  it('NEXT_PUBLIC_BASE_URL wins when both are set', () => {
    assert.strictEqual(
      resolveSiteUrl({
        NEXT_PUBLIC_BASE_URL: 'https://gatetest.io',
        GATETEST_PUBLIC_BASE_URL: 'https://stale.example',
      }),
      'https://gatetest.io',
    );
  });

  it('falls back to the default when nothing is set', () => {
    assert.strictEqual(resolveSiteUrl({}), DEFAULT_SITE_URL);
  });
});

describe('site-url — normalisation', () => {
  it('adds a scheme when the platform omits it', () => {
    // Vercel's VERCEL_URL and most PaaS host vars arrive bare.
    assert.strictEqual(normaliseOrigin('gatetest.io'), 'https://gatetest.io');
  });

  it('strips a trailing slash', () => {
    // The failure this prevents: 'https://x.io/' + '/checkout' -> '//checkout',
    // which mostly works and then fails OAuth exact-match redirect checking.
    assert.strictEqual(normaliseOrigin('https://gatetest.io/'), 'https://gatetest.io');
  });

  it('discards a path, query or fragment', () => {
    assert.strictEqual(normaliseOrigin('https://gatetest.io/a/b?c=1#d'), 'https://gatetest.io');
  });

  it('preserves an explicit port', () => {
    assert.strictEqual(normaliseOrigin('http://localhost:3000'), 'http://localhost:3000');
  });

  it('keeps http when it is stated explicitly', () => {
    assert.strictEqual(normaliseOrigin('http://gatetest.io'), 'http://gatetest.io');
  });

  it('rejects unusable values rather than emitting a broken URL', () => {
    for (const bad of [undefined, null, '', '   ', 'https://', 42, {}]) {
      assert.strictEqual(normaliseOrigin(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('a malformed env value falls back instead of poisoning every URL', () => {
    assert.strictEqual(resolveSiteUrl({ NEXT_PUBLIC_BASE_URL: 'https://' }), DEFAULT_SITE_URL);
  });
});

describe('site-url — joining', () => {
  it('returns the bare origin with no argument', () => {
    assert.strictEqual(siteUrl(), require('../website/app/lib/site-url').SITE_URL);
  });

  it('joins with or without a leading slash, never doubling it', () => {
    assert.strictEqual(siteUrl('/checkout'), `${siteUrl()}/checkout`);
    assert.strictEqual(siteUrl('checkout'), `${siteUrl()}/checkout`);
  });
});

describe('site-url — badge origin', () => {
  it('tracks the site origin by default', () => {
    assert.strictEqual(badgeUrl('/api/badge'), siteUrl('/api/badge'));
  });

  it('is a separate export so it can lag a domain move', () => {
    // Badges live in READMEs we do not control. When the site moves, already
    // -pasted badges keep hitting the OLD origin forever, so the old domain
    // must keep 301'ing. Keeping this decision separate from SITE_URL is what
    // makes that possible.
    const mod = require('../website/app/lib/site-url');
    assert.ok('BADGE_ORIGIN' in mod, 'BADGE_ORIGIN must stay independently settable');
  });
});

describe('site-url — no new hardcoded domains', () => {
  // Scoped to the files where a wrong domain breaks a paying customer:
  // payment redirects, OAuth callbacks, and the snippets customers paste
  // into repos we cannot edit. Marketing prose is deliberately excluded.
  const GUARDED = [
    'website/app/lib/stripe-checkout.js',
    'website/app/lib/github-callback.js',
    'website/app/lib/weekly-digest.js',
    'website/app/api/score/route.ts',
    'website/app/badge/[owner]/[repo]/route.ts',
    'website/app/layout.tsx',
  ];

  for (const rel of GUARDED) {
    it(`${rel} has no hardcoded domain outside comments`, () => {
      const full = path.join(REPO, rel);
      if (!fs.existsSync(full)) return; // route moved — other tests will catch it

      const offenders = fs.readFileSync(full, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter(({ line }) => /https:\/\/gatetest\.(ai|io)/.test(line))
        // Doc comments explaining the URL shape are fine; code is not.
        .filter(({ line }) => !(line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')));

      assert.deepStrictEqual(
        offenders.map((o) => `${o.no}: ${o.line}`),
        [],
        `hardcoded domain in ${rel} — import siteUrl() from app/lib/site-url instead`,
      );
    });
  }
});
