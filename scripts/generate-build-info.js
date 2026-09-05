#!/usr/bin/env node
'use strict';
/**
 * Stamp the real git commit into the build so a STALE DEPLOY IS VISIBLE.
 *
 * The live site served `version:"dev"`, `commit:"unknown"` for days while
 * showing wrong module counts and a dead model name — nobody could tell the
 * box was running an old build. This writes website/app/data/build-info.json
 * at build time; /api/platform-status serves it. If the SHA there doesn't
 * match `main`'s tip, the deploy is stale — full stop.
 *
 * Runs as website `prebuild` (so `npm run build` stamps automatically) and
 * from the dogfood-nightly workflow. Degrades gracefully with no git context.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// BUILD_INFO_OUT lets the test write somewhere else without touching the
// committed file.
const OUT = process.env.BUILD_INFO_OUT
  || path.join(__dirname, '..', 'website', 'app', 'data', 'build-info.json');

// No shell, fixed argv — nothing interpolated, so no command-injection surface.
function tryGit(args, fallback) {
  try {
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return fallback;
  }
}

// Env wins (a deploy platform may inject its own), then git, then "unknown".
const commit =
  process.env.GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  tryGit(['rev-parse', 'HEAD'], 'unknown');

const shortCommit = commit !== 'unknown' ? commit.slice(0, 7) : 'unknown';

let version = process.env.APP_VERSION || '';
if (!version) {
  // Derive from the Bible's `GateTest vX.Y.Z` string so it tracks releases.
  try {
    const bible = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
    const m = bible.match(/GateTest v(\d+\.\d+\.\d+)/);
    version = m ? m[1] : 'dev';
  } catch {
    version = 'dev';
  }
}

/**
 * When was each comparison page last changed? (The Fifty, move 38.)
 *
 * The /compare pages make claims about other tools, and a claim with no
 * date becomes the competitor's best asset the day it goes stale. The
 * honest date is the one git already holds — the last commit that touched
 * the page — so nobody types one and nobody forgets to bump it. The slug
 * list is imported, not copied, so a new comparison page is dated the
 * moment it exists.
 *
 * A shallow clone (fetch-depth: 1) knows only HEAD's date and would stamp
 * every page "updated today" — that is worse than no date, so with fewer
 * than two commits in history the map is left empty and the page says
 * only which engine version it was built against.
 */
function pageUpdatedDates() {
  const out = {};
  const depth = Number(tryGit(['rev-list', '--count', 'HEAD'], '0'));
  if (!(depth >= 2)) return out;
  let slugs = [];
  try {
    ({ COMPARISON_SLUGS: slugs } = require(path.join(__dirname, '..', 'website', 'app', 'lib', 'seo', 'all-urls.js')));
  } catch {
    return out;
  }
  for (const slug of slugs) {
    const rel = path.posix.join('website', 'app', 'compare', slug, 'page.tsx');
    const date = tryGit(['log', '-1', '--format=%cs', '--', rel], '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out[slug] = date;
  }
  return out;
}

const info = {
  version,
  commit,
  shortCommit,
  builtAt: new Date().toISOString(),
  pageUpdated: pageUpdatedDates(),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(info, null, 2) + '\n');
console.log(`[build-info] ${version} @ ${shortCommit} (${info.builtAt})`);
