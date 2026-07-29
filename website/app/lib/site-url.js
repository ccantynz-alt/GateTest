'use strict';
/**
 * The canonical public origin — the ONE place that decides what domain
 * GateTest calls itself.
 *
 * Before this file existed the string 'https://gatetest.ai' appeared in 148
 * places across website/app: SEO canonicals, Open Graph URLs, Stripe success
 * and cancel URLs, the GitHub OAuth redirect, badge embed snippets, e-mail
 * footers. Fourteen of those repeated the same
 * `process.env.NEXT_PUBLIC_BASE_URL || 'https://gatetest.ai'` fallback by
 * hand, which meant a domain move was a 148-site find-and-replace where
 * missing one silently pointed a customer at a domain we no longer own.
 *
 * Now it is one environment variable.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Never write a gatetest.ai literal in runtime code. Import `siteUrl()`.
 * `tests/site-url.test.js` fails the suite if new literals appear in the
 * files that matter.
 *
 * ── Why the default is still gatetest.ai ────────────────────────────────────
 * Badge markdown lives in customers' READMEs permanently. Whatever this
 * default is at build time is what gets pasted into repos we do not control
 * and can never edit. Changing it does NOT retire the old domain — see
 * BADGE_ORIGIN below.
 */

const DEFAULT_SITE_URL = 'https://gatetest.ai';

/**
 * Normalise an origin: add https:// if the scheme is missing, drop any
 * trailing slash, drop any path.
 *
 * Deployment platforms hand these over in inconsistent shapes — Vercel's
 * VERCEL_URL has no scheme, a hand-typed env var often has a trailing slash.
 * Both produce '//' in a joined URL, which mostly works and occasionally
 * breaks OAuth redirect-URI exact-matching in ways that are miserable to
 * debug.
 *
 * @param {string|undefined} raw
 * @returns {string|null} normalised origin, or null if unusable
 */
function normaliseOrigin(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    // Round-tripping through URL discards paths, query and fragments, and
    // rejects the malformed values that would otherwise reach a customer.
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the public origin from the environment.
 *
 * Precedence — first usable value wins:
 *   1. NEXT_PUBLIC_BASE_URL      — canonical; inlined into client bundles
 *   2. GATETEST_PUBLIC_BASE_URL  — server-side name used by the CLI/engine
 *   3. DEFAULT_SITE_URL
 *
 * Each is read as an explicit member expression rather than a dynamic
 * lookup so Next.js can statically inline NEXT_PUBLIC_BASE_URL when this
 * module is pulled into a client bundle. A dynamic `env[name]` would leave
 * the value undefined in the browser and silently fall through to the
 * default.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
function resolveSiteUrl(env) {
  if (env) {
    return normaliseOrigin(env.NEXT_PUBLIC_BASE_URL)
      || normaliseOrigin(env.GATETEST_PUBLIC_BASE_URL)
      || DEFAULT_SITE_URL;
  }
  return normaliseOrigin(process.env.NEXT_PUBLIC_BASE_URL)
    || normaliseOrigin(process.env.GATETEST_PUBLIC_BASE_URL)
    || DEFAULT_SITE_URL;
}

/** The resolved public origin, e.g. 'https://gatetest.ai'. No trailing slash. */
const SITE_URL = resolveSiteUrl();

/**
 * Build an absolute URL onto the public origin.
 *
 *   siteUrl()                  -> 'https://gatetest.ai'
 *   siteUrl('/checkout')       -> 'https://gatetest.ai/checkout'
 *   siteUrl('api/badge')       -> 'https://gatetest.ai/api/badge'
 *
 * @param {string} [path]
 * @returns {string}
 */
function siteUrl(path = '') {
  if (!path) return SITE_URL;
  const p = String(path);
  return p.startsWith('/') ? `${SITE_URL}${p}` : `${SITE_URL}/${p}`;
}

/**
 * The origin that badge and README snippets are generated against.
 *
 * Deliberately separate from SITE_URL, and deliberately allowed to lag it.
 *
 * A badge someone pasted into their README in 2026 is a URL we can never
 * edit. When the site moves domain, every one of those badges keeps
 * resolving against the OLD origin — so the old domain must keep serving
 * (or 301'ing) for as long as those READMEs exist, which is effectively
 * forever. Retiring it turns every customer's build status into a broken
 * image.
 *
 * Set GATETEST_BADGE_ORIGIN only to move NEWLY-generated snippets. It does
 * not and cannot migrate the ones already out there.
 */
const BADGE_ORIGIN = normaliseOrigin(process.env.GATETEST_BADGE_ORIGIN) || SITE_URL;

/**
 * Build an absolute URL for a customer-persisted badge or embed snippet.
 * @param {string} [path]
 * @returns {string}
 */
function badgeUrl(path = '') {
  if (!path) return BADGE_ORIGIN;
  const p = String(path);
  return p.startsWith('/') ? `${BADGE_ORIGIN}${p}` : `${BADGE_ORIGIN}/${p}`;
}

module.exports = {
  DEFAULT_SITE_URL,
  SITE_URL,
  BADGE_ORIGIN,
  siteUrl,
  badgeUrl,
  resolveSiteUrl,
  normaliseOrigin,
};
