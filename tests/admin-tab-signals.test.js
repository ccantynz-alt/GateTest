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
    assert.match(platformsTabSrc, /import PlatformSiblings from "\.\.\/PlatformSiblings"/);
    assert.match(platformsTabSrc, /<PlatformSiblings \/>/);
  });

  it('the Vapron sibling URL points at the platform API, not the marketing site', () => {
    // vapron.ai 404s every /api/* path except /api/health, which rendered
    // Vapron permanently "down" and would now light the tab badge forever.
    assert.match(siblingsRouteSrc, /api\.vapron\.ai\/api\/platform\/api\/platform-status/);
    assert.ok(
      !/"https:\/\/vapron\.ai\/api\/platform-status"/.test(siblingsRouteSrc),
      'the marketing-site URL must not come back',
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
