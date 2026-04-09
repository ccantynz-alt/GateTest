"use client";

import { useEffect, useState, useCallback } from "react";

interface ModuleProgress {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "warning";
  checks?: number;
  issues?: number;
  duration?: number;
  message?: string;
}

interface ScanState {
  id: string;
  repoUrl?: string;
  tier?: string;
  status: "pending" | "cloning" | "scanning" | "fixing" | "complete" | "failed";
  progress: number;
  currentModule: string | null;
  modules: ModuleProgress[];
  totalModules: number;
  completedModules: number;
  totalIssues: number;
  totalFixed: number;
  startedAt: string;
  completedAt: string | null;
  reportUrl: string | null;
  error: string | null;
}

const MODULE_DESCRIPTIONS: Record<string, string> = {
  syntax: "Validating syntax across all source files",
  lint: "Running ESLint, Stylelint, Markdownlint",
  secrets: "Scanning for hardcoded API keys, tokens, passwords",
  codeQuality: "Checking code quality — console.log, eval, complexity",
  unitTests: "Running unit test suite",
  integrationTests: "Checking API endpoints and database operations",
  e2e: "Running end-to-end tests",
  visual: "Checking visual regression and layout shifts",
  accessibility: "Auditing WCAG 2.2 AAA compliance",
  performance: "Analysing bundle size and Core Web Vitals",
  security: "OWASP scanning — XSS, SQLi, CVEs, Docker security",
  seo: "Validating meta tags, Open Graph, structured data",
  links: "Detecting broken internal and external links",
  compatibility: "Checking browser compatibility and polyfills",
  dataIntegrity: "Validating migrations, PII handling, SQL injection",
  documentation: "Checking README, CHANGELOG, JSDoc, licenses",
  liveCrawler: "Crawling live site pages",
  explorer: "Autonomous interactive element testing",
  chaos: "Running chaos and resilience tests",
  mutation: "Mutation testing — testing the tests",
  aiReview: "AI-powered code review with Claude",
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <span className="text-success">&#10003;</span>;
    case "failed":
      return <span className="text-danger">&#10007;</span>;
    case "warning":
      return <span className="text-yellow-400">&#9888;</span>;
    case "running":
      return <span className="text-accent-light animate-pulse">&#9679;</span>;
    default:
      return <span className="text-muted/30">&#9675;</span>;
  }
}

export default function ScanStatus() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Get scan ID from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setScanId(params.get("id"));
  }, []);

  // Poll for updates
  const fetchStatus = useCallback(async () => {
    if (!scanId) return;
    try {
      const res = await fetch(`/api/scan/status?id=${scanId}`);
      const data = await res.json();
      setScan(data);
    } catch {
      // Retry on next poll
    }
  }, [scanId]);

  useEffect(() => {
    if (!scanId) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500); // Poll every 1.5s
    return () => clearInterval(interval);
  }, [scanId, fetchStatus]);

  // Elapsed timer
  useEffect(() => {
    if (!scan || scan.status === "complete" || scan.status === "failed") return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [scan]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  if (!scanId) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center px-6">
        <p className="text-muted">No scan ID provided.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg px-6 py-16">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/30 bg-accent/5 text-sm text-accent-light mb-4">
            {scan?.status === "complete" ? (
              <span className="w-2 h-2 rounded-full bg-success" />
            ) : scan?.status === "failed" ? (
              <span className="w-2 h-2 rounded-full bg-danger" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-accent-light animate-pulse" />
            )}
            {scan?.status === "complete"
              ? "Scan Complete"
              : scan?.status === "failed"
              ? "Scan Failed"
              : "Scanning..."}
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {scan?.status === "complete" ? (
              <span className="gradient-text">Scan Complete</span>
            ) : scan?.status === "failed" ? (
              <span className="text-danger">Scan Failed</span>
            ) : (
              <>
                Scanning your repo<span className="animate-pulse">...</span>
              </>
            )}
          </h1>
          {scan?.repoUrl && (
            <p className="text-sm text-muted font-mono">{scan.repoUrl}</p>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between text-xs text-muted mb-2">
            <span>
              {scan?.completedModules || 0} / {scan?.totalModules || 21} modules
            </span>
            <span>{formatTime(elapsed)}</span>
          </div>
          <div className="w-full h-3 bg-surface border border-border rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${scan?.progress || 0}%`,
                background:
                  scan?.status === "complete"
                    ? "#22c55e"
                    : scan?.status === "failed"
                    ? "#ef4444"
                    : "linear-gradient(90deg, #6366f1, #8b5cf6)",
              }}
            />
          </div>
        </div>

        {/* Status messages */}
        {scan?.status === "cloning" && (
          <div className="text-center text-sm text-muted mb-6 animate-pulse">
            Connecting to repository and cloning source code...
          </div>
        )}
        {scan?.status === "fixing" && (
          <div className="text-center text-sm text-success mb-6 animate-pulse">
            Applying auto-fixes to your code...
          </div>
        )}

        {/* Live module list — the terminal experience */}
        <div className="terminal mb-8">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-3 text-xs text-muted font-mono">
              gatetest --suite {scan?.tier || "full"} --fix
            </span>
          </div>
          <div className="p-4 font-mono text-sm max-h-[500px] overflow-y-auto space-y-1">
            {/* Header */}
            <p className="text-accent-light">
              ========================================
            </p>
            <p className="text-accent-light font-bold">
              {"  "}GATETEST — Quality Assurance Gate
            </p>
            <p className="text-accent-light">
              ========================================
            </p>
            <p className="text-muted text-xs mb-2">
              {"  "}
              {scan?.tier === "quick"
                ? "Quick scan: 4 modules"
                : scan?.tier === "nuclear"
                ? "Nuclear: 21 modules + crawl + mutation"
                : "Full scan: 21 modules"}
            </p>

            {/* Module lines */}
            {(scan?.modules || []).map((mod) => (
              <div key={mod.name} className="flex items-start gap-2">
                <span className="w-4 shrink-0 text-center">
                  <StatusIcon status={mod.status} />
                </span>
                <span
                  className={
                    mod.status === "running"
                      ? "text-foreground"
                      : mod.status === "passed"
                      ? "text-muted"
                      : mod.status === "failed"
                      ? "text-danger"
                      : "text-muted/40"
                  }
                >
                  {mod.name}
                </span>
                {mod.status === "running" && (
                  <span className="text-muted text-xs animate-pulse">
                    {MODULE_DESCRIPTIONS[mod.name] || "Scanning..."}
                  </span>
                )}
                {mod.status === "passed" && (
                  <span className="text-muted text-xs">
                    {mod.checks ? `${mod.checks} checks` : ""}
                    {mod.duration ? ` · ${mod.duration}ms` : ""}
                  </span>
                )}
                {mod.status === "failed" && (
                  <span className="text-danger text-xs">
                    {mod.issues
                      ? `${mod.issues} issue${mod.issues > 1 ? "s" : ""}`
                      : ""}
                    {mod.message ? ` — ${mod.message}` : ""}
                  </span>
                )}
                {mod.status === "warning" && (
                  <span className="text-yellow-400 text-xs">
                    {mod.message || "warnings"}
                  </span>
                )}
              </div>
            ))}

            {/* Current activity indicator */}
            {scan?.currentModule &&
              scan.status !== "complete" &&
              scan.status !== "failed" && (
                <p className="text-accent-light text-xs mt-2 animate-pulse">
                  {"  "}
                  {MODULE_DESCRIPTIONS[scan.currentModule] || "Processing..."}
                </p>
              )}

            {/* Completion footer */}
            {scan?.status === "complete" && (
              <>
                <p className="text-accent-light mt-3">
                  ----------------------------------------
                </p>
                <p className="font-bold">
                  {"  "}
                  {scan.totalIssues === 0 ? (
                    <span className="text-success px-2 py-0.5 bg-success/10 rounded">
                      GATE: PASSED
                    </span>
                  ) : (
                    <span className="text-danger px-2 py-0.5 bg-danger/10 rounded">
                      GATE: {scan.totalIssues} ISSUES FOUND
                    </span>
                  )}
                </p>
                <p className="text-muted text-xs">
                  {"  "}
                  {scan.completedModules}/{scan.totalModules} modules ·{" "}
                  {scan.totalIssues} issues
                  {scan.totalFixed > 0 && ` · ${scan.totalFixed} auto-fixed`}
                  {" · "}
                  {formatTime(elapsed)}
                </p>
                <p className="text-accent-light">
                  ========================================
                </p>
              </>
            )}

            {scan?.status === "failed" && (
              <>
                <p className="text-danger mt-3">
                  {"  "}ERROR: {scan.error || "Scan failed"}
                </p>
                <p className="text-muted text-xs">
                  {"  "}Your card hold has been released. No charge.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Stats cards */}
        {scan?.status === "complete" && (
          <div className="grid grid-cols-4 gap-3 mb-8">
            <div className="text-center p-3 rounded-lg border border-border bg-surface">
              <div className="text-2xl font-bold gradient-text">
                {scan.completedModules}
              </div>
              <div className="text-xs text-muted">Modules</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-border bg-surface">
              <div className="text-2xl font-bold text-danger">
                {scan.totalIssues}
              </div>
              <div className="text-xs text-muted">Issues</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-border bg-surface">
              <div className="text-2xl font-bold text-success">
                {scan.totalFixed}
              </div>
              <div className="text-xs text-muted">Fixed</div>
            </div>
            <div className="text-center p-3 rounded-lg border border-border bg-surface">
              <div className="text-2xl font-bold text-foreground">
                {formatTime(elapsed)}
              </div>
              <div className="text-xs text-muted">Time</div>
            </div>
          </div>
        )}

        {/* Actions */}
        {scan?.status === "complete" && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {scan.reportUrl && (
              <a
                href={scan.reportUrl}
                className="px-6 py-3 rounded-lg bg-accent hover:bg-accent-light text-white font-semibold text-sm transition-colors"
              >
                Download Full Report
              </a>
            )}
            <a
              href="/#pricing"
              className="px-6 py-3 rounded-lg border border-border hover:border-accent/50 text-foreground font-semibold text-sm transition-colors"
            >
              Run Another Scan
            </a>
          </div>
        )}

        {scan?.status === "failed" && (
          <div className="text-center">
            <p className="text-sm text-muted mb-4">
              Your card hold has been automatically released. No charge was made.
            </p>
            <a
              href="/#pricing"
              className="px-6 py-3 rounded-lg bg-accent hover:bg-accent-light text-white font-semibold text-sm transition-colors"
            >
              Try Again
            </a>
          </div>
        )}

        {/* Payment notice */}
        {scan?.status !== "complete" && scan?.status !== "failed" && (
          <p className="text-center text-xs text-muted mt-4">
            Your card is held, not charged. Payment is only captured when the
            scan completes and your report is delivered.
          </p>
        )}
      </div>
    </div>
  );
}
