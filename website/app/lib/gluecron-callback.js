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
 * Env vars:
 *   GLUECRON_CALLBACK_URL     — e.g. https://gluecron.com/api/hooks/gatetest
 *   GLUECRON_CALLBACK_SECRET  — bearer token Gluecron expects
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

  /** @type {"passed"|"failed"|"error"} */
  let status;
  let summary;
  if (result.error) {
    status = "error";
    summary = String(result.error).slice(0, 500);
  } else if (totalIssues > 0) {
    status = "failed";
    summary = `${totalIssues} issue${totalIssues === 1 ? "" : "s"} across ${moduleCount} module${moduleCount === 1 ? "" : "s"}`;
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
  const url = env.GLUECRON_CALLBACK_URL;
  const secret = env.GLUECRON_CALLBACK_SECRET;

  if (!url || !secret) {
    return { sent: false, reason: "missing-config" };
  }

  let payload;
  try {
    payload = buildGluecronPayload(opts);
  } catch (err) {
    console.error("[gluecron-callback] payload build failed:", err);
    return { sent: false, reason: "payload-error" };
  }

  const body = JSON.stringify(payload);
  const doFetch = opts.fetchImpl || fetch;

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
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
};
