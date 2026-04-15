"use client";

import { useState } from "react";

interface Check {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "pending";
  detail?: string;
  duration?: number;
}

interface HealthReport {
  ready: boolean;
  summary: { ok: number; warn: number; fail: number; total: number };
  checks: Check[];
  duration: number;
  fingerprint: string;
  generated_at: string;
}

const EXPECTED: Array<{ id: string; label: string }> = [
  { id: "env", label: "Environment variables" },
  { id: "db", label: "Database (Neon Postgres)" },
  { id: "github", label: "GitHub App auth" },
  { id: "stripe", label: "Stripe API" },
  { id: "anthropic", label: "Anthropic API (Claude)" },
  { id: "modules", label: "Scan modules" },
  { id: "scan", label: "Live scan (in-memory test)" },
  { id: "auth", label: "Auth providers" },
];

export default function HealthPage() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState("");

  async function runSelfTest() {
    setRunning(true);
    setError("");
    setReport(null);
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        setError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      const data = (await res.json()) as HealthReport;
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Self-test failed");
    } finally {
      setRunning(false);
    }
  }

  // Merge running skeleton with real results so the list is stable order.
  const displayChecks: Check[] = EXPECTED.map((e) => {
    const real = report?.checks.find((c) => c.id === e.id);
    if (real) return real;
    return { id: e.id, label: e.label, status: running ? "pending" : "pending" };
  });

  const allGreen = report?.ready === true && report.summary.warn === 0;
  const ready = report?.ready === true;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-wider text-accent mb-2">
            System Self-Test
          </p>
          <h1 className="text-3xl font-bold mb-2">End-to-End Health Check</h1>
          <p className="text-muted text-sm">
            Every subsystem, verified live. No fake-pass.
          </p>
        </div>

        {/* The big button */}
        <div className="mb-8">
          <button
            onClick={runSelfTest}
            disabled={running}
            className={`w-full py-6 rounded-2xl text-lg font-bold transition-all shadow-lg disabled:opacity-60 ${
              allGreen
                ? "bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-green-500/30"
                : ready
                ? "bg-gradient-to-r from-green-500 to-teal-500 text-white shadow-green-500/25"
                : report && report.summary.fail > 0
                ? "bg-gradient-to-r from-amber-500 to-red-500 text-white shadow-amber-500/25"
                : "bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-green-500/25 hover:shadow-green-500/40"
            }`}
          >
            <div className="flex items-center justify-center gap-3">
              {running ? (
                <>
                  <span className="w-5 h-5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                  <span>Running preflight…</span>
                </>
              ) : allGreen ? (
                <>
                  <span className="text-2xl">✓</span>
                  <span>All Systems Go — Click to Re-run</span>
                </>
              ) : ready ? (
                <>
                  <span className="text-2xl">✓</span>
                  <span>Ready with Warnings — Click to Re-run</span>
                </>
              ) : report && report.summary.fail > 0 ? (
                <>
                  <span className="text-2xl">!</span>
                  <span>{report.summary.fail} Failure{report.summary.fail > 1 ? "s" : ""} — Click to Re-run</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">▶</span>
                  <span>Run Full Self-Test</span>
                </>
              )}
            </div>
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="card p-4 mb-6 border-l-4 border-l-red-500 bg-red-50/50">
            <p className="text-sm font-medium text-red-700">Self-test error</p>
            <p className="text-xs text-red-600 font-mono mt-1">{error}</p>
          </div>
        )}

        {/* Summary tiles */}
        {report && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{report.summary.total}</p>
              <p className="text-xs text-muted mt-1">Checks</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{report.summary.ok}</p>
              <p className="text-xs text-muted mt-1">OK</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{report.summary.warn}</p>
              <p className="text-xs text-muted mt-1">Warn</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{report.summary.fail}</p>
              <p className="text-xs text-muted mt-1">Fail</p>
            </div>
          </div>
        )}

        {/* Checklist */}
        <div className="space-y-2 mb-8">
          {displayChecks.map((c, i) => {
            const statusColor =
              c.status === "ok"
                ? "bg-green-50 border-green-200"
                : c.status === "warn"
                ? "bg-amber-50 border-amber-200"
                : c.status === "fail"
                ? "bg-red-50 border-red-200"
                : running
                ? "bg-slate-50 border-slate-200 opacity-80"
                : "bg-white border-border opacity-50";

            const iconBg =
              c.status === "ok"
                ? "bg-green-100 text-green-600"
                : c.status === "warn"
                ? "bg-amber-100 text-amber-600"
                : c.status === "fail"
                ? "bg-red-100 text-red-600"
                : "bg-slate-100 text-slate-400";

            const icon =
              c.status === "ok" ? "✓" :
              c.status === "warn" ? "!" :
              c.status === "fail" ? "✕" :
              running && i === 0 ? <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin block" /> :
              "○";

            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${statusColor}`}
                style={running && !report ? { animation: `slide-in 0.3s ease-out ${i * 80}ms both` } : undefined}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-base font-bold ${iconBg}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{c.label}</p>
                  {c.detail && (
                    <p className={`text-xs mt-0.5 font-mono truncate ${
                      c.status === "ok" ? "text-green-700" :
                      c.status === "warn" ? "text-amber-700" :
                      c.status === "fail" ? "text-red-700" :
                      "text-muted"
                    }`}>
                      {c.detail}
                    </p>
                  )}
                </div>
                {typeof c.duration === "number" && (
                  <span className="text-xs text-muted font-mono shrink-0">{c.duration}ms</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {report && (
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Total time: <span className="font-mono">{report.duration}ms</span></span>
            <span className="font-mono">fp: {report.fingerprint}</span>
            <span>{new Date(report.generated_at).toLocaleString()}</span>
          </div>
        )}

        <div className="mt-10 text-center">
          <a href="/admin" className="text-sm text-muted hover:text-foreground">&larr; Back to admin</a>
        </div>
      </div>
    </div>
  );
}
