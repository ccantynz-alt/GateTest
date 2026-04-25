/**
 * GlueCron callback — posts GateTest scan results into GlueCron.
 *
 * Matches the spec in gluecron/GATETEST_HOOK.md:
 *
 *   POST  <GLUECRON_URL>/api/hooks/gatetest
 *   Auth:
 *     - Bearer  $GATETEST_CALLBACK_SECRET   (preferred)
 *     - OR  X-GateTest-Signature: sha256=<hex(hmac-sha256(GATETEST_HMAC_SECRET, rawBody))>
 *
 * The callback is fire-and-forget from the caller's perspective: if GlueCron
 * is down, misconfigured, or the env vars are unset, we log and continue.
 * We NEVER block the user-facing flow on GlueCron availability.
 */
import https from "https";
import http from "http";
import crypto from "crypto";

export type GluecronStatus = "passed" | "failed" | "error" | "success";

export interface GluecronPayload {
  repository: string; // "owner/name"
  sha: string; // full 40-char SHA
  status: GluecronStatus;
  ref?: string;
  pullRequestNumber?: number;
  summary?: string;
  details?: unknown;
  durationMs?: number;
}

export interface GluecronResponse {
  ok: boolean;
  gateRunId?: string;
  status?: number;
  error?: string;
  skipped?: string;
}

const HTTP_TIMEOUT_MS = 8000;

function gluecronUrl(): URL | null {
  const raw = (process.env.GLUECRON_URL || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function postJson(target: URL, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "GateTest-Callback/1.2.0",
          "Content-Length": Buffer.byteLength(body).toString(),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") })
        );
      }
    );
    req.on("error", reject);
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("GlueCron callback timed out"));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Send a scan result to GlueCron. Returns a response envelope — never throws.
 * Caller should log the result but not let its failure block other work.
 */
export async function postGluecronResult(
  payload: GluecronPayload
): Promise<GluecronResponse> {
  const base = gluecronUrl();
  if (!base) {
    return { ok: false, skipped: "GLUECRON_URL not configured" };
  }

  const bearer = (process.env.GATETEST_CALLBACK_SECRET || "").trim();
  const hmacKey = (process.env.GATETEST_HMAC_SECRET || "").trim();

  if (!bearer && !hmacKey) {
    return { ok: false, skipped: "no GATETEST_CALLBACK_SECRET or GATETEST_HMAC_SECRET set" };
  }

  // Construct the target URL: honour a trailing path on GLUECRON_URL if present
  // so users can point at staging or a sub-path.
  const target = new URL("/api/hooks/gatetest", base);

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {};

  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  } else if (hmacKey) {
    const sig = crypto.createHmac("sha256", hmacKey).update(body).digest("hex");
    headers["X-GateTest-Signature"] = `sha256=${sig}`;
  }

  try {
    const res = await postJson(target, body, headers);
    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        status: res.status,
        error: `GlueCron returned ${res.status}: ${res.body.slice(0, 200)}`,
      };
    }
    let parsed: { ok?: boolean; gateRunId?: string } = {};
    try {
      parsed = JSON.parse(res.body);
    } catch {
      // non-JSON success body is still "ok" from HTTP's perspective.
    }
    return {
      ok: true,
      status: res.status,
      gateRunId: parsed.gateRunId,
    };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message || "unknown network error",
    };
  }
}

/**
 * Adapter used by scan/run and scan/worker/tick. Converts a raw GateTest
 * summary object into a GluecronPayload and posts it. Never throws.
 */
export async function sendGluecronCallback(args: {
  repository: string;
  sha: string;
  ref?: string;
  scanResult: { gateStatus?: string; duration?: number; [key: string]: unknown };
}): Promise<GluecronResponse> {
  const { repository, sha, ref, scanResult } = args;
  const rawStatus = (scanResult?.gateStatus ?? "").toLowerCase();
  const status: GluecronStatus =
    rawStatus === "passed" ? "passed"
    : rawStatus === "blocked" ? "failed"
    : "error";

  return postGluecronResult({
    repository,
    sha,
    ref,
    status,
    durationMs: typeof scanResult?.duration === "number" ? scanResult.duration : undefined,
    details: scanResult,
  });
}

/**
 * Liveness probe against GlueCron's unauthenticated /api/hooks/ping. Useful
 * for the admin health check before we rely on the callback.
 */
export async function pingGluecron(): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const base = gluecronUrl();
  if (!base) return { ok: false, skipped: "GLUECRON_URL not configured" };
  const target = new URL("/api/hooks/ping", base);
  return new Promise((resolve) => {
    const isHttps = target.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname,
        method: "GET",
        headers: { "User-Agent": "GateTest-Callback/1.2.0" },
      },
      (res) => {
        res.resume();
        resolve({ ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300 });
      }
    );
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.end();
  });
}
