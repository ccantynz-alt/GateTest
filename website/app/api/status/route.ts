import { NextResponse } from "next/server";

// =============================================================================
// PUBLIC STATUS ENDPOINT — phase-6 gap 4
// =============================================================================
// Probes the services GateTest actually depends on and returns a structured
// health report. Powers the /status page. No auth — public health is public.
//
// Each probe has its own timeout (3s default) so a single hung dependency
// doesn't make the whole status check time out. Results are normalised to:
//   { name, status: "operational" | "degraded" | "down" | "unknown", note? }
// =============================================================================

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const PROBE_TIMEOUT_MS = 3000;

interface ProbeResult {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latencyMs?: number;
  note?: string;
}

async function probeWithTimeout(
  name: string,
  fn: () => Promise<ProbeResult>,
): Promise<ProbeResult> {
  const start = Date.now();
  const timeout = new Promise<ProbeResult>((resolve) =>
    setTimeout(
      () =>
        resolve({
          name,
          status: "down",
          latencyMs: Date.now() - start,
          note: "timeout",
        }),
      PROBE_TIMEOUT_MS,
    ),
  );
  try {
    return await Promise.race([fn(), timeout]);
  } catch (err) {
    return {
      name,
      status: "down",
      latencyMs: Date.now() - start,
      note: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeAnthropic(): Promise<ProbeResult> {
  return probeWithTimeout("Anthropic API", async () => {
    const start = Date.now();
    // We HEAD the public docs URL — just confirms anthropic.com responds.
    // We deliberately do NOT call /v1/messages here (would burn API credit
    // on every status check). The /v1/messages reachability depends on the
    // customer's key and Anthropic's auth surface, both of which we can't
    // probe anonymously.
    try {
      const res = await fetch("https://status.anthropic.com/api/v2/status.json", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        return { name: "Anthropic API", status: "degraded", latencyMs: Date.now() - start };
      }
      const j = (await res.json()) as { status?: { indicator?: string } };
      const indicator = j.status?.indicator ?? "unknown";
      const mapped: ProbeResult["status"] =
        indicator === "none"
          ? "operational"
          : indicator === "minor" || indicator === "major"
            ? "degraded"
            : indicator === "critical"
              ? "down"
              : "unknown";
      return {
        name: "Anthropic API",
        status: mapped,
        latencyMs: Date.now() - start,
        note: indicator !== "none" ? `Anthropic reports: ${indicator}` : undefined,
      };
    } catch (err) {
      return {
        name: "Anthropic API",
        status: "unknown",
        latencyMs: Date.now() - start,
        note: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

async function probeGitHub(): Promise<ProbeResult> {
  return probeWithTimeout("GitHub API", async () => {
    const start = Date.now();
    const res = await fetch("https://api.github.com/zen", {
      method: "GET",
      cache: "no-store",
      headers: { "user-agent": "gatetest-status/1.0" },
    });
    return {
      name: "GitHub API",
      status: res.ok ? "operational" : res.status >= 500 ? "down" : "degraded",
      latencyMs: Date.now() - start,
      note: res.ok ? undefined : `HTTP ${res.status}`,
    };
  });
}

async function probeStripe(): Promise<ProbeResult> {
  return probeWithTimeout("Stripe API", async () => {
    const start = Date.now();
    // Public Stripe status JSON
    const res = await fetch("https://www.stripestatus.com/api/v2/status.json", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) {
      return { name: "Stripe API", status: "unknown", latencyMs: Date.now() - start };
    }
    const j = (await res.json()) as { status?: { indicator?: string } };
    const indicator = j.status?.indicator ?? "unknown";
    return {
      name: "Stripe API",
      status:
        indicator === "none"
          ? "operational"
          : indicator === "minor" || indicator === "major"
            ? "degraded"
            : indicator === "critical"
              ? "down"
              : "unknown",
      latencyMs: Date.now() - start,
      note: indicator !== "none" ? `Stripe reports: ${indicator}` : undefined,
    };
  });
}

async function probeGateTestSelf(): Promise<ProbeResult> {
  return probeWithTimeout("GateTest API", async () => {
    const start = Date.now();
    // We're already INSIDE gatetest.ai; if this code is running, the API
    // is up by definition. Return operational + uptime indication.
    return {
      name: "GateTest API",
      status: "operational",
      latencyMs: Date.now() - start,
    };
  });
}

async function probeNeon(): Promise<ProbeResult> {
  return probeWithTimeout("Neon Database", async () => {
    const start = Date.now();
    if (!process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL) {
      return {
        name: "Neon Database",
        status: "unknown",
        latencyMs: Date.now() - start,
        note: "DATABASE_URL not configured (brain features disabled)",
      };
    }
    // Don't actually open a connection here — too expensive on every probe.
    // Customers see the impact via the brain features, and this status is
    // refreshed every 30s on the page so a dead DB will surface elsewhere.
    return {
      name: "Neon Database",
      status: "operational",
      latencyMs: Date.now() - start,
      note: "Configured (live probe deferred to first scan)",
    };
  });
}

export async function GET() {
  const probes = await Promise.all([
    probeGateTestSelf(),
    probeAnthropic(),
    probeGitHub(),
    probeStripe(),
    probeNeon(),
  ]);

  const overall: ProbeResult["status"] = probes.some((p) => p.status === "down")
    ? "degraded"
    : probes.some((p) => p.status === "degraded")
      ? "degraded"
      : probes.every((p) => p.status === "operational")
        ? "operational"
        : "unknown";

  return NextResponse.json(
    {
      ok: true,
      overall,
      probes,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "access-control-allow-origin": "*",
      },
    },
  );
}
