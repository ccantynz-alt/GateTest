// ============================================================================
// Cron endpoints must accept BOTH GET and POST.
//
// Cron schedulers are heterogeneous:
//   - Vercel's built-in cron issues GET (website/vercel.json declares both)
//   - curl / systemd timers / the GitHub Actions stopgap issue POST
//   - docs/deploy/VAPRON-DEPLOY.md documents POST for both endpoints
//
// /api/watches/tick exported only GET, so every POST scheduler received a
// silent 405 and watches never ran off-Vercel. Verified live against
// gatetest.io on 2026-07-26:
//
//     /api/watches/tick -> HTTP 405
//
// A cron endpoint that 405s the scheduler pointed at it is an invisible
// outage — the scheduler reports "ran", nothing happens, nobody is paged.
// Same failure shape as the cron stopgap that exited 0 while disarmed.
// ============================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Every path listed as a cron in vercel.json is, by definition, an endpoint a
// scheduler hits unattended — so it must tolerate either method.
function cronPaths() {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'website/vercel.json'), 'utf8'));
  return (vercel.crons || []).map((c) => c.path);
}

function routeFileFor(apiPath) {
  const rel = apiPath.replace(/^\//, '');
  for (const ext of ['ts', 'js']) {
    const p = path.join(ROOT, 'website/app', rel, `route.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

describe('cron endpoints accept any scheduler method', () => {
  const paths = cronPaths();

  it('vercel.json declares at least one cron', () => {
    assert.ok(paths.length > 0, 'expected crons in website/vercel.json');
  });

  for (const apiPath of paths) {
    it(`${apiPath} exports both GET and POST`, () => {
      const file = routeFileFor(apiPath);
      assert.ok(file, `no route file found for ${apiPath}`);
      const src = fs.readFileSync(file, 'utf8');

      const hasGet = /export\s+(?:async\s+function|const)\s+GET\b/.test(src);
      const hasPost = /export\s+(?:async\s+function|const)\s+POST\b/.test(src);

      assert.ok(hasGet, `${apiPath} must export GET — Vercel cron issues GET`);
      assert.ok(
        hasPost,
        `${apiPath} must export POST — curl/systemd/GitHub-Actions schedulers and ` +
          'docs/deploy/VAPRON-DEPLOY.md all POST; a GET-only route 405s them silently',
      );
    });

    // Exporting a method is not the same as DOING the work. /api/scan/worker/
    // tick exported GET and returned a self-documenting JSON blob — so a
    // Vercel cron (which issues GET, and which that very blob listed as its
    // first trigger) got a cheerful {"ok":true} on every tick while the queue
    // drained nothing. This test passed throughout, because it only checked
    // the export. A 200 is the one status nobody investigates.
    // Found 2026-07-28 by the readiness probe.
    it(`${apiPath} GET actually does the work, and is auth-gated`, () => {
      const file = routeFileFor(apiPath);
      const src = fs.readFileSync(file, 'utf8');
      const getBody = (src.match(/export\s+async\s+function\s+GET\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';

      assert.ok(getBody.trim(), `${apiPath}: could not read the GET body`);

      const delegatesToPost = /\breturn\s+POST\s*\(/.test(getBody);
      const doesWorkInline = /authoriz|authoris|getDb\s*\(|sql`/i.test(getBody);
      assert.ok(
        delegatesToPost || doesWorkInline,
        `${apiPath}: GET neither delegates to POST nor does the work itself — it looks like a `
          + 'documentation stub. A GET-based scheduler will report success and drain nothing.',
      );

      // A doc stub is recognisable: it answers 200 with a description and
      // never mentions authorisation.
      const looksLikeDocStub = /endpoint:\s*['"]/.test(getBody) && !delegatesToPost && !doesWorkInline;
      assert.ok(!looksLikeDocStub, `${apiPath}: GET returns a description instead of running the tick`);
    });
  }
});
