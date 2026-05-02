"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

// =============================================================================
// PUBLIC STATUS PAGE — phase-6 gap 4
// =============================================================================
// Reads /api/status every 30s and renders a Statuspage-style health board.
// Live probes for: GateTest itself, Anthropic, GitHub, Stripe, Neon.
// Required by enterprise buyers as part of the "is this safe to depend on"
// evaluation.
// =============================================================================

interface Probe {
  name: string;
  status: "operational" | "degraded" | "down" | "unknown";
  latencyMs?: number;
  note?: string;
}

interface StatusPayload {
  ok: boolean;
  overall: Probe["status"];
  probes: Probe[];
  timestamp: string;
}

const STATUS_PILL: Record<Probe["status"], string> = {
  operational: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  degraded: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  down: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  unknown: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
};

const STATUS_DOT: Record<Probe["status"], string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-rose-500",
  unknown: "bg-slate-400",
};

const STATUS_LABEL: Record<Probe["status"], string> = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "Major outage",
  unknown: "Status unknown",
};

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const j = (await res.json()) as StatusPayload;
        if (!cancelled) {
          setData(j);
          setRefreshedAt(new Date());
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Network error");
        }
      }
    }
    tick();
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      <Navbar />
      <main className="px-6 py-20 min-h-screen">
        <div className="mx-auto max-w-3xl">
          <header className="text-center mb-12">
            <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight">
              GateTest status
            </h1>
            <p className="text-muted-foreground">
              Live probes against every dependency GateTest relies on.
              Auto-refreshes every 30 seconds.
            </p>
          </header>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-300 mb-6">
              <strong>Could not reach status endpoint:</strong> {error}
            </div>
          )}

          {!data && !error && (
            <div className="rounded-lg border border-foreground/10 p-8 text-center text-muted-foreground">
              Loading status…
            </div>
          )}

          {data && (
            <>
              {/* Overall banner */}
              <div
                className={`rounded-xl border-2 p-6 mb-6 flex items-center gap-4 ${STATUS_PILL[data.overall]}`}
              >
                <span
                  className={`relative flex h-3 w-3 rounded-full ${STATUS_DOT[data.overall]}`}
                >
                  {data.overall === "operational" && (
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full ${STATUS_DOT[data.overall]} opacity-75`}
                    />
                  )}
                </span>
                <div className="flex-1">
                  <div className="text-lg font-bold">
                    {STATUS_LABEL[data.overall]}
                  </div>
                  {refreshedAt && (
                    <div className="text-xs opacity-70">
                      Last checked {refreshedAt.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>

              {/* Per-service rows */}
              <div className="rounded-xl border border-foreground/15 bg-card divide-y divide-foreground/5">
                {data.probes.map((p) => (
                  <div
                    key={p.name}
                    className="px-5 py-4 flex items-center gap-4"
                  >
                    <span
                      className={`flex-shrink-0 h-3 w-3 rounded-full ${STATUS_DOT[p.status]}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{p.name}</div>
                      {p.note && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.note}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div
                        className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${STATUS_PILL[p.status]}`}
                      >
                        {p.status}
                      </div>
                      {typeof p.latencyMs === "number" && (
                        <div className="text-xs text-muted-foreground mt-1 font-mono tabular-nums">
                          {p.latencyMs}ms
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-10 grid sm:grid-cols-2 gap-4">
                <Link
                  href="https://status.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-foreground/15 p-4 hover:border-teal-500/40 transition-colors"
                >
                  <div className="font-semibold mb-1">Anthropic Status →</div>
                  <div className="text-sm text-muted-foreground">
                    Detailed Anthropic incident history
                  </div>
                </Link>
                <Link
                  href="https://www.githubstatus.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-foreground/15 p-4 hover:border-teal-500/40 transition-colors"
                >
                  <div className="font-semibold mb-1">GitHub Status →</div>
                  <div className="text-sm text-muted-foreground">
                    Detailed GitHub incident history
                  </div>
                </Link>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground mt-12 text-center">
            Status is checked client-side every 30 seconds.{" "}
            <Link href="/api/status" className="underline hover:text-teal-600">
              Raw JSON
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
