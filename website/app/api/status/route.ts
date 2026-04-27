/**
 * Public Status API — JSON endpoint backing /status.
 *
 * GET /api/status
 *
 * Returns a high-level health summary for upstream dependencies.
 *
 * Honesty contract: this endpoint reports env-var presence only — it does NOT
 * make outbound calls to upstream providers. Cold-start serverless functions
 * have to round-trip across the network for any real ping; one slow Anthropic
 * response would cause /status to flag "down" even though everything is
 * actually fine. Upstream incidents are best surfaced through each provider's
 * own status page (we link Anthropic's from the page).
 *
 * NEVER returns env-var VALUES — only presence. If a check is misconfigured
 * the customer sees "down", never the secret material.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "operational" | "degraded" | "down";

interface Check {
  name: string;
  status: CheckStatus;
  configured: boolean;
  detail?: string;
}

interface StatusResponse {
  status: CheckStatus;
  timestamp: string;
  checks: Check[];
}

function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function buildChecks(): Check[] {
  // Scan API: checks the scan/run module is reachable. We don't actually run
  // a scan — we just verify the route file resolves so the deployment knows
  // the bundle includes it. A failed `require.resolve` here means the build
  // shipped without the route, which is genuinely "down".
  let scanApi: Check;
  try {
    // require.resolve never executes the module — it only checks resolution.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve("@/app/api/scan/run/route");
    scanApi = { name: "Scan API", status: "operational", configured: true };
  } catch {
    scanApi = {
      name: "Scan API",
      status: "down",
      configured: false,
      detail: "Scan route not bundled",
    };
  }

  // Checkout: Stripe key presence
  const stripeOk = present("STRIPE_SECRET_KEY");
  const checkout: Check = {
    name: "Checkout",
    status: stripeOk ? "operational" : "down",
    configured: stripeOk,
    detail: stripeOk ? undefined : "STRIPE_SECRET_KEY not set",
  };

  // AI provider
  const anthropicOk = present("ANTHROPIC_API_KEY");
  const anthropic: Check = {
    name: "AI Provider (Anthropic)",
    status: anthropicOk ? "operational" : "down",
    configured: anthropicOk,
    detail: anthropicOk ? undefined : "ANTHROPIC_API_KEY not set",
  };

  // Git host: Gluecron OR GitHub fallback satisfies the dependency.
  const gluecronOk = present("GLUECRON_API_TOKEN");
  const githubOk = present("GITHUB_TOKEN") || present("GATETEST_GITHUB_TOKEN");
  const hostOk = gluecronOk || githubOk;
  const gitHost: Check = {
    name: "Git Host (Gluecron / GitHub fallback)",
    status: hostOk
      ? gluecronOk && githubOk
        ? "operational"
        : "operational"
      : "down",
    configured: hostOk,
    detail: hostOk
      ? gluecronOk
        ? undefined
        : "Gluecron token missing — GitHub fallback active"
      : "Neither GLUECRON_API_TOKEN nor GITHUB_TOKEN set",
  };

  // If only the GitHub fallback is wired, surface degraded so on-call sees it.
  if (!gluecronOk && githubOk) {
    gitHost.status = "degraded";
  }

  return [scanApi, checkout, anthropic, gitHost];
}

function rollUp(checks: Check[]): CheckStatus {
  if (checks.some((c) => c.status === "down")) return "down";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "operational";
}

export async function GET(_req: NextRequest) {
  const checks = buildChecks();
  const body: StatusResponse = {
    status: rollUp(checks),
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, {
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
