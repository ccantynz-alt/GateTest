/**
 * Wire contract reference: Gluecron.com/GATETEST_HOOK.md — each repo keeps its
 * own copy per the HTTP-only coupling rule.
 *
 * Gluecron scan-result callback helper.
 *
 * When GateTest is invoked by Gluecron (the inbound request body carries
 * `source === "gluecron"`), we POST the scan result to Gluecron's async
 * receiver at `POST /api/hooks/gatetest`. The sync response to the caller
 * still happens; this callback fires on the side, and its failure MUST NOT
 * break the sync response.
 *
 * Env vars (two spellings each — see resolveCallbackTarget for why):
 *   GLUECRON_CALLBACK_URL     — e.g. https://gluecron.vapron.ai/api/hooks/gatetest
 *     or GLUECRON_URL         — the host's origin; /api/hooks/gatetest is appended
 *   GLUECRON_CALLBACK_SECRET  — bearer token Gluecron expects
 *     or GATETEST_CALLBACK_SECRET
 *   GATETEST_HMAC_SECRET      — alternative to the bearer: X-GateTest-Signature
 *                               sha256=<hmac(rawBody)> (GATETEST_HOOK.md)
 *
 * ONE implementation. Until 2026-09-02 a sibling gluecron-callback.ts also
 * existed, and `import ... from "@/app/lib/gluecron-callback"` resolved to
 * IT — so the worker and /api/scan/run shipped the .ts, whose status was
 * `scanResult.error ? failed : status === "complete" ? passed : failed`. A
 * completed scan with ten blocking findings posted "passed". Every test,
 * and the 2026-09-02 verdict fix, exercised this .js, which the bundle did
 * not contain. The .ts also read GLUECRON_URL / GATETEST_CALLBACK_SECRET
 * while /api/scan/run gated the call on GLUECRON_CALLBACK_URL /
 * GLUECRON_CALLBACK_SECRET, so whichever pair an operator set, one half
 * stayed silent. tests/lib-basename-collision.test.js now fails the suite
 * if two lib files share a basename.
 *
 * Payload shape matches Gluecron's receiver verbatim:
 *   {
 *     repository: "owner/name",
 *     sha: "<40-hex>",
 *     ref: "refs/heads/main",
 *     status: "passed" | "failed" | "error",
 *     summary: "<string>",
 *     details: { ...the scan result object... },
 *     durationMs: <number>
 *   }
 */

const { computeGateVerdict } = require("./gate-verdict");

/**
 * Build the payload Gluecron expects from a raw scan result.
 *
 * @param {object} opts
 * @param {string} opts.repository     "owner/name"
 * @param {string} opts.sha            full 40-char commit sha
 * @param {string} [opts.ref]          defaults to "refs/heads/main"
 * @param {object} opts.scanResult     the scan result object (passed as details)
 * @returns {{repository:string, sha:string, ref:string, status:"passed"|"failed"|"error", summary:string, details:object, durationMs:number}}
 */
function buildGluecronPayload({ repository, sha, ref, scanResult }) {
  const result = scanResult || {};
  const totalIssues = typeof result.totalIssues === "number" ? result.totalIssues : 0;
  const durationMs = typeof result.duration === "number" ? result.duration : 0;
  const moduleCount = Array.isArray(result.modules) ? result.modules.length : 0;

  // The verdict is the same one the GitHub callback posts — see
  // gate-verdict.js. Gluecron's receiver has no advisory concept (its
  // gate_runs row IS the gate), so it always gets the enforcing verdict:
  // blocking findings in this change fail; warnings and low-confidence
  // errors are reported in `details`, never fail. Before 2026-09-02 this
  // failed on `totalIssues > 0`, so a single warning failed the push.
  const verdict = computeGateVerdict(result, "strict");
  const issuesWord = `${totalIssues} issue${totalIssues === 1 ? "" : "s"} across ${moduleCount} module${moduleCount === 1 ? "" : "s"}`;
  /** @type {"passed"|"failed"|"error"} */
  let status;
  let summary;
  if (verdict.state === "error") {
    status = "error";
    summary = String(result.error || verdict.reason).slice(0, 500);
  } else if (verdict.state === "failure") {
    status = "failed";
    summary = `${verdict.reason} — ${issuesWord}`;
  } else if (totalIssues > 0) {
    status = "passed";
    summary = `${issuesWord}, none blocking${verdict.attributed ? " in this change" : ""} (${verdict.reason})`;
  } else {
    status = "passed";
    summary = `${moduleCount} module${moduleCount === 1 ? "" : "s"} passed, 0 issues`;
  }

  return {
    repository,
    sha,
    ref: ref || "refs/heads/main",
    status,
    summary,
    details: result,
    durationMs,
  };
}

/**
 * Fire-and-forget POST to Gluecron's scan-result hook.
 * Never throws. Logs errors and returns an object describing the outcome —
 * callers should NOT rely on its return value for control flow; callback
 * failure must not break the sync response.
 *
 * @param {object} opts
 * @param {string} opts.repository
 * @param {string} opts.sha
 * @param {string} [opts.ref]
 * @param {object} opts.scanResult
 * @param {typeof fetch} [opts.fetchImpl]  override for testing
 * @param {{ GLUECRON_CALLBACK_URL?: string, GLUECRON_CALLBACK_SECRET?: string }} [opts.env]
 * @returns {Promise<{ sent: boolean, reason?: string, status?: number }>}
 */
async function sendGluecronCallback(opts) {
  const env = opts.env || process.env;
  const target = resolveCallbackTarget(env);
  if (!target) {
    return { sent: false, reason: "missing-config" };
  }

  let payload;
  try {
    payload = buildGluecronPayload(opts);
  } catch (err) {
    console.error("[gluecron-callback] payload build failed:", err);
    return { sent: false, reason: "payload-error" };
  }

  return postGluecronPayload(payload, { target, fetchImpl: opts.fetchImpl });
}

/**
 * Where and how to POST. Accepts both env spellings so the operator cannot
 * set a pair that half the code ignores. Bearer wins over HMAC when both
 * are set. Returns null when there is no URL or no credential.
 *
 * @returns {{ url: string, bearer: string|null, hmacKey: string|null }|null}
 */
function resolveCallbackTarget(env) {
  let url = (env.GLUECRON_CALLBACK_URL || "").trim();
  if (!url && env.GLUECRON_URL) {
    try {
      url = new URL("/api/hooks/gatetest", env.GLUECRON_URL.trim()).toString();
    } catch {
      url = "";
    }
  }
  const bearer = (env.GLUECRON_CALLBACK_SECRET || env.GATETEST_CALLBACK_SECRET || "").trim() || null;
  const hmacKey = (env.GATETEST_HMAC_SECRET || "").trim() || null;
  if (!url || (!bearer && !hmacKey)) return null;
  return { url, bearer, hmacKey };
}

/**
 * POST an already-built payload. Never throws.
 * @param {object} payload
 * @param {{ target?: object, env?: object, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ sent: boolean, reason?: string, status?: number }>}
 */
async function postGluecronPayload(payload, opts = {}) {
  const target = opts.target || resolveCallbackTarget(opts.env || process.env);
  if (!target) return { sent: false, reason: "missing-config" };

  const body = JSON.stringify(payload);
  const doFetch = opts.fetchImpl || fetch;
  const headers = { "Content-Type": "application/json" };
  if (target.bearer) {
    headers.Authorization = `Bearer ${target.bearer}`;
  } else {
    const sig = require("crypto").createHmac("sha256", target.hmacKey).update(body).digest("hex");
    headers["X-GateTest-Signature"] = `sha256=${sig}`;
  }

  try {
    const res = await doFetch(target.url, {
      method: "POST",
      // Per-fetch timeout (advancement #11): a hung callback must not hold
      // the worker tick hostage. Guarded for test fetch doubles.
      signal: (typeof AbortSignal !== "undefined" && AbortSignal.timeout)
        ? AbortSignal.timeout(10_000)
        : undefined,
      headers,
      body,
    });
    if (!res || !res.ok) {
      const status = res && typeof res.status === "number" ? res.status : 0;
      console.error(`[gluecron-callback] non-OK response: ${status}`);
      return { sent: false, reason: "non-ok", status };
    }
    return { sent: true, status: res.status };
  } catch (err) {
    console.error("[gluecron-callback] POST failed:", err && err.message ? err.message : err);
    return { sent: false, reason: "fetch-error" };
  }
}

module.exports = {
  buildGluecronPayload,
  sendGluecronCallback,
  postGluecronPayload,
  resolveCallbackTarget,
};
