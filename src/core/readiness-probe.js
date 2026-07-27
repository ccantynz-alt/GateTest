'use strict';

/**
 * Production readiness probe — proves the CUSTOMER JOURNEY works against a
 * live deployment, rather than proving the code compiles.
 *
 * WHY THIS EXISTS. On 2026-07-27/28 the test suite was green — 6,700+ tests
 * passing, website build clean, self-scan gate PASSED — while all of the
 * following were true in production:
 *
 *   * the deployment was 102 commits and one minor version stale
 *   * `/billing`, the self-serve Stripe portal, returned 404
 *   * `POST /api/watches/tick` returned 405, so the Continuous tier's
 *     scheduler silently did nothing
 *   * paid MCP customers received no API key, because the env var was
 *     stored under a typo'd name
 *
 * Not one of those is visible to a test suite. Every one is obvious to
 * something that asks the live site a question. "Tests pass" is not a
 * readiness signal; "a stranger can arrive, get value, pay, and get value
 * again, with no human involved" is.
 *
 * DESIGN RULES
 *   1. SIDE-EFFECT FREE. This runs on a schedule against production. It
 *      never completes a payment, never writes customer data, never mutates
 *      anything. Every step is a GET, or a POST that we expect to be
 *      REJECTED (auth probes).
 *   2. NO SECRETS REQUIRED. Every check is unauthenticated, so it can run
 *      from CI or a laptop without handing credentials to a cron job.
 *   3. A step reports WHY, not just red. A failure that does not tell you
 *      what to do next is barely better than silence.
 *
 * Pure module: no I/O at import, `fetch` injected, so it is testable without
 * a network.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/** Severity of a failed step. `critical` fails the probe. */
const CRITICAL = 'critical';
const WARNING = 'warning';

function ok(name, detail, extra = {}) {
  return { name, ok: true, detail, ...extra };
}
function fail(name, detail, severity, fix, extra = {}) {
  return { name, ok: false, detail, severity, fix, ...extra };
}

/**
 * One HTTP call with a timeout that never throws — a network blip must be a
 * reported step failure, not a crashed probe.
 */
async function request(fetchFn, url, { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(url, {
      method,
      headers: { accept: 'application/json,text/html' },
      signal: controller ? controller.signal : undefined,
    });
    let body = '';
    try { body = await res.text(); } catch { /* body is optional */ }
    return { ok: true, status: res.status, body };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? `timeout after ${timeoutMs}ms` : (err && err.message) || 'network error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJson(body) {
  try { return JSON.parse(body); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/**
 * Is the deployed build the one we think it is?
 *
 * This is the single most valuable check here. The stale deploy went
 * unnoticed for 11 days and broke four customer-facing things at once; it is
 * invisible to every test and obvious to this one question.
 */
async function checkDeployFreshness(fetchFn, base, expectedCommit) {
  const r = await request(fetchFn, `${base}/api/platform-status`);
  if (!r.ok) return fail('deploy/reachable', `/api/platform-status unreachable: ${r.error}`, CRITICAL, 'Is the site up? Check the host and DNS.');
  if (r.status !== 200) return fail('deploy/reachable', `/api/platform-status returned HTTP ${r.status}`, CRITICAL, 'The app is not serving. Check the process and the reverse proxy.');

  const data = parseJson(r.body);
  if (!data) return fail('deploy/reachable', '/api/platform-status returned non-JSON', CRITICAL, 'Something other than the app is answering — check the proxy.');

  const commit = String(data.commit || '');
  if (!commit || commit === 'unknown') {
    return fail(
      'deploy/stamped', `commit reports "${commit || 'missing'}"`, CRITICAL,
      'Build with `npm run build` (the prebuild step stamps the git SHA), or set GIT_COMMIT in the build env. Without this you cannot tell a fresh deploy from a stale one.',
      { commit },
    );
  }
  if (expectedCommit && !commit.startsWith(expectedCommit) && !expectedCommit.startsWith(commit)) {
    return fail(
      'deploy/fresh', `live commit ${commit.slice(0, 12)} != expected ${expectedCommit.slice(0, 12)}`, CRITICAL,
      'The deploy did not take. Redeploy before trusting anything else in this report — every check below is measuring the OLD build.',
      { commit, expectedCommit },
    );
  }
  return ok('deploy/fresh', `commit ${commit.slice(0, 12)}${data.version ? ` (v${data.version})` : ''}`, { commit });
}

/** Is the deployment actually configured, by its own account? */
async function checkConfig(fetchFn, base) {
  const r = await request(fetchFn, `${base}/api/status`);
  if (!r.ok || r.status !== 200) {
    return [fail('config/reachable', `/api/status ${r.ok ? `HTTP ${r.status}` : r.error}`, CRITICAL, 'The status endpoint is the deployment self-report. If it is down, treat everything else as unknown.')];
  }
  const data = parseJson(r.body);
  if (!data) return [fail('config/reachable', '/api/status returned non-JSON', CRITICAL, 'Check the proxy.')];

  const steps = [];
  const missingRequired = Array.isArray(data.missing_required) ? data.missing_required : [];
  const missingImportant = Array.isArray(data.missing_important) ? data.missing_important : [];

  steps.push(missingRequired.length === 0
    ? ok('config/required', 'all required env vars set')
    : fail('config/required', `missing: ${missingRequired.map((m) => m.name || m).join(', ')}`, CRITICAL,
      'The site returns 503 until these are set. Set them on the host and restart.'));

  // "Important" means a paid feature silently degrades — which is worse than
  // an outage, because nobody notices while money still changes hands.
  steps.push(missingImportant.length === 0
    ? ok('config/important', 'all important env vars set')
    : fail('config/important', `missing: ${missingImportant.map((m) => m.name || m).join(', ')}`, CRITICAL,
      'These do not break the site, they break a feature a customer has PAID for, silently. Treat as critical.'));

  return steps;
}

/**
 * Surfaces a paying customer needs. A 404 here is exactly the shape the
 * stale deploy took: the code existed, the deployment did not have it.
 */
async function checkCustomerSurfaces(fetchFn, base, surfaces) {
  const steps = [];
  for (const s of surfaces) {
    const r = await request(fetchFn, `${base}${s.path}`);
    if (!r.ok) {
      steps.push(fail(`surface${s.path}`, r.error, s.severity || CRITICAL, `${s.why} — the page is unreachable.`));
      continue;
    }
    if (r.status === 404) {
      steps.push(fail(`surface${s.path}`, 'HTTP 404', s.severity || CRITICAL,
        `${s.why} This is what a stale deploy looks like: the route exists in the repo but not in the running build.`));
      continue;
    }
    if (r.status >= 400) {
      steps.push(fail(`surface${s.path}`, `HTTP ${r.status}`, s.severity || CRITICAL, s.why));
      continue;
    }
    // A 200 is not the same as "the page still does its job" — a route can
    // survive a refactor with its content gutted.
    if (s.content && !String(r.body || '').includes(s.content)) {
      steps.push(fail(`surface${s.path}`, `HTTP 200 but missing ${s.content}`, s.severity || CRITICAL, s.contentWhy || s.why));
      continue;
    }
    steps.push(ok(`surface${s.path}`, `HTTP ${r.status}${s.content ? ` (contains ${s.content})` : ''}`));
  }
  return steps;
}

/**
 * Scheduler endpoints must accept BOTH methods and must be authenticated.
 *
 * Two distinct past failures, both silent: `/api/watches/tick` was GET-only
 * so every POST scheduler got a 405 while reporting success; and an older
 * build failed OPEN when CRON_SECRET was unset, leaving the worker publicly
 * triggerable. A 401/403 is the PASS here — 405 means the scheduler is
 * broken, 200 means it is unauthenticated.
 */
async function checkSchedulerEndpoints(fetchFn, base, paths) {
  const steps = [];
  for (const p of paths) {
    for (const method of ['GET', 'POST']) {
      const r = await request(fetchFn, `${base}${p}`, { method });
      const name = `cron${p}[${method}]`;
      if (!r.ok) { steps.push(fail(name, r.error, CRITICAL, 'Endpoint unreachable.')); continue; }
      if (r.status === 405) {
        steps.push(fail(name, 'HTTP 405 Method Not Allowed', CRITICAL,
          `Any scheduler using ${method} silently fails while reporting success. Both methods must be accepted.`));
        continue;
      }
      if (r.status === 200) {
        // Two very different causes, and the probe cannot tell them apart
        // from outside — so say both rather than assert the scarier one.
        // The first draft claimed "publicly triggerable"; the actual cause
        // on /api/scan/worker/tick was a GET handler that returned a
        // self-documenting blob and did no work. Both are real problems,
        // but reporting the wrong one sends the reader down the wrong path.
        steps.push(fail(name, 'HTTP 200 without credentials', CRITICAL,
          `Either this endpoint is publicly triggerable (it must require Authorization: Bearer $CRON_SECRET and fail CLOSED when unset), `
          + `or ${method} is a documentation stub that does no work — in which case a ${method}-based scheduler reports success while nothing runs. `
          + 'Check the handler: a 200 here is the one status nobody investigates.'));
        continue;
      }
      steps.push(ok(name, `HTTP ${r.status} (rejected unauthenticated, as it should)`));
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * NOT a guess at what "should" exist — every entry was checked against the
 * repo. The first draft of this list included `/pricing`, which 404s in
 * production and looked like more stale-deploy damage. It is not: pricing is
 * an anchor on the home page (`/#pricing`, rendered by components/Pricing.tsx)
 * and `website/app/pricing/` has never existed. That was a bug in the PROBE.
 *
 * Worth stating plainly, because a monitor that cries wolf gets muted, and a
 * muted monitor is worse than none. Anything added here must be verified to
 * exist at HEAD first — see the `content` check below for surfaces that are
 * sections rather than routes.
 */
const DEFAULT_SURFACES = [
  { path: '/', why: 'The front door.', content: 'id="pricing"', contentWhy: 'Pricing is a section on the home page, not a route. If the anchor is gone, nobody can see what anything costs.' },
  { path: '/billing', why: 'Self-serve subscription management. Without it every cancellation becomes a support email, then a dispute.' },
  { path: '/checkout', why: 'The payment entry point.' },
  { path: '/mcp', why: 'The $29/mo tier landing page.' },
];

const DEFAULT_CRON_PATHS = ['/api/watches/tick', '/api/scan/worker/tick'];

/**
 * Run the probe.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} [opts.expectedCommit] — usually `git rev-parse HEAD` of main
 * @param {Function} [opts.fetchFn]
 * @param {Array}  [opts.surfaces]
 * @param {Array}  [opts.cronPaths]
 * @returns {Promise<{ready: boolean, steps: Array, failures: Array, summary: object}>}
 */
async function runReadinessProbe(opts = {}) {
  const base = String(opts.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('runReadinessProbe: baseUrl is required');
  const fetchFn = opts.fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) throw new Error('runReadinessProbe: no fetch available');

  const steps = [];
  steps.push(await checkDeployFreshness(fetchFn, base, opts.expectedCommit));
  steps.push(...await checkConfig(fetchFn, base));
  steps.push(...await checkCustomerSurfaces(fetchFn, base, opts.surfaces || DEFAULT_SURFACES));
  steps.push(...await checkSchedulerEndpoints(fetchFn, base, opts.cronPaths || DEFAULT_CRON_PATHS));

  const failures = steps.filter((s) => !s.ok);
  const critical = failures.filter((s) => s.severity === CRITICAL);
  return {
    ready: critical.length === 0,
    steps,
    failures,
    summary: {
      total: steps.length,
      passed: steps.length - failures.length,
      failed: failures.length,
      critical: critical.length,
      warnings: failures.length - critical.length,
    },
  };
}

module.exports = {
  runReadinessProbe,
  DEFAULT_SURFACES,
  DEFAULT_CRON_PATHS,
  CRITICAL,
  WARNING,
  // exposed for tests
  _checkDeployFreshness: checkDeployFreshness,
  _checkConfig: checkConfig,
  _checkCustomerSurfaces: checkCustomerSurfaces,
  _checkSchedulerEndpoints: checkSchedulerEndpoints,
};
