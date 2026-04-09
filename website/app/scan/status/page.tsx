"use client";

import { useEffect, useState, useCallback, useRef } from "react";

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

const MODULE_INFO: Record<string, { desc: string; icon: string }> = {
  syntax: { desc: "Validating syntax across all source files", icon: "{ }" },
  lint: { desc: "Running ESLint, Stylelint, Markdownlint", icon: "~~" },
  secrets: { desc: "Hunting for hardcoded API keys & tokens", icon: "***" },
  codeQuality: { desc: "Analysing code quality & complexity", icon: "<>" },
  unitTests: { desc: "Executing unit test suite", icon: "T" },
  integrationTests: { desc: "Checking API endpoints & DB operations", icon: "API" },
  e2e: { desc: "Running end-to-end browser tests", icon: "E2E" },
  visual: { desc: "Detecting visual regressions", icon: "EYE" },
  accessibility: { desc: "Auditing WCAG 2.2 AAA compliance", icon: "A11Y" },
  performance: { desc: "Measuring Core Web Vitals & bundle size", icon: "ms" },
  security: { desc: "OWASP deep scan — XSS, SQLi, CVEs, Docker", icon: "!!!" },
  seo: { desc: "Validating meta tags & structured data", icon: "SEO" },
  links: { desc: "Checking every link — internal & external", icon: "URL" },
  compatibility: { desc: "Browser compatibility & polyfill check", icon: "CSS" },
  dataIntegrity: { desc: "Migration safety & PII handling", icon: "DB" },
  documentation: { desc: "README, CHANGELOG, JSDoc, licenses", icon: "DOC" },
  liveCrawler: { desc: "Crawling live site pages", icon: "WEB" },
  explorer: { desc: "Autonomous interactive element testing", icon: "BOT" },
  chaos: { desc: "Chaos & resilience testing", icon: "ZAP" },
  mutation: { desc: "Mutation testing — testing the tests", icon: "DNA" },
  aiReview: { desc: "AI code review with Claude", icon: "AI" },
};

const STATUS_MESSAGES = [
  "Cloning repository...",
  "Analysing file structure...",
  "Building dependency graph...",
  "Initialising scan engine...",
];

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-success/20 text-success text-xs font-bold">
          &#10003;
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-danger/20 text-danger text-xs font-bold">
          &#10007;
        </span>
      );
    case "warning":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-400/20 text-yellow-400 text-xs font-bold">
          !
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent/20 text-accent-light text-xs">
          <span className="w-2 h-2 rounded-full bg-accent-light animate-pulse" />
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-light/50 text-muted/30 text-xs">
          &#9675;
        </span>
      );
  }
}

function AnimatedNumber({ value, duration = 500 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(value);

  useEffect(() => {
    const start = ref.current;
    const diff = value - start;
    if (diff === 0) return;
    const startTime = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(tick);
      else ref.current = value;
    };
    requestAnimationFrame(tick);
  }, [value, duration]);

  return <span className="count-up">{display}</span>;
}

export default function ScanStatus() {
  const [scanId, setScanId] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cloneMessage, setCloneMessage] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const prevModulesRef = useRef<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setScanId(params.get("id"));
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!scanId) return;
    try {
      const res = await fetch(`/api/scan/status?id=${scanId}`);
      const data = await res.json();
      setScan(data);
    } catch { /* retry */ }
  }, [scanId]);

  useEffect(() => {
    if (!scanId) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [scanId, fetchStatus]);

  useEffect(() => {
    if (!scan || scan.status === "complete" || scan.status === "failed") return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [scan]);

  // Rotate clone messages
  useEffect(() => {
    if (scan?.status !== "cloning" && scan?.status !== "pending") return;
    const timer = setInterval(() => setCloneMessage((m) => (m + 1) % STATUS_MESSAGES.length), 2000);
    return () => clearInterval(timer);
  }, [scan?.status]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      const el = terminalRef.current;
      const curModules = JSON.stringify(scan?.modules?.map(m => m.status));
      if (curModules !== prevModulesRef.current) {
        el.scrollTop = el.scrollHeight;
        prevModulesRef.current = curModules;
      }
    }
  }, [scan?.modules]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  };

  const isComplete = scan?.status === "complete";
  const isFailed = scan?.status === "failed";
  const isRunning = !isComplete && !isFailed;

  if (!scanId) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center px-6">
        <p className="text-muted">No scan ID provided.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg px-6 py-12 relative overflow-hidden">
      {/* Background scan line while running */}
      {isRunning && <div className="scan-line" />}

      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000"
        style={{
          background: isComplete
            ? "rgba(34, 197, 94, 0.08)"
            : isFailed
            ? "rgba(239, 68, 68, 0.08)"
            : "rgba(99, 102, 241, 0.08)",
        }}
      />

      <div className="max-w-3xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-6">
          {/* Status badge */}
          <div
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full border text-sm font-medium mb-5 ${
              isComplete
                ? "border-success/30 bg-success/10 text-success"
                : isFailed
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-accent/30 bg-accent/5 text-accent-light"
            }`}
          >
            {isComplete ? (
              <span className="w-2.5 h-2.5 rounded-full bg-success" />
            ) : isFailed ? (
              <span className="w-2.5 h-2.5 rounded-full bg-danger" />
            ) : (
              <span className="w-2.5 h-2.5 rounded-full bg-accent-light animate-pulse" />
            )}
            {isComplete ? "Scan Complete" : isFailed ? "Scan Failed" : "Scanning in Progress"}
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {isComplete ? (
              <span className="celebrate inline-block">
                {(scan?.totalIssues || 0) === 0 ? (
                  <span className="text-success">All Clear. Code is Clean.</span>
                ) : (
                  <>
                    Found <span className="text-danger">{scan?.totalIssues}</span> Issue{(scan?.totalIssues || 0) > 1 ? "s" : ""}.
                    {(scan?.totalFixed || 0) > 0 && (
                      <> Fixed <span className="text-success">{scan?.totalFixed}</span>.</>
                    )}
                  </>
                )}
              </span>
            ) : isFailed ? (
              <span className="text-danger">Scan Failed</span>
            ) : (
              <>
                Scanning<span className="cursor-blink"></span>
              </>
            )}
          </h1>

          {scan?.repoUrl && (
            <p className="text-sm text-muted font-mono bg-surface/50 inline-block px-3 py-1 rounded">
              {scan.repoUrl}
            </p>
          )}
        </div>

        {/* Big progress section */}
        <div className="mb-6">
          {/* Stats row */}
          <div className="flex justify-between items-center text-sm mb-2">
            <span className="text-muted">
              Module {scan?.completedModules || 0} of {scan?.totalModules || 21}
            </span>
            <span className="font-mono text-accent-light text-lg font-bold">
              {Math.round(scan?.progress || 0)}%
            </span>
            <span className="text-muted font-mono">{formatTime(elapsed)}</span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-4 bg-surface border border-border rounded-full overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out relative ${
                isRunning ? "progress-glow" : ""
              }`}
              style={{
                width: `${scan?.progress || 0}%`,
                background: isComplete
                  ? "linear-gradient(90deg, #22c55e, #4ade80)"
                  : isFailed
                  ? "linear-gradient(90deg, #ef4444, #f87171)"
                  : "linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)",
              }}
            >
              {/* Shimmer on progress bar while running */}
              {isRunning && (
                <div
                  className="absolute inset-0 opacity-30"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)",
                    animation: "shimmer 1.5s linear infinite",
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Clone phase message */}
        {(scan?.status === "cloning" || scan?.status === "pending") && (
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-lg bg-surface border border-border">
              <div className="radar-sweep w-5 h-5 border-2 border-accent-light/30 border-t-accent-light rounded-full" />
              <span className="text-sm text-muted">{STATUS_MESSAGES[cloneMessage]}</span>
            </div>
          </div>
        )}

        {/* Auto-fix banner */}
        {scan?.status === "fixing" && (
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-3 px-5 py-3 rounded-lg bg-success/10 border border-success/20">
              <span className="text-success text-lg animate-pulse">&#9881;</span>
              <span className="text-sm text-success font-medium">
                Applying auto-fixes to your code...
              </span>
            </div>
          </div>
        )}

        {/* Terminal — the main show */}
        <div className="terminal mb-6 relative">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-3 text-xs text-muted font-mono">
              gatetest --suite {scan?.tier || "full"}{" "}
              {(scan?.tier === "fix" || scan?.tier === "nuclear") ? "--fix " : ""}
              --sarif --junit
            </span>
            {isRunning && (
              <span className="ml-auto text-xs text-accent-light animate-pulse">LIVE</span>
            )}
          </div>

          {/* Scan line across terminal while running */}
          {isRunning && <div className="terminal-scan-line" />}

          <div
            ref={terminalRef}
            className="p-5 font-mono text-sm max-h-[450px] overflow-y-auto space-y-0.5 relative"
          >
            {/* Header */}
            <p className="text-accent-light font-bold text-xs tracking-widest">
              ══════════════════════════════════════
            </p>
            <p className="text-accent-light font-bold">
              {"  "}GATETEST — Quality Assurance Gate
            </p>
            <p className="text-accent-light font-bold text-xs tracking-widest">
              ══════════════════════════════════════
            </p>
            <p className="text-muted text-xs mt-1 mb-3">
              {"  "}
              {scan?.tier === "quick" ? "Quick scan: 4 modules" :
               scan?.tier === "nuclear" ? "Nuclear: 21 modules + crawl + mutation + AI review" :
               scan?.tier === "fix" ? "Full scan + auto-fix: 21 modules" :
               "Full scan: 21 modules"}
            </p>

            {/* Module lines */}
            {(scan?.modules || []).map((mod, idx) => {
              const info = MODULE_INFO[mod.name] || { desc: "Scanning...", icon: "?" };
              const justChanged = mod.status === "passed" || mod.status === "failed";

              return (
                <div
                  key={mod.name}
                  className={`flex items-center gap-3 py-1.5 px-2 rounded transition-all duration-300 ${
                    mod.status === "running" ? "module-running" :
                    justChanged && mod.status === "passed" ? "flash-pass" :
                    justChanged && mod.status === "failed" ? "flash-fail" :
                    ""
                  } ${mod.status !== "pending" ? "slide-in" : "opacity-40"}`}
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <StatusIcon status={mod.status} />

                  <span className="text-xs font-mono text-muted/50 w-8">{info.icon}</span>

                  <span className={`font-medium ${
                    mod.status === "running" ? "text-foreground" :
                    mod.status === "passed" ? "text-success/80" :
                    mod.status === "failed" ? "text-danger" :
                    "text-muted/40"
                  }`}>
                    {mod.name}
                  </span>

                  <span className="flex-1" />

                  {mod.status === "running" && (
                    <span className="text-xs text-accent-light animate-pulse truncate max-w-[200px]">
                      {info.desc}
                    </span>
                  )}
                  {mod.status === "passed" && (
                    <span className="text-xs text-muted">
                      {mod.checks && <span>{mod.checks} checks</span>}
                      {mod.duration && <span> &middot; {mod.duration}ms</span>}
                    </span>
                  )}
                  {mod.status === "failed" && (
                    <span className="text-xs text-danger font-medium">
                      {mod.issues} issue{(mod.issues || 0) > 1 ? "s" : ""}
                    </span>
                  )}
                  {mod.status === "warning" && (
                    <span className="text-xs text-yellow-400">
                      {mod.message || "warnings"}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Completion */}
            {isComplete && (
              <div className="mt-4 pt-3 border-t border-[#30363d] celebrate">
                <p className="text-accent-light font-bold text-xs tracking-widest">
                  ──────────────────────────────────────
                </p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-2xl">
                    {(scan?.totalIssues || 0) === 0 ? (
                      <span className="text-success px-3 py-1 bg-success/10 rounded-lg font-bold text-sm">
                        GATE: PASSED
                      </span>
                    ) : (
                      <span className="text-danger px-3 py-1 bg-danger/10 rounded-lg font-bold text-sm">
                        GATE: {scan?.totalIssues} ISSUES
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-muted text-xs mt-2">
                  {"  "}{scan?.completedModules}/{scan?.totalModules} modules
                  {" "}&middot; {scan?.totalIssues} issues
                  {(scan?.totalFixed || 0) > 0 && ` · ${scan?.totalFixed} auto-fixed`}
                  {" "}&middot; {formatTime(elapsed)}
                </p>
              </div>
            )}

            {isFailed && (
              <div className="mt-4 pt-3 border-t border-[#30363d]">
                <p className="text-danger font-bold">
                  {"  "}ERROR: {scan?.error || "Scan failed"}
                </p>
                <p className="text-muted text-xs mt-1">
                  {"  "}Card hold released. No charge.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Live stats dashboard */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          <div className={`text-center p-4 rounded-xl border border-border bg-surface transition-all ${isRunning ? "hover:border-accent/30" : ""}`}>
            <div className="text-3xl font-bold gradient-text">
              <AnimatedNumber value={scan?.completedModules || 0} />
            </div>
            <div className="text-xs text-muted mt-1">Modules</div>
          </div>
          <div className={`text-center p-4 rounded-xl border transition-all ${
            (scan?.totalIssues || 0) > 0 ? "border-danger/30 bg-danger/5" : "border-border bg-surface"
          }`}>
            <div className="text-3xl font-bold text-danger">
              <AnimatedNumber value={scan?.totalIssues || 0} />
            </div>
            <div className="text-xs text-muted mt-1">Issues</div>
          </div>
          <div className={`text-center p-4 rounded-xl border transition-all ${
            (scan?.totalFixed || 0) > 0 ? "border-success/30 bg-success/5" : "border-border bg-surface"
          }`}>
            <div className="text-3xl font-bold text-success">
              <AnimatedNumber value={scan?.totalFixed || 0} />
            </div>
            <div className="text-xs text-muted mt-1">Fixed</div>
          </div>
          <div className="text-center p-4 rounded-xl border border-border bg-surface">
            <div className="text-3xl font-bold text-foreground font-mono">
              {formatTime(elapsed)}
            </div>
            <div className="text-xs text-muted mt-1">Time</div>
          </div>
        </div>

        {/* Completion actions */}
        {isComplete && (
          <div className="celebrate">
            {/* Success banner */}
            <div className={`text-center p-6 rounded-xl border mb-6 ${
              (scan?.totalIssues || 0) === 0
                ? "border-success/30 bg-success/5"
                : "border-accent/30 bg-accent/5"
            }`}>
              <p className="text-lg font-bold mb-1">
                {(scan?.totalIssues || 0) === 0
                  ? "Your code passed all checks."
                  : `Found ${scan?.totalIssues} issues across ${scan?.completedModules} modules.`}
              </p>
              {(scan?.totalFixed || 0) > 0 && (
                <p className="text-sm text-success">
                  {scan?.totalFixed} issues were automatically fixed. Check your repo for the PR.
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {scan?.reportUrl && (
                <a
                  href={scan.reportUrl}
                  className="px-8 py-4 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm transition-all pulse-glow"
                >
                  Download Full Report
                </a>
              )}
              <a
                href="/#pricing"
                className="px-8 py-4 rounded-xl border border-border hover:border-accent/50 text-foreground font-semibold text-sm transition-colors"
              >
                Run Another Scan
              </a>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="text-center">
            <div className="p-6 rounded-xl border border-danger/30 bg-danger/5 mb-6">
              <p className="text-sm text-muted">
                Your card hold has been automatically released. No charge was made.
              </p>
            </div>
            <a
              href="/#pricing"
              className="px-8 py-4 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm transition-all"
            >
              Try Again
            </a>
          </div>
        )}

        {/* Payment notice */}
        {isRunning && (
          <p className="text-center text-xs text-muted mt-6">
            Your card is held, not charged. Payment captured only after scan delivery.
          </p>
        )}
      </div>
    </div>
  );
}
