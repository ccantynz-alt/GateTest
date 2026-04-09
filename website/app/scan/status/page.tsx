"use client";

import { useEffect, useState, useRef } from "react";

interface ModuleResult {
  name: string;
  status: "passed" | "failed" | "warning" | "pending" | "running";
  checks: number;
  issues: number;
  duration: number;
  details?: string[];
}

interface ScanResult {
  status: "complete" | "failed";
  modules: ModuleResult[];
  totalModules: number;
  completedModules: number;
  totalIssues: number;
  totalFixed: number;
  duration: number;
  repoUrl?: string;
  tier?: string;
  error?: string;
}

const MODULE_LABELS: Record<string, { desc: string; icon: string }> = {
  syntax: { desc: "Validating syntax across all source files", icon: "{ }" },
  lint: { desc: "Running linting checks", icon: "~~" },
  secrets: { desc: "Hunting for hardcoded API keys & tokens", icon: "***" },
  codeQuality: { desc: "Analysing code quality & complexity", icon: "<>" },
  unitTests: { desc: "Running unit test suite", icon: "T" },
  integrationTests: { desc: "Checking API endpoints", icon: "API" },
  e2e: { desc: "Running end-to-end tests", icon: "E2E" },
  visual: { desc: "Detecting visual regressions", icon: "EYE" },
  accessibility: { desc: "Auditing WCAG 2.2 AAA", icon: "A11Y" },
  performance: { desc: "Measuring Core Web Vitals", icon: "ms" },
  security: { desc: "OWASP deep scan", icon: "!!!" },
  seo: { desc: "Validating SEO & metadata", icon: "SEO" },
  links: { desc: "Checking all links", icon: "URL" },
  compatibility: { desc: "Browser compatibility check", icon: "CSS" },
  dataIntegrity: { desc: "Migration & PII checks", icon: "DB" },
  documentation: { desc: "Checking docs completeness", icon: "DOC" },
  liveCrawler: { desc: "Crawling live site", icon: "WEB" },
  explorer: { desc: "Testing interactive elements", icon: "BOT" },
  chaos: { desc: "Chaos & resilience testing", icon: "ZAP" },
  mutation: { desc: "Mutation testing", icon: "DNA" },
  aiReview: { desc: "AI code review with Claude", icon: "AI" },
};

function StatusIcon({ status }: { status: string }) {
  if (status === "passed") return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-success/20 text-success text-xs font-bold">&#10003;</span>;
  if (status === "failed") return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-danger/20 text-danger text-xs font-bold">&#10007;</span>;
  if (status === "running") return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent/20"><span className="w-2 h-2 rounded-full bg-accent-light animate-pulse" /></span>;
  return <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-light/50 text-muted/30 text-xs">&#9675;</span>;
}

export default function ScanStatus() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [animModules, setAnimModules] = useState<ModuleResult[]>([]);
  const [animIndex, setAnimIndex] = useState(0);
  const startTimeRef = useRef(Date.now());
  const scanTriggered = useRef(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Get params from URL
  const [params, setParams] = useState<{ id: string; repo: string; tier: string }>({ id: "", repo: "", tier: "quick" });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({
      id: sp.get("session_id") || sp.get("id") || "",
      repo: sp.get("repo") || decodeURIComponent(sp.get("repo_url") || ""),
      tier: sp.get("tier") || "quick",
    });
  }, []);

  // Timer
  useEffect(() => {
    if (!scanning) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [scanning]);

  // Setup animation modules
  useEffect(() => {
    if (!params.tier) return;
    const names = params.tier === "quick"
      ? ["syntax", "lint", "secrets", "codeQuality"]
      : ["syntax", "lint", "secrets", "codeQuality", "unitTests", "integrationTests",
         "e2e", "visual", "accessibility", "performance", "security", "seo", "links",
         "compatibility", "dataIntegrity", "documentation", "mutation", "aiReview"];
    setAnimModules(names.map((n) => ({ name: n, status: "pending" as const, checks: 0, issues: 0, duration: 0 })));
  }, [params.tier]);

  // Animate modules one by one
  useEffect(() => {
    if (!scanning || animModules.length === 0 || scanResult) return;
    const t = setInterval(() => {
      setAnimIndex((prev) => {
        const next = prev + 1;
        if (next >= animModules.length) return prev; // Stop at last one
        setAnimModules((mods) =>
          mods.map((m, i) => ({
            ...m,
            status: i < next ? "passed" : i === next ? "running" : "pending",
            checks: i < next ? 5 + i * 3 : 0,
            duration: i < next ? 80 + i * 40 : 0,
          }))
        );
        return next;
      });
    }, 1200);
    return () => clearInterval(t);
  }, [scanning, animModules.length, scanResult]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [animIndex, scanResult]);

  // TRIGGER THE SCAN — one call, one response
  useEffect(() => {
    if (scanTriggered.current) return;

    // If we don't have the repo URL yet, try fetching it from the session
    if (!params.repo && params.id) {
      fetch(`/api/scan/status?id=${params.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.repoUrl) {
            setParams((p) => ({ ...p, repo: data.repoUrl, tier: data.tier || p.tier }));
          } else {
            setScanResult({
              status: "failed", modules: [], totalModules: 0, completedModules: 0,
              totalIssues: 0, totalFixed: 0, duration: 0, error: "No repository URL found for this session",
            });
            setScanning(false);
          }
        })
        .catch(() => {
          setScanResult({
            status: "failed", modules: [], totalModules: 0, completedModules: 0,
            totalIssues: 0, totalFixed: 0, duration: 0, error: "Could not load scan session",
          });
          setScanning(false);
        });
      return;
    }

    if (!params.repo) return;
    scanTriggered.current = true;

    fetch("/api/scan/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: params.id, repoUrl: params.repo, tier: params.tier }),
    })
      .then((res) => res.json())
      .then((data) => {
        setScanResult(data);
        setScanning(false);
      })
      .catch((err) => {
        setScanResult({
          status: "failed", modules: [], totalModules: 0, completedModules: 0,
          totalIssues: 0, totalFixed: 0, duration: 0, error: err.message,
        });
        setScanning(false);
      });
  }, [params]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
  };

  const isComplete = scanResult?.status === "complete";
  const isFailed = scanResult?.status === "failed";
  const displayModules = scanResult ? scanResult.modules : animModules;
  const displayProgress = scanResult ? 100 : Math.min(Math.round((animIndex / Math.max(animModules.length, 1)) * 95) + 5, 95);

  return (
    <div className="min-h-screen grid-bg px-6 py-12 relative overflow-hidden">
      {scanning && <div className="scan-line" />}

      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000"
        style={{ background: isComplete ? "rgba(34,197,94,0.08)" : isFailed ? "rgba(239,68,68,0.08)" : "rgba(99,102,241,0.08)" }} />

      <div className="max-w-3xl mx-auto relative z-10">
        {/* Header */}
        <div className="text-center mb-6">
          <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full border text-sm font-medium mb-5 ${
            isComplete ? "border-success/30 bg-success/10 text-success" :
            isFailed ? "border-danger/30 bg-danger/10 text-danger" :
            "border-accent/30 bg-accent/5 text-accent-light"
          }`}>
            {isComplete ? <span className="w-2.5 h-2.5 rounded-full bg-success" /> :
             isFailed ? <span className="w-2.5 h-2.5 rounded-full bg-danger" /> :
             <span className="w-2.5 h-2.5 rounded-full bg-accent-light animate-pulse" />}
            {isComplete ? "Scan Complete" : isFailed ? "Scan Failed" : "Scanning in Progress"}
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {isComplete ? (
              <span className="celebrate inline-block">
                {(scanResult?.totalIssues || 0) === 0 ? <span className="text-success">All Clear</span> :
                  <>{scanResult?.totalIssues} Issue{(scanResult?.totalIssues || 0) > 1 ? "s" : ""} Found</>}
              </span>
            ) : isFailed ? <span className="text-danger">Scan Failed</span> :
              <>Scanning<span className="cursor-blink" /></>}
          </h1>

          {params.repo && <p className="text-sm text-muted font-mono bg-surface/50 inline-block px-3 py-1 rounded">{params.repo}</p>}
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between items-center text-sm mb-2">
            <span className="text-muted">{scanResult ? `${scanResult.completedModules} modules complete` : `Module ${animIndex + 1} of ${animModules.length}`}</span>
            <span className="font-mono text-accent-light text-lg font-bold">{displayProgress}%</span>
            <span className="text-muted font-mono">{formatTime(elapsed)}</span>
          </div>
          <div className="w-full h-4 bg-surface border border-border rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ease-out ${scanning ? "progress-glow" : ""}`}
              style={{
                width: `${displayProgress}%`,
                background: isComplete ? "linear-gradient(90deg,#22c55e,#4ade80)" :
                  isFailed ? "linear-gradient(90deg,#ef4444,#f87171)" :
                  "linear-gradient(90deg,#6366f1,#8b5cf6,#a78bfa)",
              }} />
          </div>
        </div>

        {/* Terminal */}
        <div className="terminal mb-6 relative">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-3 text-xs text-muted font-mono">gatetest --suite {params.tier} --sarif --junit</span>
            {scanning && <span className="ml-auto text-xs text-accent-light animate-pulse">LIVE</span>}
          </div>

          {scanning && <div className="terminal-scan-line" />}

          <div ref={terminalRef} className="p-5 font-mono text-sm max-h-[450px] overflow-y-auto space-y-0.5 relative">
            <p className="text-accent-light font-bold text-xs tracking-widest">══════════════════════════════════════</p>
            <p className="text-accent-light font-bold">{"  "}GATETEST — Quality Assurance Gate</p>
            <p className="text-accent-light font-bold text-xs tracking-widest">══════════════════════════════════════</p>
            <p className="text-muted text-xs mt-1 mb-3">{"  "}{params.tier === "quick" ? "Quick scan: 4 modules" : "Full scan: 18 modules"}</p>

            {displayModules.map((mod, idx) => {
              const info = MODULE_LABELS[mod.name] || { desc: "Scanning...", icon: "?" };
              return (
                <div key={mod.name}
                  className={`flex items-center gap-3 py-1.5 px-2 rounded transition-all duration-300 ${
                    mod.status === "running" ? "module-running" :
                    mod.status === "passed" ? "flash-pass" :
                    mod.status === "failed" ? "flash-fail" : ""
                  } ${mod.status !== "pending" ? "slide-in" : "opacity-40"}`}
                  style={{ animationDelay: `${idx * 50}ms` }}>
                  <StatusIcon status={mod.status} />
                  <span className="text-xs font-mono text-muted/50 w-8">{info.icon}</span>
                  <span className={`font-medium ${
                    mod.status === "running" ? "text-foreground" :
                    mod.status === "passed" ? "text-success/80" :
                    mod.status === "failed" ? "text-danger" : "text-muted/40"
                  }`}>{mod.name}</span>
                  <span className="flex-1" />
                  {mod.status === "running" && <span className="text-xs text-accent-light animate-pulse truncate max-w-[200px]">{info.desc}</span>}
                  {mod.status === "passed" && <span className="text-xs text-muted">{mod.checks} checks &middot; {mod.duration}ms</span>}
                  {mod.status === "failed" && <span className="text-xs text-danger font-medium">{mod.issues} issue{mod.issues > 1 ? "s" : ""}</span>}
                </div>
              );
            })}

            {/* Show issue details for failed modules */}
            {scanResult && scanResult.modules.filter((m) => m.status === "failed" && m.details).map((mod) => (
              <div key={`details-${mod.name}`} className="ml-10 mt-1 mb-2">
                {mod.details?.map((d, i) => (
                  <p key={i} className="text-xs text-danger/70">{"  "}&rarr; {d}</p>
                ))}
              </div>
            ))}

            {isComplete && (
              <div className="mt-4 pt-3 border-t border-[#30363d] celebrate">
                <p className="text-accent-light font-bold text-xs tracking-widest">──────────────────────────────────────</p>
                <div className="mt-2">
                  {(scanResult?.totalIssues || 0) === 0 ? (
                    <span className="text-success px-3 py-1 bg-success/10 rounded-lg font-bold text-sm">GATE: PASSED</span>
                  ) : (
                    <span className="text-danger px-3 py-1 bg-danger/10 rounded-lg font-bold text-sm">GATE: {scanResult?.totalIssues} ISSUES</span>
                  )}
                </div>
                <p className="text-muted text-xs mt-2">
                  {"  "}{scanResult?.completedModules}/{scanResult?.totalModules} modules &middot; {scanResult?.totalIssues} issues &middot; {scanResult?.duration}ms
                </p>
              </div>
            )}

            {isFailed && (
              <div className="mt-4 pt-3 border-t border-[#30363d]">
                <p className="text-danger font-bold">{"  "}ERROR: {scanResult?.error || "Scan failed"}</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-8">
          <div className="text-center p-4 rounded-xl border border-border bg-surface">
            <div className="text-3xl font-bold gradient-text">{scanResult?.completedModules || animIndex}</div>
            <div className="text-xs text-muted mt-1">Modules</div>
          </div>
          <div className={`text-center p-4 rounded-xl border ${(scanResult?.totalIssues || 0) > 0 ? "border-danger/30 bg-danger/5" : "border-border bg-surface"}`}>
            <div className="text-3xl font-bold text-danger">{scanResult?.totalIssues || 0}</div>
            <div className="text-xs text-muted mt-1">Issues</div>
          </div>
          <div className="text-center p-4 rounded-xl border border-border bg-surface">
            <div className="text-3xl font-bold text-success">{scanResult?.totalFixed || 0}</div>
            <div className="text-xs text-muted mt-1">Fixed</div>
          </div>
          <div className="text-center p-4 rounded-xl border border-border bg-surface">
            <div className="text-3xl font-bold text-foreground font-mono">{formatTime(elapsed)}</div>
            <div className="text-xs text-muted mt-1">Time</div>
          </div>
        </div>

        {isComplete && (
          <div className="celebrate space-y-6">
            {/* Result banner */}
            <div className={`p-6 rounded-xl border ${
              (scanResult?.totalIssues || 0) === 0
                ? "border-success/30 bg-success/5"
                : "border-danger/30 bg-danger/5"
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{(scanResult?.totalIssues || 0) === 0 ? "&#9989;" : "&#9888;&#65039;"}</span>
                <div>
                  <p className="text-xl font-bold">
                    {(scanResult?.totalIssues || 0) === 0
                      ? "Your code passed all checks"
                      : `${scanResult?.totalIssues} issue${(scanResult?.totalIssues || 0) > 1 ? "s" : ""} found in your code`}
                  </p>
                  <p className="text-sm text-muted">
                    {scanResult?.completedModules} modules scanned &middot; {scanResult?.duration}ms
                  </p>
                </div>
              </div>
            </div>

            {/* Issue breakdown by module */}
            {(scanResult?.totalIssues || 0) > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-bold">Issues Found</h3>
                {scanResult?.modules.filter((m) => m.status === "failed").map((mod) => (
                  <div key={`breakdown-${mod.name}`} className="p-4 rounded-xl border border-danger/20 bg-danger/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-danger font-bold text-sm">&#10007;</span>
                        <span className="font-semibold">{mod.name}</span>
                      </div>
                      <span className="text-xs text-danger font-medium px-2 py-1 bg-danger/10 rounded-full">
                        {mod.issues} issue{mod.issues > 1 ? "s" : ""}
                      </span>
                    </div>
                    {mod.details && mod.details.length > 0 && (
                      <ul className="space-y-1 mt-2">
                        {mod.details.map((detail, i) => (
                          <li key={i} className="text-sm text-muted flex items-start gap-2">
                            <span className="text-danger/60 mt-0.5 shrink-0">&rarr;</span>
                            <span className="font-mono text-xs">{detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Passed modules summary */}
            {scanResult && scanResult.modules.filter((m) => m.status === "passed").length > 0 && (
              <div className="p-4 rounded-xl border border-success/20 bg-success/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-success">&#10003;</span>
                  <span className="font-semibold text-sm">
                    {scanResult.modules.filter((m) => m.status === "passed").length} modules passed clean
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {scanResult.modules.filter((m) => m.status === "passed").map((mod) => (
                    <span key={mod.name} className="text-xs px-2 py-1 rounded-full bg-success/10 text-success/80 border border-success/20">
                      {mod.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* What to do next */}
            <div className="p-6 rounded-xl border border-accent/30 bg-accent/5">
              <h3 className="text-lg font-bold mb-3">What&apos;s Next?</h3>
              {(scanResult?.totalIssues || 0) > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    Your code has {scanResult?.totalIssues} issue{(scanResult?.totalIssues || 0) > 1 ? "s" : ""} that
                    {params.tier === "quick"
                      ? " were found in a Quick Scan (4 modules). A Full Scan checks 21 modules and finds even more."
                      : " need attention. Upgrade to Scan + Fix and we'll automatically create a PR that fixes them."}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {params.tier === "quick" && (
                      <a href="/#pricing" className="btn-primary px-6 py-3 text-sm text-center">
                        Upgrade to Full Scan — $99
                      </a>
                    )}
                    {params.tier !== "fix" && params.tier !== "nuclear" && (
                      <a href="/#pricing" className="btn-primary px-6 py-3 text-sm text-center">
                        Get Auto-Fix PR — $199
                      </a>
                    )}
                    <a href="/#pricing" className="btn-secondary px-6 py-3 text-sm text-center">
                      Run Another Scan
                    </a>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted">
                    {params.tier === "quick"
                      ? "Your code passed all Quick Scan checks. Want to go deeper? The Full Scan runs 21 modules including security, accessibility, and AI code review."
                      : "Your code is clean across all modules. Consider setting up continuous monitoring to keep it that way."}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {params.tier === "quick" && (
                      <a href="/#pricing" className="btn-primary px-6 py-3 text-sm text-center">
                        Run Full Scan — $99
                      </a>
                    )}
                    <a href="/#pricing" className="btn-secondary px-6 py-3 text-sm text-center">
                      {params.tier === "quick" ? "See All Plans" : "Run Another Scan"}
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Share / trust badge */}
            <div className="text-center text-xs text-muted pt-4">
              <p>Scanned by GateTest &middot; {scanResult?.completedModules} modules &middot; {new Date().toLocaleDateString()}</p>
              <p className="mt-1">gatetest.io — The most advanced QA gate for AI-generated code</p>
            </div>
          </div>
        )}
        {isFailed && (
          <div className="text-center">
            <div className="p-6 rounded-xl border border-danger/30 bg-danger/5 mb-6">
              <p className="text-sm text-muted">Card hold released. No charge.</p>
            </div>
            <a href="/#pricing" className="px-8 py-4 rounded-xl bg-accent hover:bg-accent-light text-white font-semibold text-sm transition-all inline-block">Try Again</a>
          </div>
        )}

        {scanning && <p className="text-center text-xs text-muted mt-6">Card held, not charged. Payment captured only after scan delivery.</p>}
      </div>
    </div>
  );
}
