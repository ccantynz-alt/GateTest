'use strict';

/**
 * Anthropic endpoint + API-version configuration — website-side twin of
 * src/core/anthropic-config.js. Kept as a separate file because website/
 * is CommonJS and cannot import from src/ (same constraint as
 * engine-models.js). `tests/anthropic-config.test.js` asserts the twins agree.
 *
 * Why this exists (KI #78):
 *   `anthropic-version: '2023-06-01'` was hardcoded at 21 call sites and the
 *   host at 23, so bumping the API version meant editing 21 files and there
 *   was no way to point GateTest at a proxy, gateway, or Bedrock/Vertex
 *   front-end at all. Both are now one env var.
 *
 * Env:
 *   ANTHROPIC_BASE_URL — default https://api.anthropic.com. May include a
 *                        path prefix (e.g. https://gw.corp.example/anthropic)
 *                        for corporate gateways; the prefix is preserved.
 *   ANTHROPIC_VERSION  — default 2023-06-01.
 *
 * Note on CSP: website/next.config.ts lists api.anthropic.com in
 * `connect-src`, but every Anthropic call in this codebase is server-side
 * Node. CSP governs browser fetches only, so a custom base URL does NOT
 * need a CSP entry.
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_VERSION = '2023-06-01';

/**
 * A malformed override THROWS rather than falling back to the default.
 *
 * That is deliberate and it is the safe direction. Someone setting
 * ANTHROPIC_BASE_URL is usually routing through a gateway for audit,
 * egress-control or data-residency reasons; silently sending their prompts
 * to api.anthropic.com because of a typo is precisely the outcome they
 * configured it to prevent. Fail loudly at the first call instead
 * (Forbidden #16 — never silently fail).
 *
 * Unset is not an error — that is the documented default.
 */
function baseUrl() {
  const raw = (process.env.ANTHROPIC_BASE_URL || '').trim();
  if (!raw) return DEFAULT_BASE_URL;
  const cleaned = raw.replace(/\/+$/, '');
  let u;
  try {
    u = new URL(cleaned);
  } catch {
    throw new Error(
      `ANTHROPIC_BASE_URL is not a valid URL: ${JSON.stringify(raw)}. ` +
      'Expected something like https://gateway.example.com or ' +
      'https://gateway.example.com/anthropic. Unset it to use ' +
      `${DEFAULT_BASE_URL}.`,
    );
  }
  // HTTPS only, deliberately. Most call sites use `https.request`, which
  // cannot speak plain HTTP — accepting an http:// base would either need a
  // per-site protocol switch or would silently upgrade the request to HTTPS
  // and fail in a way that points nowhere near the real cause. Rejecting it
  // up front is the honest limitation. (Also: these requests carry the API
  // key and the customer's source code.)
  if (u.protocol !== 'https:') {
    throw new Error(
      `ANTHROPIC_BASE_URL must use https, got ${JSON.stringify(raw)}. ` +
      'Plain HTTP is not supported: most call sites use https.request and ' +
      'these requests carry your API key and source code.',
    );
  }
  return cleaned;
}

function apiVersion() {
  const raw = (process.env.ANTHROPIC_VERSION || '').trim();
  return raw || DEFAULT_VERSION;
}

/**
 * Parsed pieces for `https.request`, which takes hostname/port/path rather
 * than a URL. Throws on a malformed override, same rationale as baseUrl():
 * an unnoticed fallback to the real API defeats the point of the setting.
 *
 * @returns {{hostname: string, port: number, protocol: string, prefix: string}}
 */
function endpoint() {
  const u = new URL(baseUrl());
  const prefix = u.pathname.replace(/\/+$/, '');
  return {
    hostname: u.hostname,
    port: u.port ? Number(u.port) : (u.protocol === 'http:' ? 80 : 443),
    protocol: u.protocol,
    prefix: prefix === '/' ? '' : prefix,
  };
}

/** Path for https.request, honouring any gateway path prefix. */
function apiPath(route = '/v1/messages') {
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${endpoint().prefix}${r}`;
}

/** Absolute URL for fetch(). */
function apiUrl(route = '/v1/messages') {
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${baseUrl()}${r}`;
}

/**
 * Standard request headers. `extra` is merged last so a caller can add
 * beta flags without duplicating the base set.
 *
 * @param {string} apiKey
 * @param {object} [extra]
 */
function headers(apiKey, extra = {}) {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': apiVersion(),
    'x-api-key': apiKey,
    ...extra,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_VERSION,
  baseUrl,
  apiVersion,
  endpoint,
  apiPath,
  apiUrl,
  headers,
};
