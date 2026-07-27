/**
 * Readiness probe — proves the CUSTOMER JOURNEY works against a live
 * deployment, rather than proving the code compiles.
 *
 * It exists because on 2026-07-27/28 the suite was green — 6,700+ tests,
 * clean build, self-scan PASSED — while production was 102 commits stale,
 * `/billing` 404'd, `POST /api/watches/tick` 405'd, and paid MCP customers
 * got no key. None of that is visible to a test. All of it is obvious to
 * something that asks the live site a question.
 *
 * These tests use an injected fetch, so the probe's LOGIC is verified
 * without a network — including the failure paths, which are the ones that
 * matter and the ones a live run rarely exercises.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { runReadinessProbe, DEFAULT_SURFACES } = require('../src/core/readiness-probe');

/** Build a fetch stub from a map of path -> {status, body}. */
function stubFetch(routes, opts = {}) {
  return async (url, init = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const key = `${init.method || 'GET'} ${path}`;
    const hit = routes[key] ?? routes[path];
    if (hit === undefined) {
      if (opts.throwOnMiss) throw new Error(`unstubbed ${key}`);
      return { status: 200, text: async () => opts.defaultBody ?? '<html>id="pricing"</html>' };
    }
    if (hit.throws) throw new Error(hit.throws);
    return { status: hit.status, text: async () => hit.body ?? '' };
  };
}

const HEALTHY = {
  '/api/platform-status': { status: 200, body: JSON.stringify({ commit: 'abc123def4567', version: '1.60.0' }) },
  '/api/status': { status: 200, body: JSON.stringify({ missing_required: [], missing_important: [] }) },
  '/': { status: 200, body: '<html><section id="pricing"></section></html>' },
  '/billing': { status: 200, body: 'ok' },
  '/checkout': { status: 200, body: 'ok' },
  '/mcp': { status: 200, body: 'ok' },
  'GET /api/watches/tick': { status: 401, body: '' },
  'POST /api/watches/tick': { status: 401, body: '' },
  'GET /api/scan/worker/tick': { status: 401, body: '' },
  'POST /api/scan/worker/tick': { status: 401, body: '' },
};

const run = (routes, extra = {}) =>
  runReadinessProbe({ baseUrl: 'https://example.test', fetchFn: stubFetch(routes), ...extra });

const stepNamed = (report, name) => report.steps.find((s) => s.name === name);

describe('readiness probe — a healthy deployment', () => {
  it('reports ready with no failures', async () => {
    const report = await run(HEALTHY);
    assert.strictEqual(report.ready, true, JSON.stringify(report.failures, null, 2));
    assert.strictEqual(report.summary.failed, 0);
    assert.ok(report.summary.total >= 10, 'the probe must actually check things');
  });

  it('accepts a matching expected commit', async () => {
    const report = await run(HEALTHY, { expectedCommit: 'abc123def4567' });
    assert.strictEqual(report.ready, true);
  });
});

describe('readiness probe — the stale deploy it was built for', () => {
  it('fails when the live commit differs from the expected one', async () => {
    const report = await run(HEALTHY, { expectedCommit: '770654bbcae6' });
    assert.strictEqual(report.ready, false);
    const step = stepNamed(report, 'deploy/fresh');
    assert.strictEqual(step.ok, false);
    assert.match(step.fix, /deploy did not take/i);
    assert.match(step.fix, /OLD build/,
      'the operator must be told the rest of the report describes the wrong build');
  });

  it('fails when the build is not commit-stamped at all', async () => {
    const report = await run({ ...HEALTHY, '/api/platform-status': { status: 200, body: JSON.stringify({ commit: 'unknown' }) } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'deploy/stamped').fix, /npm run build|GIT_COMMIT/);
  });

  it('fails when a customer surface 404s', async () => {
    const report = await run({ ...HEALTHY, '/billing': { status: 404, body: '' } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'surface/billing').fix, /stale deploy/i);
  });
});

describe('readiness probe — silent-degradation checks', () => {
  it('treats a missing IMPORTANT env var as critical, not cosmetic', async () => {
    // These do not break the site — they break a feature someone paid for,
    // while money keeps changing hands. That is worse than an outage.
    const report = await run({
      ...HEALTHY,
      '/api/status': { status: 200, body: JSON.stringify({ missing_required: [], missing_important: [{ name: 'RESEND_API_KEY' }] }) },
    });
    assert.strictEqual(report.ready, false);
    const step = stepNamed(report, 'config/important');
    assert.strictEqual(step.severity, 'critical');
    assert.match(step.detail, /RESEND_API_KEY/);
  });

  it('fails a cron endpoint that 405s the scheduler', async () => {
    const report = await run({ ...HEALTHY, 'POST /api/watches/tick': { status: 405, body: '' } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'cron/api/watches/tick[POST]').fix, /silently fails while reporting success/);
  });

  it('fails a cron endpoint answering 200 unauthenticated — and names BOTH causes', async () => {
    // The probe cannot tell "publicly triggerable" from "documentation stub"
    // from outside. Its first draft asserted the scarier one and was wrong
    // about /api/scan/worker/tick, which was a doc stub. Say both.
    const report = await run({ ...HEALTHY, 'GET /api/scan/worker/tick': { status: 200, body: '{"ok":true}' } });
    assert.strictEqual(report.ready, false);
    const fix = stepNamed(report, 'cron/api/scan/worker/tick[GET]').fix;
    assert.match(fix, /publicly triggerable/);
    assert.match(fix, /documentation stub/);
  });
});

describe('readiness probe — content checks, not just status codes', () => {
  it('fails a 200 page whose content has been gutted', async () => {
    // Pricing is a SECTION on the home page, not a route. A 200 alone would
    // not notice the anchor disappearing.
    const report = await run({ ...HEALTHY, '/': { status: 200, body: '<html>nothing here</html>' } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'surface/').detail, /missing id="pricing"/);
  });

  it('does not probe /pricing — it is an anchor, never a route', async () => {
    // The probe's own first run flagged /pricing as a stale-deploy 404. It
    // was a bug in the PROBE: website/app/pricing/ has never existed. A
    // monitor that cries wolf gets muted.
    assert.ok(!DEFAULT_SURFACES.some((s) => s.path === '/pricing'));
  });
});

describe('readiness probe — robustness', () => {
  it('a network failure is a reported step, never a crash', async () => {
    const report = await run({ ...HEALTHY, '/api/platform-status': { throws: 'ECONNREFUSED' } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'deploy/reachable').detail, /ECONNREFUSED/);
  });

  it('non-JSON from a JSON endpoint is reported, not parsed blindly', async () => {
    const report = await run({ ...HEALTHY, '/api/platform-status': { status: 200, body: '<html>proxy error</html>' } });
    assert.strictEqual(report.ready, false);
    assert.match(stepNamed(report, 'deploy/reachable').detail, /non-JSON/);
  });

  it('requires a baseUrl', async () => {
    await assert.rejects(() => runReadinessProbe({ fetchFn: stubFetch({}) }), /baseUrl is required/);
  });

  it('every failed step carries a fix, not just a red mark', async () => {
    const report = await run({
      ...HEALTHY,
      '/billing': { status: 404, body: '' },
      'POST /api/watches/tick': { status: 405, body: '' },
    });
    for (const f of report.failures) {
      assert.ok(f.fix && f.fix.length > 20, `${f.name} failed without telling the operator what to do`);
    }
  });
});
