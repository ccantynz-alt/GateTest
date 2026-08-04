/**
 * A visitor must never be offered a sign-in button that cannot work.
 *
 * ── The bug this locks down ─────────────────────────────────────────────────
 * `AuthModal` rendered GitHub, GitLab and Google unconditionally, while each
 * initiate route answers 503 when its credentials are unset. Live
 * `/api/status` on 2026-08-05 reported `GOOGLE_CLIENT_SECRET` missing in
 * production, so "Continue with Google" returned a raw JSON error blob to
 * anyone who clicked it — with the GitHub Marketplace listing under review and
 * already rejected once, on a listing whose reviewer opens exactly these flows.
 *
 * Two of the routes also returned `missing: status.missing`, disclosing the
 * names of our unset environment variables to an unauthenticated visitor.
 *
 * These are static assertions over the source rather than a rendering test —
 * the failure was structural (a hardcoded list, a leaky error body), and a
 * structural check is what catches it coming back.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n?/g, '\n');

const MODAL = 'website/app/components/AuthModal.tsx';
const PROVIDERS_ROUTE = 'website/app/api/auth/providers/route.ts';
const HELPER = 'website/app/lib/auth-unavailable.ts';
const ROUTES = [
  ['website/app/api/auth/github/route.ts', 'GitHub'],
  ['website/app/api/auth/gitlab/route.ts', 'GitLab'],
  ['website/app/api/auth/google/route.ts', 'Google'],
];

describe('sign-in providers — never offer a button that 503s', () => {
  it('the availability endpoint exists and reports all three providers', () => {
    const src = read(PROVIDERS_ROUTE);
    for (const key of ['github', 'gitlab', 'google']) {
      assert.ok(
        new RegExp(`${key}:\\s*get`).test(src),
        `${PROVIDERS_ROUTE} must report '${key}' from its OAuth config helper`,
      );
    }
  });

  it('the availability endpoint leaks no configuration detail', () => {
    const src = read(PROVIDERS_ROUTE);
    // It is called from the browser on every modal open. Booleans only.
    for (const leak of ['missing', 'clientId', 'clientSecret', 'redirectUri']) {
      assert.ok(
        !new RegExp(`\\b${leak}\\b`).test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
        `${PROVIDERS_ROUTE} must not expose '${leak}' — it answers unauthenticated browsers`,
      );
    }
  });

  it('the modal renders providers from the endpoint, not a hardcoded list', () => {
    const modal = read(MODAL);
    assert.ok(
      modal.includes('/api/auth/providers'),
      `${MODAL} must ask which providers are configured before rendering buttons`,
    );
    // The exact shape of the old bug: a literal href per provider.
    for (const key of ['github', 'gitlab', 'google']) {
      assert.ok(
        !new RegExp(`href="/api/auth/${key}"`).test(modal),
        `${MODAL} hardcodes a button for '${key}' — render from the availability map instead`,
      );
    }
  });

  it('the modal fails OPEN if the probe breaks', () => {
    // A broken probe must not lock everyone out of a working sign-in. If this
    // ever flips to fail-closed, an unrelated outage takes auth down with it.
    const modal = read(MODAL);
    assert.ok(
      /catch[\s\S]{0,320}github:\s*true/.test(modal),
      `${MODAL} must default to showing providers when /api/auth/providers fails`,
    );
  });

  for (const [rel, label] of ROUTES) {
    it(`${label} initiate route answers a page, not a JSON error`, () => {
      const src = read(rel);
      assert.ok(
        src.includes(`authUnavailable("${label}")`),
        `${rel} must use authUnavailable() for the unconfigured case`,
      );
      assert.ok(
        !/NextResponse\.json\(\s*\{\s*error:[^)]*not configured/.test(src),
        `${rel} still returns a JSON error body for the unconfigured case`,
      );
      assert.ok(
        !/missing:\s*status\.missing/.test(src),
        `${rel} discloses unset environment variable names to anonymous visitors`,
      );
    });
  }

  it('the unavailable page is HTML, escapes its input, and stays 503', () => {
    const src = read(HELPER);
    assert.ok(/text\/html/.test(src), 'must respond as HTML — a human clicked a button');
    assert.ok(/status:\s*503/.test(src), 'must stay 503 so uptime checks still see the outage');
    assert.ok(/escapeHtml/.test(src), 'must escape the provider label it interpolates');
  });

  it('the escape table covers every HTML-significant character', () => {
    // Honest about its own limits: this checks the table is COMPLETE, not that
    // the function runs — the helper is TypeScript and cannot be required from
    // the node test runner. Behaviour is covered by the website build plus the
    // fact that the only interpolated value is a hardcoded provider label.
    // A partial escape table is the realistic regression here; a missing `'`
    // or `"` is what turns an interpolation into an attribute break.
    const src = read(HELPER);
    for (const [char, entity] of [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]) {
      assert.ok(
        src.includes(entity),
        `escape table is missing the mapping for ${JSON.stringify(char)} -> ${entity}`,
      );
    }
  });
});
