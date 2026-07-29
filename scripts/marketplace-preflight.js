#!/usr/bin/env node
/**
 * GitHub Marketplace submission preflight.
 *
 * The first submission was rejected on 2026-05-14. A second rejection costs
 * another review cycle, so this script mechanically verifies everything a
 * GitHub reviewer actually looks at BEFORE the Submit-for-review click.
 *
 * Every check here exists because it was found broken in a real audit:
 *
 *   - Legal URLs are the first thing a reviewer opens. Ours were serving
 *     visible "[DRAFT — requires attorney review]" markers and a privacy
 *     policy naming its email sub-processor as "TBD".
 *   - The listing promises "runs automatically on every push" and "a commit
 *     status and PR comment". With CRON_SECRET unset, /api/webhook enqueues
 *     the scan and NOTHING drains the queue — the reviewer installs, pushes,
 *     and sees nothing at all. That is the most certain way to fail review.
 *   - PR comments post via the Issues comments API, which needs issues:write.
 *     The live app was granted contents/metadata/pull_requests/statuses only.
 *   - The module count in the listing is static, manually-pasted copy, and
 *     this repo has a documented history of that number going stale.
 *
 * Usage:  node scripts/marketplace-preflight.js [--base https://gatetest.io]
 * Exit 0 = safe to submit. Exit 1 = at least one BLOCKER.
 *
 * `gh`-dependent checks degrade to SKIP (not failure) when gh is unavailable
 * or unauthenticated, so the script still runs in a bare environment.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1].replace(/\/$/, '') : 'https://gatetest.io';
})();

const APP_SLUG = 'gatetesthq';
const ORG = 'crclabs-hq';
// Permissions the shipped webhook code actually calls:
//   statuses:write     → commit status (Statuses API)
//   issues:write       → PR comment (Issues comments API — NOT pull_requests)
//   pull_requests:write→ auto-fix PR
//   contents:write     → auto-fix branch
const REQUIRED_APP_PERMS = ['statuses', 'issues', 'pull_requests', 'contents'];

// Strings that must never appear in customer-facing legal copy.
const LEGAL_URLS = ['/legal/privacy', '/legal/terms', '/legal/refunds', '/legal/acceptable-use'];
const FORBIDDEN_LEGAL = [/\bDRAFT\b/i, /requires attorney review/i, /\bTBD\b/, /to be confirmed at launch/i];

// Env vars whose absence breaks a function the listing explicitly promises.
const REQUIRED_ENV = {
  CRON_SECRET: 'the scan queue is never drained — no commit status is EVER posted (listing claims scans run on every push)',
  RESEND_API_KEY: 'transactional email cannot send — MCP-tier key delivery and the billing portal silently fail',
};

const results = [];
function record(level, name, detail) {
  results.push({ level, name, detail });
  const tag = level === 'BLOCKER' ? '\x1b[31mBLOCK\x1b[0m'
    : level === 'WARN' ? '\x1b[33m WARN\x1b[0m'
      : level === 'SKIP' ? '\x1b[90m SKIP\x1b[0m' : '\x1b[32m   OK\x1b[0m';
  console.log(`  ${tag}  ${name}${detail ? `\n         ${detail}` : ''}`);
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'gatetest-marketplace-preflight' } });
  return { status: res.status, body: await res.text() };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---------------------------------------------------------------------------

async function checkLegal() {
  console.log('\nLegal pages (a reviewer opens these first)');
  for (const p of LEGAL_URLS) {
    const url = `${BASE}${p}`;
    let r;
    try {
      r = await get(url);
    } catch (err) {
      record('BLOCKER', `${p} unreachable`, String(err && err.message));
      continue;
    }
    if (r.status !== 200) {
      record('BLOCKER', `${p} returned HTTP ${r.status}`, 'Marketplace requires a reachable privacy policy + terms URL.');
      continue;
    }
    // Strip tags so we only match text a human actually sees.
    const visible = r.body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
    const hits = FORBIDDEN_LEGAL.filter((re) => re.test(visible)).map((re) => String(re));
    if (hits.length) {
      record('BLOCKER', `${p} shows unfinished-legal markers`, `matched ${hits.join(', ')} — a reviewer reading "should not be treated as final legal terms" is the single most likely rejection trigger`);
    } else {
      record('OK', `${p} clean`);
    }
  }
}

async function checkEnv() {
  console.log('\nProduction environment (drives the functionality the listing promises)');
  let r;
  try {
    r = await get(`${BASE}/api/status`);
  } catch (err) {
    record('BLOCKER', '/api/status unreachable', String(err && err.message));
    return;
  }
  if (r.status !== 200) {
    record('BLOCKER', `/api/status returned HTTP ${r.status}`);
    return;
  }
  // Parse the real shape rather than regexing the body. /api/status returns
  // { missing_required: [...], missing_important: [{name, why}], ... } where
  // entries are objects, not bare strings. An earlier regex-based version of
  // this check silently reported "present" for vars that were in fact missing
  // — a false NEGATIVE in the one tool whose job is to prevent a rejection.
  let status;
  try {
    status = JSON.parse(r.body);
  } catch {
    record('BLOCKER', '/api/status did not return JSON', 'cannot verify production env');
    return;
  }
  const nameOf = (e) => (typeof e === 'string' ? e : e && e.name);
  const missing = new Set(
    [...(status.missing_required || []), ...(status.missing_important || [])].map(nameOf).filter(Boolean),
  );
  for (const [key, why] of Object.entries(REQUIRED_ENV)) {
    if (missing.has(key)) record('BLOCKER', `${key} is not set in production`, why);
    else record('OK', `${key} present`);
  }
  if ((status.missing_required || []).length) {
    record('BLOCKER', `${status.missing_required.length} REQUIRED env var(s) unset`, status.missing_required.map(nameOf).join(', '));
  }
}

async function checkInstallUrl() {
  console.log('\nInstall + setup flow');
  for (const p of ['/github/setup', '/']) {
    try {
      const r = await get(`${BASE}${p}`);
      if (r.status === 200) record('OK', `${p} reachable`);
      else record('BLOCKER', `${p} returned HTTP ${r.status}`, 'Marketplace installation URL must resolve.');
    } catch (err) {
      record('BLOCKER', `${p} unreachable`, String(err && err.message));
    }
  }
}

function checkListingAccuracy() {
  console.log('\nListing copy vs. shipped engine');
  const listingPath = path.join(ROOT, 'integrations/marketplace/listing.md');
  if (!fs.existsSync(listingPath)) {
    record('BLOCKER', 'listing.md missing', listingPath);
    return;
  }
  const raw = fs.readFileSync(listingPath, 'utf8');
  // ONLY the fenced code blocks are pasted into the Marketplace form. The
  // surrounding prose is editorial history — it deliberately quotes the
  // REJECTED submission's "90 modules" text, and scanning it produced a false
  // positive claiming the live copy was stale. Check the shipped copy only.
  // Normalise CRLF first — on a Windows checkout the fence regex otherwise
  // never matches (`\r\n` vs `\n`) and every copy check silently no-ops.
  // Same bug class as Known Issue #49.
  const listing = [...raw.replace(/\r\n?/g, '\n').matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
    .map((m) => m[1]).join('\n');
  if (!listing.trim()) {
    record('BLOCKER', 'listing.md has no fenced copy blocks to submit', listingPath);
    return;
  }

  // Live module count straight from the engine — never trust the pasted number.
  let live = null;
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/gatetest.js'), '--list'], { encoding: 'utf8' });
    live = out.split('\n').filter((l) => /^ {2}[a-zA-Z]/.test(l)).length;
  } catch (err) {
    record('SKIP', 'module count not verified', String(err && err.message));
  }
  if (live) {
    const counts = [...listing.matchAll(/(\d{2,3})[- ]module/g)].map((m) => Number(m[1]));
    const wrong = [...new Set(counts.filter((c) => c !== live))];
    if (wrong.length) {
      record('BLOCKER', 'listing module count is stale', `listing says ${wrong.join('/')}, engine loads ${live}`);
    } else {
      record('OK', `module count matches engine (${live})`);
    }
  }

  // The 2026-05-14 rejection was caused by describing paid functionality on an
  // app with ~0 installs and no real Marketplace plan. Guard the regression.
  const paidPlanish = /##\s*Pricing model[\s\S]{0,400}?\b(per month|\$\d+\s*\/\s*mo|paid plan)\b/i.test(listing);
  if (paidPlanish) {
    record('BLOCKER', 'listing appears to attach a paid plan', 'this is the exact reason the 2026-05-14 submission was rejected — Free plan only until >=100 installs + verified publisher');
  } else {
    record('OK', 'pricing section is free-only');
  }
}

function checkAppPermissions() {
  console.log('\nGitHub App permissions (vs. what the webhook code calls)');
  let installs;
  try {
    installs = JSON.parse(gh(['api', `orgs/${ORG}/installations`, '--jq', '{installations:[.installations[]|{app_slug,app_id,permissions}]}']));
  } catch (err) {
    record('SKIP', 'app permissions not checked', 'gh unavailable/unauthenticated — verify manually in the App settings');
    return;
  }
  const app = installs.installations.find((a) => a.app_slug === APP_SLUG);
  if (!app) {
    record('BLOCKER', `${APP_SLUG} is not installed on ${ORG}`);
    return;
  }
  for (const perm of REQUIRED_APP_PERMS) {
    if (app.permissions[perm] === 'write') {
      record('OK', `${perm}:write granted`);
    } else {
      const why = perm === 'issues'
        ? 'PR comments post via POST /repos/:o/:r/issues/:n/comments — without issues:write the PR comment the listing promises silently fails'
        : `webhook code requires ${perm}:write`;
      record('BLOCKER', `${APP_SLUG} missing ${perm}:write`, why);
    }
  }
  // An orphaned duplicate app confuses reviewers and can receive stray events.
  const dupes = installs.installations.filter((a) => /^gatetest/i.test(a.app_slug) && a.app_slug !== APP_SLUG);
  for (const d of dupes) {
    record('WARN', `duplicate app installed: ${d.app_slug} (app_id ${d.app_id})`, 'looks orphaned — delete before submitting so the reviewer sees one app');
  }
}

function checkCronArmed() {
  console.log('\nQueue drain (the listing claims scans run on every push)');
  try {
    const out = gh(['run', 'list', '--workflow=cron-ticks.yml', '--limit', '1', '--json', 'conclusion,databaseId']);
    const runs = JSON.parse(out);
    if (!runs.length) {
      record('WARN', 'cron-ticks has never run');
      return;
    }
    const log = gh(['run', 'view', String(runs[0].databaseId), '--log']);
    if (/disarmed|CRON_SECRET repo secret is NOT SET/i.test(log)) {
      record('BLOCKER', 'cron stopgap is disarmed', 'CRON_SECRET repo secret unset — queued push-scans are never executed, so the reviewer will install, push, and see nothing happen');
    } else if (/401/.test(log)) {
      record('BLOCKER', 'cron tick returned 401', 'the repo CRON_SECRET does not match the one on the production host');
    } else {
      record('OK', 'cron stopgap armed and ticking');
    }
  } catch (err) {
    record('SKIP', 'cron status not checked', 'gh unavailable — confirm the queue drains before submitting');
  }
}

// ---------------------------------------------------------------------------

(async function main() {
  console.log(`GitHub Marketplace preflight — target ${BASE}`);
  await checkLegal();
  await checkEnv();
  await checkInstallUrl();
  checkListingAccuracy();
  checkAppPermissions();
  checkCronArmed();

  const blockers = results.filter((r) => r.level === 'BLOCKER');
  const warns = results.filter((r) => r.level === 'WARN');
  console.log(`\n${'─'.repeat(70)}`);
  if (blockers.length === 0) {
    console.log(`\x1b[32mREADY TO SUBMIT\x1b[0m — 0 blockers, ${warns.length} warning(s).`);
    process.exit(0);
  }
  console.log(`\x1b[31mDO NOT SUBMIT\x1b[0m — ${blockers.length} blocker(s), ${warns.length} warning(s):\n`);
  for (const b of blockers) console.log(`  • ${b.name}\n      ${b.detail || ''}`);
  console.log('\nEach blocker above would be visible to the GitHub reviewer.');
  process.exit(1);
})().catch((err) => {
  console.error('preflight crashed:', err && err.stack);
  process.exit(1);
});
