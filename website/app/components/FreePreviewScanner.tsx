"use client";

import { useState } from "react";

// =============================================================================
// FREE PREVIEW SCANNER — phase-6 gap 1, the conversion funnel
// =============================================================================
// Surfaces /api/scan/preview as a homepage-level "scan any public repo
// for free, see top 5 findings, upgrade to fix all" widget. No login,
// no card, no friction. Removes the #1 conversion blocker today (paste
// card -> scan -> see findings).
// =============================================================================

interface PreviewFinding {
  module: string;
  severity: "error" | "warning" | "info";
  file: string | null;
  line: number | null;
  message: string;
}

interface PreviewResponse {
  ok: boolean;
  findings?: PreviewFinding[];
  total?: number;
  modules?: number;
  error?: string;
  hint?: string;
}

const SEVERITY_STYLES = {
  error:
    "bg-rose-500/10 text-rose-200 border-rose-500/30",
  warning:
    "bg-amber-500/10 text-amber-200 border-amber-500/30",
  info:
    "bg-sky-500/10 text-sky-200 border-sky-500/30",
} as const;

export default function FreePreviewScanner() {
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState("");

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    setError("");
    setResult(null);
    setScanning(true);
    try {
      const res = await fetch("/api/scan/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const data = (await res.json()) as PreviewResponse;
      if (!data.ok) {
        setError(data.error || "Scan failed");
        if (data.hint) setError((prev) => `${prev} — ${data.hint}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setScanning(false);
    }
  }

  function buildCheckoutUrl(tier: "full" | "scan_fix" | "nuclear") {
    const url = new URL("/api/checkout", window.location.origin);
    url.searchParams.set("tier", tier);
    url.searchParams.set("repo", repoUrl.trim());
    return url.toString();
  }

  return (
    <section className="px-6 py-20 bg-gradient-to-b from-background to-muted/20">
      <div className="mx-auto max-w-3xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-4">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Free preview — no card, no login
          </div>
          <h2 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">
            Try GateTest on any public repo
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Paste a GitHub URL. Get the top 5 findings in under 15 seconds.
            See the issues before you decide to fix them.
          </p>
        </div>

        <form onSubmit={runPreview} className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={scanning}
            className="flex-1 px-4 py-3 rounded-lg border border-foreground/15 bg-background text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:opacity-50"
            required
            pattern="https://github\.com/.+"
          />
          <button
            type="submit"
            disabled={scanning || !repoUrl.trim()}
            className="btn-primary px-6 py-3 font-semibold whitespace-nowrap disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan free →"}
          </button>
        </form>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-300 text-sm">
            <strong>Couldn&apos;t scan:</strong> {error}
          </div>
        )}

        {scanning && !result && (
          <div className="rounded-lg border border-foreground/10 p-6 text-center text-muted-foreground">
            <div className="inline-flex items-center gap-2 text-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
              </span>
              Running syntax / lint / secrets — usually under 12 seconds…
            </div>
          </div>
        )}

        {result && result.ok && (
          <div className="space-y-6">
            <div className="rounded-lg border border-foreground/15 bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-foreground/10 bg-muted/20 flex items-baseline justify-between">
                <div>
                  <span className="font-semibold text-foreground">
                    {result.total ?? 0} {result.total === 1 ? "finding" : "findings"}
                  </span>{" "}
                  <span className="text-sm text-muted-foreground">
                    across {result.modules ?? 3} preview modules
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Top {result.findings?.length ?? 0} shown
                </span>
              </div>
              <ul className="divide-y divide-foreground/5">
                {(result.findings ?? []).map((f, i) => (
                  <li key={i} className="px-5 py-3 flex items-start gap-3">
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${SEVERITY_STYLES[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-foreground break-words">
                        {f.message}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                        {f.module}
                        {f.file ? ` · ${f.file}` : ""}
                        {typeof f.line === "number" ? `:${f.line}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border-2 border-teal-500/40 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-6">
              <h3 className="font-bold text-lg text-foreground mb-2">
                {(result.total ?? 0) > (result.findings?.length ?? 0)
                  ? `Want to see all ${result.total} findings + auto-fix them?`
                  : "Want every module to scan + auto-fix the issues?"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                The free preview ran 3 modules. The paid tiers run all 90,
                and ship a pull request with the fixes.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <a
                  href={buildCheckoutUrl("full")}
                  className="rounded-lg border border-foreground/15 bg-background p-4 hover:border-teal-500/50 transition-colors text-center"
                >
                  <div className="text-2xl font-bold">$99</div>
                  <div className="text-xs text-muted-foreground mb-2">Full Scan</div>
                  <div className="text-xs">90 modules · SARIF + JUnit</div>
                </a>
                <a
                  href={buildCheckoutUrl("scan_fix")}
                  className="rounded-lg border-2 border-teal-500/50 bg-teal-500/5 p-4 hover:border-teal-500 transition-colors text-center"
                >
                  <div className="text-2xl font-bold">$199</div>
                  <div className="text-xs text-muted-foreground mb-2">Scan + Fix</div>
                  <div className="text-xs">+ auto-fix PR · pair-review</div>
                </a>
                <a
                  href={buildCheckoutUrl("nuclear")}
                  className="rounded-lg border border-foreground/15 bg-background p-4 hover:border-teal-500/50 transition-colors text-center"
                >
                  <div className="text-2xl font-bold">$399</div>
                  <div className="text-xs text-muted-foreground mb-2">Nuclear</div>
                  <div className="text-xs">+ AI diagnosis · correlation · mutation</div>
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-4 text-center">
                Pay only when the scan completes. Card hold released on failure.
              </p>
            </div>
          </div>
        )}

        {result && !result.ok && !error && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300 text-sm">
            Preview unavailable. Try a different repo or scan via the paid tier.
          </div>
        )}
      </div>
    </section>
  );
}
