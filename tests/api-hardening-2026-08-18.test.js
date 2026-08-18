'use strict';

// API HARDENING — 2026-08-18 engineering audit. Each fix below is pinned by
// a contract so it cannot quietly regress. Behavioural where the code is
// plain JS (ssrf-guard); source-text where the code is a Next.js route.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const { isPrivateOrReservedIp } = require('../src/core/ssrf-guard');

describe('ssrf-guard — reserved ranges the box must never probe', () => {
  it('blocks CGNAT / Tailscale (100.64/10), benchmark (198.18/15), multicast (224/4), reserved (240/4)', () => {
    for (const ip of ['100.64.0.1', '100.99.126.88', '100.127.255.254', '198.18.0.1', '198.19.255.1', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255']) {
      assert.equal(isPrivateOrReservedIp(ip), true, ip);
    }
  });
  it('still allows ordinary public addresses (100.63.x and 100.128.x are public)', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '198.17.0.1', '198.20.0.1', '223.255.255.255']) {
      assert.equal(isPrivateOrReservedIp(ip), false, ip);
    }
  });
});

describe('URL-scanning routes resolve + validate the target before any socket opens', () => {
  for (const rel of ['website/app/api/scan/url/route.ts', 'website/app/api/scan/nuclear/route.ts', 'website/app/api/scan/server/route.ts']) {
    it(`${rel} uses resolveAndValidateUrl and a rate limiter`, () => {
      const src = read(rel);
      assert.match(src, /resolveAndValidateUrl\(/, 'SSRF guard missing');
      assert.match(src, /createLimiter\(PRESETS\.webScan\)|_mkLimiter\(_RL_PRESETS\.webScan\)/, 'rate limiter missing');
      // the guard must run BEFORE the network work
      const handler = src.slice(src.indexOf('export async function POST'));
      const guardIdx = handler.search(/const validated = await resolveAndValidateUrl/);
      const netIdx = handler.search(/await scanWebsite\(|checkSSL\(parsed|inspectSSL\(|await resolve4\(hostname\)/);
      assert.ok(guardIdx > 0 && netIdx > guardIdx, `guard (${guardIdx}) must precede network use (${netIdx}) inside POST`);
    });
  }
  it('nuclear/server restrict explicit ports to web ports', () => {
    for (const rel of ['website/app/api/scan/nuclear/route.ts', 'website/app/api/scan/server/route.ts']) {
      assert.match(read(rel), /\[80, 443, 8080, 8443\]\.includes\(explicitPort\)/, rel);
    }
  });
});

describe('fail-closed auth', () => {
  it('Slack slash endpoint returns 503 when SLACK_SIGNING_SECRET is unset (never accepts unsigned commands)', () => {
    const src = read('website/app/api/slack/events/route.ts');
    assert.match(src, /if \(!SIGNING_SECRET\) \{[\s\S]*?status: 503/);
    assert.doesNotMatch(src, /if \(SIGNING_SECRET && !verifySlashSignature/, 'the fail-open form must not return');
  });
  it('admin learning cron does not honour a client-settable x-vercel-cron header and compares the secret in constant time', () => {
    const src = read('website/app/api/admin/learning/cron/route.ts');
    assert.doesNotMatch(src, /headers.get("x-vercel-cron")/);
    assert.match(src, /timingSafeEqual\(presented, expected\)/);
  });
  it('recipe writes require the shared store token, fail closed when unset, and ignore client confidence deltas', () => {
    const src = read('website/app/api/recipes/route.ts');
    assert.match(src, /GATETEST_RECIPE_STORE_TOKEN/);
    assert.match(src, /reason: "recipe-writes-not-configured" \}, \{ status: 503 \}/);
    assert.match(src, /timingSafeEqual\(a, b\)/);
    assert.match(src, /const confidenceDelta = 0;/);
    assert.doesNotMatch(src, /typeof body\.confidenceDelta === "number" \? body\.confidenceDelta/);
  });
  it('server-fix Forensic branch requires the admin session; guidance and server-fix are rate limited', () => {
    const sf = read('website/app/api/scan/server-fix/route.ts');
    assert.match(sf, /const forensicAllowed = body\.tier === "nuclear" && isAdminRequest\(req\)/);
    assert.match(sf, /if \(forensicAllowed && ANTHROPIC_API_KEY\)/);
    assert.match(sf, /_serverFixLimiter\.guard\(req\)/);
    const g = read('website/app/api/scan/guidance/route.ts');
    assert.match(g, /_guidanceLimiter\.guard\(req\)/);
  });
  it('chat rate limiter is module-scoped (a per-request limiter never accumulates)', () => {
    const src = read('website/app/api/chat/route.ts');
    assert.match(src, /^const _chatLimiter = _createChatLimiter\(/m);
    assert.doesNotMatch(src, /const limiter = createLimiter\(PRESETS\.chat/);
  });
  it('GitHub webhook route returns the handler status (401/503/429/400 visible in the delivery log)', () => {
    const src = read('website/app/api/webhook/route.ts');
    assert.match(src, /result = await githubEvents\.processGitHubEvent\(/);
    assert.match(src, /NextResponse\.json\(result\.body \?\? \{ status: "processing" \}, \{ status: result\.status \}\)/);
  });
});
