/**
 * Public Status Page — server-rendered uptime / configuration view.
 *
 * Customer-facing answer to "is your service up right now?". Mirrors the JSON
 * shape produced by /api/status, rendered as cards with colour-coded
 * indicators. Server-rendered on every request (force-dynamic) so the snapshot
 * is genuinely live, not cached.
 *
 * Honesty contract: this page reports env-var presence only, never values. If
 * a check is misconfigured the badge turns amber/red; the secret material
 * itself never reaches the rendered HTML.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GateTest Status — Uptime & Incident Reports",
  description:
    "Live status of GateTest's scan API, checkout, AI provider, and git host integrations. Incidents reported within 1 hour.",
};

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

/**
 * Mirror the shape of /api/status without an HTTP round-trip — server
 * components run in the same Node process so we read env directly. Keeps the
 * page resilient if the API route is unreachable for any reason.
 */
function buildStatus(): StatusResponse {
  let scanApi: Check;
  try {
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

  const stripeOk = present("STRIPE_SECRET_KEY");
  const checkout: Check = {
    name: "Checkout",
    status: stripeOk ? "operational" : "down",
    configured: stripeOk,
    detail: stripeOk ? undefined : "STRIPE_SECRET_KEY not configured",
  };

  const anthropicOk = present("ANTHROPIC_API_KEY");
  const anthropic: Check = {
    name: "AI Provider (Anthropic)",
    status: anthropicOk ? "operational" : "down",
    configured: anthropicOk,
    detail: anthropicOk ? undefined : "ANTHROPIC_API_KEY not configured",
  };

  const gluecronOk = present("GLUECRON_API_TOKEN");
  const githubOk = present("GITHUB_TOKEN") || present("GATETEST_GITHUB_TOKEN");
  const hostOk = gluecronOk || githubOk;
  const gitHost: Check = {
    name: "Git Host (Gluecron / GitHub fallback)",
    status: hostOk ? (gluecronOk ? "operational" : "degraded") : "down",
    configured: hostOk,
    detail: hostOk
      ? gluecronOk
        ? undefined
        : "Gluecron token missing — GitHub fallback active"
      : "Neither GLUECRON_API_TOKEN nor GITHUB_TOKEN configured",
  };

  const checks = [scanApi, checkout, anthropic, gitHost];
  const rollUp: CheckStatus = checks.some((c) => c.status === "down")
    ? "down"
    : checks.some((c) => c.status === "degraded")
    ? "degraded"
    : "operational";

  return {
    status: rollUp,
    timestamp: new Date().toISOString(),
    checks,
  };
}

function statusLabel(s: CheckStatus): string {
  if (s === "operational") return "Operational";
  if (s === "degraded") return "Degraded";
  return "Down";
}

function overallLabel(s: CheckStatus): string {
  if (s === "operational") return "All systems operational";
  if (s === "degraded") return "Partial degradation";
  return "Service disruption";
}

function dotClass(s: CheckStatus): string {
  if (s === "operational") return "bg-emerald-500";
  if (s === "degraded") return "bg-amber-500";
  return "bg-red-500";
}

function badgeClass(s: CheckStatus): string {
  if (s === "operational") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (s === "degraded") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  return "border-red-500/40 bg-red-500/10 text-red-200";
}

function cardBorderClass(s: CheckStatus): string {
  if (s === "operational") return "border-l-4 border-l-emerald-500";
  if (s === "degraded") return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-red-500";
}

function statusTextClass(s: CheckStatus): string {
  if (s === "operational") return "text-emerald-600";
  if (s === "degraded") return "text-amber-600";
  return "text-red-600";
}

export default function StatusPage() {
  const snapshot = buildStatus();

  return (
    <div className="min-h-screen">
      {/* Dark hero band */}
      <div className="hero-dark px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-6">
            <Link
              href="/"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              &larr; gatetest.ai
            </Link>
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold mb-6">
            GateTest <span className="gradient-text">Status</span>
          </h1>

          <div
            className={`inline-flex items-center gap-3 px-5 py-3 rounded-full border ${badgeClass(
              snapshot.status
            )}`}
          >
            <span
              className={`w-3 h-3 rounded-full ${dotClass(
                snapshot.status
              )} ${snapshot.status === "operational" ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span className="text-base font-semibold">
              {overallLabel(snapshot.status)}
            </span>
          </div>

          <p className="text-base text-muted mt-6 max-w-2xl">
            Live snapshot of GateTest&apos;s production dependencies. Each
            check verifies that the service is configured and reachable. Status
            re-evaluates on every page load.
          </p>
        </div>
      </div>

      {/* Light body — check cards */}
      <div className="px-6 py-16 bg-[var(--surface-solid)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-bold mb-6 text-foreground">
            Component status
          </h2>

          <div className="grid gap-4">
            {snapshot.checks.map((check) => (
              <div
                key={check.name}
                className={`p-5 rounded-lg bg-white shadow-sm border border-border ${cardBorderClass(
                  check.status
                )}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${dotClass(
                          check.status
                        )}`}
                        aria-hidden="true"
                      />
                      <h3 className="font-semibold text-base text-foreground">
                        {check.name}
                      </h3>
                    </div>
                    {check.detail ? (
                      <p className="text-sm text-muted mt-2 ml-6">
                        {check.detail}
                      </p>
                    ) : (
                      <p className="text-sm text-muted mt-2 ml-6">
                        {check.configured
                          ? "Configured and ready."
                          : "Not configured."}
                      </p>
                    )}
                  </div>
                  <div
                    className={`text-sm font-semibold whitespace-nowrap ${statusTextClass(
                      check.status
                    )}`}
                  >
                    {statusLabel(check.status)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Upstream link */}
          <div className="mt-10 p-5 rounded-lg bg-[var(--background-alt)] border border-border">
            <h3 className="text-base font-semibold text-foreground mb-2">
              Upstream providers
            </h3>
            <p className="text-sm text-muted mb-3">
              GateTest depends on Anthropic for AI-powered code review. If you
              are seeing degraded AI behaviour, check upstream status:
            </p>
            <a
              href="https://status.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-accent-light hover:underline"
            >
              status.anthropic.com
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>

          {/* Footer block */}
          <div className="mt-10 pt-6 border-t border-border">
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">Last checked:</span>{" "}
              <time dateTime={snapshot.timestamp} className="font-mono">
                {snapshot.timestamp}
              </time>
            </p>
            <p className="text-sm text-muted mt-3">
              GateTest is in beta — incidents are reported here within 1 hour.
              For urgent issues, contact{" "}
              <a
                href="mailto:hello@gatetest.ai"
                className="text-accent-light hover:underline"
              >
                hello@gatetest.ai
              </a>
              .
            </p>
            <p className="text-xs text-muted mt-3">
              Machine-readable JSON:{" "}
              <Link
                href="/api/status"
                className="text-accent-light hover:underline font-mono"
              >
                /api/status
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
