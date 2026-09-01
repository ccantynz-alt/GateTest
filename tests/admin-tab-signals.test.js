/**
 * Admin console — tab problem-signal contract (source text).
 *
 * Why this file exists: the 2026-07-27 audit found production 102 commits
 * stale with RESEND_API_KEY unset, while the admin console showed a clean
 * screen. The data was already being served — /api/admin/platform-siblings
 * and /api/admin/stats both existed — it simply had nowhere to surface.
 * These tests pin the wiring so a future refactor cannot quietly un-surface
 * it again.
 *
 * Source-text assertions rather than DOM rendering: this repo has no React
 * test renderer, and the regression being guarded is "the wiring was
 * deleted", which source text catches.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'website', 'app', p), 'utf8');

const uiSrc = read('admin/ui.tsx');
const panelSrc = read('admin/AdminPanel.tsx');
const platformsTabSrc = read('admin/tabs/PlatformsTab.tsx');
const siblingsRouteSrc = read('api/admin/platform-siblings/route.ts');

describe('admin tabs — TabDef carries live problem state', () => {
  it('TabDef declares status / count / statusLabel', () => {
    assert.match(uiSrc, /status\?:\s*"error"\s*\|\s*"warn"/);
    assert.match(uiSrc, /count\?:\s*number/);
    assert.match(uiSrc, /statusLabel\?:\s*string/);
  });

  it('AdminTabs actually renders the badge for a tab with status', () => {
    assert.match(uiSrc, /\{t\.status\s*&&\s*<TabStatusBadge/);
  });

  it('the badge is not colour-only — it carries a text alternative', () => {
    // WCAG 1.4.1: a red dot alone tells a colour-blind or screen-reader
    // operator nothing.
    assert.match(uiSrc, /sr-only/, 'badge must expose screen-reader text');
    assert.match(uiSrc, /title=\{label/, 'badge must expose a hover tooltip');
  });
});

describe('admin tabs — signals are wired to real endpoints', () => {
  it('Platforms tab badges unhealthy siblings as an error', () => {
    assert.match(panelSrc, /platform-siblings/, 'must read the sibling aggregator');
    assert.match(panelSrc, /t\.id === "platforms" && signals\.siblingsDown > 0/);
    assert.match(panelSrc, /status: "error"/);
  });

  it('Recent Scans badges failed scans as a warning', () => {
    assert.match(panelSrc, /t\.id === "scans" && signals\.failedScans > 0/);
    assert.match(panelSrc, /status: "warn"/);
  });

  it('the decorated list — not the static one — is passed to AdminTabs', () => {
    assert.match(panelSrc, /<AdminTabs tabs=\{tabs\}/);
    assert.ok(
      !/<AdminTabs tabs=\{ADMIN_TABS\}/.test(panelSrc),
      'passing ADMIN_TABS directly would render every badge dead',
    );
  });

  it('a failing stats endpoint is reported, not swallowed as an empty DB', () => {
    assert.match(panelSrc, /setStatsError/);
    assert.ok(
      !/catch \{\s*\/\/ DB not available yet/.test(panelSrc),
      'the silent catch must stay gone',
    );
  });

  it('a sibling-fetch failure does not fabricate a healthy signal', () => {
    assert.match(panelSrc, /leave the previous signal rather than inventing a clean one/);
  });
});

describe('admin — the sibling health widget is no longer dead code', () => {
  it('PlatformsTab imports and renders PlatformSiblings', () => {
    // Path-agnostic on purpose. This asserted `"../PlatformSiblings"` exactly,
    // which pinned the component's DIRECTORY rather than the thing the test is
    // named for — so co-locating it with its only consumer (spineHealth flagged
    // the up-directory import as a layering violation) failed a test about
    // whether the widget is wired up at all.
    assert.match(platformsTabSrc, /import PlatformSiblings from "\.{1,2}\/(?:\w+\/)*PlatformSiblings"/);
    assert.match(platformsTabSrc, /<PlatformSiblings \/>/);
  });

  it('the sibling URLs come from the shared registry, not this route', () => {
    // This test used to pin the literal `api.vapron.ai/api/platform/api/
    // platform-status` INTO this route file — making it the third hand-written
    // copy of a URL that already disagreed between two routes, and pinning the
    // one URL that turned out to be built on a path Vapron never shipped
    // (`/api/platform-status`: zero hits in their repo). A test that pins a
    // literal in place is how the drift survived.
    //
    // The URL itself is now asserted once, against the registry, in
    // tests/platform-siblings.test.js. What belongs here is the wiring: this
    // route must not grow its own copy.
    assert.match(siblingsRouteSrc, /from "@\/app\/lib\/platform-siblings"/);
    assert.ok(
      !/["'`]https?:\/\/[^"'`\s]*vapron\.ai/.test(siblingsRouteSrc),
      'the sibling route must not hardcode a Vapron URL — import the registry',
    );
  });
});

describe('admin — retired-host copy', () => {
  it('PlatformsTab no longer tells the operator to set a Vercel env var', () => {
    assert.ok(
      !/Vercel env var/.test(platformsTabSrc),
      'Vercel is retired (Bible §12) — copy must name the current deploy host',
    );
  });
});
