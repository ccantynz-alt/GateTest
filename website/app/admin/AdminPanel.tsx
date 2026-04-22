"use client";

import { useState, useEffect, useCallback } from "react";
import LiveScanTerminal from "@/app/components/LiveScanTerminal";
import CountUp from "@/app/components/CountUp";

interface FailedFile {
  file: string;
  issues: string[];
  reason: string;
}

interface FixResult {
  status: string;
  prUrl?: string;
  prNumber?: number;
  filesFixed?: number;
  issuesFixed?: number;
  message?: string;
  error?: string;
  errors?: string[];
  failedFiles?: FailedFile[];
}

interface AdminPanelProps {
  adminLogin: string;
}

interface ScanRecord {
  id: string;
  session_id: string;
  customer_email: string | null;
  repo_url: string;
  tier: string;
  status: string;
  score: number | null;
  duration_ms: number | null;
  tier_price_usd: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CustomerRecord {
  id: string;
  email: string;
  github_login: string | null;
  stripe_customer_id: string | null;
  total_scans: number;
  total_spent_usd: string;
  created_at: string;
}

interface Stats {
  total_scans: number;
  completed_scans: number;
  failed_scans: number;
  total_revenue: string | number;
  avg_score: number;
  avg_duration_ms: number;
  total_customers: number;
}

interface DbData {
  scans: ScanRecord[];
  customers: CustomerRecord[];
  stats: Stats;
  note?: string;
}

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  name: string;
  customer_email: string | null;
  tier_allowed: string;
  rate_limit_per_hour: number;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  total_calls: number;
}

interface NewKeyResult {
  id: string;
  name: string;
  prefix: string;
  tier_allowed: string;
  rate_limit_per_hour: number;
  plaintext_key: string;
}

export default function AdminPanel({ adminLogin }: AdminPanelProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [tier, setTier] = useState("quick");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<FixResult | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const [guidance, setGuidance] = useState<Array<{ module: string; detail: string; title: string; why: string; steps: string[]; commands?: string[] }> | null>(null);
  const [dbData, setDbData] = useState<DbData | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"scan" | "server" | "nuclear" | "watchdog" | "scans" | "customers" | "keys">("scan");
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[] | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyCustomer, setKeyCustomer] = useState("");
  const [keyTier, setKeyTier] = useState<"quick" | "full">("quick");
  const [keyRate, setKeyRate] = useState(60);
  const [newKey, setNewKey] = useState<NewKeyResult | null>(null);
  const [keyError, setKeyError] = useState("");

  const loadDbData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) {
        const data = await res.json();
        setDbData(data);
      }
    } catch {
      // DB not available yet — that's fine
    } finally {
      setDbLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch {
      // db not ready — surface as empty
      setApiKeys([]);
    }
  }, []);

  useEffect(() => {
    loadDbData();
  }, [loadDbData]);

  useEffect(() => {
    if (activeTab === "keys") loadKeys();
  }, [activeTab, loadKeys]);

  async function createKey() {
    setKeyError("");
    setNewKey(null);
    if (!keyName.trim()) {
      setKeyError("Name required");
      return;
    }
    try {
      const res = await fetch("/api/admin/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName.trim(),
          customer_email: keyCustomer.trim() || undefined,
          tier_allowed: keyTier,
          rate_limit_per_hour: keyRate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setKeyError(data.error || "Failed to create key");
        return;
      }
      setNewKey(data);
      setKeyName("");
      setKeyCustomer("");
      loadKeys();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to create key");
    }
  }

  async function revokeKey(id: string) {
    if (!confirm(`Revoke key ${id}? This cannot be undone.`)) return;
    try {
      await fetch(`/api/admin/keys?revoke=${encodeURIComponent(id)}`, {
        method: "POST",
      });
      loadKeys();
    } catch {
      /* ignore — loadKeys will reflect reality */
    }
  }

  function runScan() {
    if (!repoUrl.includes("github.com")) {
      setError("Enter a valid GitHub repo URL");
      return;
    }
    setScanning(true);
    setResult(null);
    setFixResult(null);
    setGuidance(null);
    setError("");
  }

  async function fixIssues() {
    if (!result || !repoUrl) return;
    const failedMods = modules.filter((m) => (m.status as string) === "failed");

    // Parse issues aggressively — extract file paths from multiple formats
    const issues = failedMods.flatMap((m) => {
      const details = (m.details as string[]) || [];
      return details.map((d) => {
        // Format 1: "path/to/file.js:42: message" or "path/to/file.js: message"
        let file = "";
        let issue = d;
        let line: number | undefined;

        const fileLineMatch = d.match(/^([\w./\-@+]+?\.[\w]{1,8}):(\d+)(?::\d+)?(?:\s*[-—:]\s*|\s+)(.+)$/);
        if (fileLineMatch) {
          file = fileLineMatch[1];
          line = Number(fileLineMatch[2]);
          issue = fileLineMatch[3];
        } else {
          const fileOnly = d.match(/^([\w./\-@+]+?\.[\w]{1,8})\s*[:—-]\s*(.+)$/);
          if (fileOnly) { file = fileOnly[1]; issue = fileOnly[2]; }
        }

        // Format 2: "Missing <filename>" → treat as create-file issue
        const missingMatch = d.match(/(?:missing|no|needs)\s+([.\w/\-]+\.(?:md|json|yml|yaml|toml|gitignore|env|example))/i);
        if (!file && missingMatch) {
          file = missingMatch[1].toLowerCase() === "gitignore" ? ".gitignore" : missingMatch[1];
          issue = `CREATE_FILE: ${d}`;
        }

        return { file, issue, module: m.name as string, line };
      });
    });

    const fixable = issues.filter((i) => i.file);
    const unfixable = issues.filter((i) => !i.file);

    if (fixable.length === 0) {
      setError(`No auto-fixable issues. ${unfixable.length} issue(s) need manual review (config, infrastructure, or architectural changes).`);
      return;
    }

    if (unfixable.length > 0) {
      // eslint-disable-next-line no-console
      console.info(`[GateTest] ${fixable.length} auto-fixable, ${unfixable.length} need manual review`);
    }

    setFixing(true);
    setFixResult(null);
    setError("");

    try {
      const res = await fetch("/api/scan/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, issues }),
      });
      const data = await res.json() as FixResult;
      setFixResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally {
      setFixing(false);
    }
  }

  async function retryFailedFiles() {
    if (!fixResult?.failedFiles?.length || !repoUrl) return;
    // Replay the exact file-level issues that hit the API-unavailable path.
    // Each failedFile's `issues[]` entry is the same shape the first submission
    // used (free-form strings), so we re-pack them with the file pointer for
    // the fix route.
    const issues = fixResult.failedFiles.flatMap((ff) =>
      ff.issues.map((i) => ({ file: ff.file, issue: i, module: "retry" })),
    );

    setFixing(true);
    setError("");
    try {
      const res = await fetch("/api/scan/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, issues }),
      });
      const data = await res.json() as FixResult;
      setFixResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setFixing(false);
    }
  }

  async function initDb() {
    try {
      const res = await fetch("/api/db/init", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        loadDbData();
      } else {
        setError(data.error || "DB init failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "DB init failed");
    }
  }

  const modules = (result?.modules as Array<Record<string, unknown>>) || [];
  const totalIssues = (result?.totalIssues as number) || 0;
  const stats = dbData?.stats;

  return (
    <div className="min-h-screen bg-[#0a0a12] relative">
      {/* Ambient glow — top of page */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-gradient-to-b from-teal-500/10 to-transparent rounded-full blur-[100px] pointer-events-none" aria-hidden="true" />

      {/* Premium header with gradient accent bar */}
      <div className="relative border-b border-white/8 backdrop-blur-xl bg-[#0a0a12]/80 sticky top-0 z-30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent" aria-hidden="true" />
        <div className="px-6 py-5">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <span className="text-white font-bold text-lg font-[var(--font-mono)]">G</span>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0a0a12]">
                  <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-white tracking-tight">Command Center</h1>
                  <span className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">LIVE</span>
                </div>
                <p className="text-xs text-white/40 mt-0.5">
                  Signed in as <span className="font-mono text-emerald-400 font-semibold">{adminLogin}</span> &middot; All tiers unlocked
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/admin/health"
                className="group text-xs px-3.5 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 transition-all font-semibold flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 group-hover:animate-pulse" />
                Self-Test
              </a>
              <a href="/" className="text-xs text-white/40 hover:text-white/80 transition-colors font-medium">
                &larr; Site
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats bar — premium cards with gradient border on hover + counter-animation */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { value: `${stats.total_scans}`, label: "Total Scans", accent: "white" },
              { value: `${stats.total_customers}`, label: "Customers", accent: "white" },
              { value: `$${Number(stats.total_revenue || 0).toFixed(0)}`, label: "Revenue", accent: "emerald" },
              { value: `${stats.avg_score || 0}`, label: "Avg Score", accent: "white" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="group relative rounded-xl bg-white/[0.04] border border-white/8 p-4 text-center overflow-hidden transition-all hover:border-emerald-400/30 hover:bg-white/[0.06] hover:-translate-y-0.5"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/0 to-transparent group-hover:via-emerald-400/40 transition-all" aria-hidden="true" />
                <p className={`text-2xl font-bold tracking-tight ${stat.accent === "emerald" ? "text-emerald-400" : "text-white"}`}>
                  <CountUp value={stat.value} />
                </p>
                <p className="text-xs text-white/40 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tab navigation — dark themed, premium active indicator */}
        <div className="relative flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
          {(["scan", "server", "nuclear", "watchdog", "scans", "customers", "keys"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const isNuclear = tab === "nuclear";
            const label = tab === "scan"
              ? "Repo Scan"
              : tab === "server"
              ? "Server Scan"
              : tab === "nuclear"
              ? "☢ Nuclear"
              : tab === "watchdog"
              ? "Watchdog"
              : tab === "scans"
              ? "Recent Scans"
              : tab === "customers"
              ? "Customers"
              : "API Keys";
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`relative px-4 py-3 text-sm font-semibold transition-all whitespace-nowrap group ${
                  isActive
                    ? isNuclear ? "text-red-400" : "text-white"
                    : isNuclear ? "text-red-400/60 hover:text-red-400" : "text-white/40 hover:text-white/80"
                }`}
              >
                {label}
                {/* Active indicator — glowing bottom border */}
                {isActive && (
                  <span
                    className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full ${isNuclear ? "bg-red-400" : "bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400"} shadow-[0_0_8px_rgba(52,211,153,0.5)]`}
                    aria-hidden="true"
                  />
                )}
                {/* Hover glow (inactive only) */}
                {!isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-white/0 group-hover:bg-white/20 transition-all" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        {/* DB init notice */}
        {dbData?.note && (
          <div className="card p-4 mb-6 border-l-4 border-l-yellow-400">
            <p className="text-sm text-muted">{dbData.note}</p>
            <button onClick={initDb} className="btn-primary px-4 py-2 text-xs mt-2">
              Initialize Database
            </button>
          </div>
        )}

        {/* Tab: Run Scan — dark premium form */}
        {activeTab === "scan" && (
          <>
            <div className="relative rounded-2xl bg-white/[0.03] border border-white/8 p-6 mb-8 overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent" aria-hidden="true" />
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Scan a Repository</h2>
                  <p className="text-xs text-white/40 mt-0.5">Admin bypass — all tiers, no Stripe</p>
                </div>
                <span className="text-[10px] font-semibold tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">OWNER MODE</span>
              </div>
              <div className="grid sm:grid-cols-[1fr,auto,auto] gap-3">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-white placeholder:text-white/30 text-sm w-full font-[var(--font-mono)] focus:outline-none focus:border-emerald-400/60 focus:bg-white/[0.06] transition-all"
                />
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-white text-sm font-medium focus:outline-none focus:border-emerald-400/60 transition-all cursor-pointer"
                >
                  <option value="quick" className="bg-[#0a0a12]">Quick &middot; 4 modules</option>
                  <option value="full" className="bg-[#0a0a12]">Full &middot; 67 modules</option>
                  <option value="fix" className="bg-[#0a0a12]">Scan + Fix &middot; 67 modules + PR</option>
                  <option value="nuclear" className="bg-[#0a0a12]">☢ Nuclear &middot; Everything</option>
                </select>
                <button
                  onClick={runScan}
                  disabled={scanning}
                  className="px-6 py-3 text-sm font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all whitespace-nowrap"
                >
                  {scanning ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Scanning...
                    </span>
                  ) : "Run Scan"}
                </button>
              </div>
              {error && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-xs font-medium">{error}</p>
                </div>
              )}
            </div>

            {scanning && repoUrl && (
              <LiveScanTerminal
                repoUrl={repoUrl}
                tier={tier}
                onComplete={(data) => {
                  setResult(data);
                  setScanning(false);
                  loadDbData();
                  // Auto-fix: if issues found, automatically trigger fix
                  const issues = (data.totalIssues as number) || 0;
                  if (issues > 0) {
                    const mods = (data.modules as Array<Record<string, unknown>>) || [];
                    const failed = mods.filter((m) => (m.status as string) === "failed");
                    const fixable = failed.flatMap((m) => {
                      const details = (m.details as string[]) || [];
                      return details.map((d) => {
                        const fMatch = d.match(/^([\w./\-@+]+?\.[\w]{1,8})(?::(\d+))?(?:\s*[-—:]\s*|\s+)(.+)$/);
                        if (fMatch) return { file: fMatch[1], issue: fMatch[3], module: m.name as string };
                        const fOnly = d.match(/^([\w./\-@+]+?\.[\w]{1,8})\s*[:—-]\s*(.+)$/);
                        if (fOnly) return { file: fOnly[1], issue: fOnly[2], module: m.name as string };
                        const missing = d.match(/(?:missing|no|needs)\s+([.\w/\-]+\.(?:md|json|yml|yaml|toml|gitignore|env|example))/i);
                        if (missing) return { file: missing[1], issue: `CREATE_FILE: ${d}`, module: m.name as string };
                        return { file: "", issue: d, module: m.name as string };
                      });
                    }).filter((i) => i.file);

                    if (fixable.length > 0) {
                      setFixing(true);
                      fetch("/api/scan/fix", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ repoUrl, issues: fixable }),
                      })
                        .then((r) => r.json())
                        .then((d) => setFixResult(d as FixResult))
                        .catch((e) => setError(e instanceof Error ? e.message : "Fix failed"))
                        .finally(() => setFixing(false));
                    }
                  }
                }}
                onError={(err) => {
                  setError(err);
                  setScanning(false);
                }}
              />
            )}

            {result && !scanning && (
              <div className="space-y-4">
                <div className={`card p-6 ${totalIssues === 0 ? "border-success" : "border-accent"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">
                        {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                      </h2>
                      <p className="text-sm text-muted">
                        {modules.length} modules &middot; {result.duration as number}ms
                      </p>
                    </div>
                    <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                      totalIssues === 0 ? "bg-green-50 text-success" : "bg-amber-50 text-amber-700"
                    }`}>
                      {totalIssues === 0 ? "PASSED" : `${totalIssues} ISSUES`}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    <button onClick={runScan} className="btn-primary px-4 py-2 text-xs">
                      Re-scan
                    </button>
                    <button
                      onClick={() => {
                        const data = JSON.stringify({ repoUrl, tier, timestamp: new Date().toISOString(), ...result }, null, 2);
                        const blob = new Blob([data], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `gatetest-${repoUrl.split("/").pop()}-${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="btn-secondary px-4 py-2 text-xs"
                    >
                      Export JSON
                    </button>
                    {totalIssues > 0 && (
                      <>
                        {!fixResult && !fixing && (
                          <button
                            onClick={fixIssues}
                            disabled={fixing}
                            className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
                            style={{ background: "#059669" }}
                          >
                            Re-fix {totalIssues} Issues (AI + PR)
                          </button>
                        )}
                        {fixing && (
                          <span className="text-xs text-accent font-medium animate-pulse">AI fixing issues automatically...</span>
                        )}
                        <button
                          onClick={() => {
                            const failedMods = modules.filter((m) => (m.status as string) === "failed");
                            const issueText = failedMods.map((m) => {
                              const details = (m.details as string[]) || [];
                              return `## ${m.name} (${m.issues} issues)\n${details.map((d) => `- ${d}`).join("\n")}`;
                            }).join("\n\n");
                            navigator.clipboard.writeText(issueText);
                            setError("Issues copied to clipboard");
                            setTimeout(() => setError(""), 2000);
                          }}
                          className="btn-secondary px-4 py-2 text-xs"
                        >
                          Copy Issues
                        </button>
                        <button
                          onClick={async () => {
                            setGuidanceLoading(true);
                            setGuidance(null);
                            const failedModulesLocal = modules.filter((m) => (m.status as string) === "failed");
                            const allIssues = failedModulesLocal.flatMap((m) => {
                              const details = (m.details as string[]) || [];
                              return details.map((d) => ({ module: m.name as string, detail: d }));
                            });
                            try {
                              const res = await fetch("/api/scan/guidance", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ issues: allIssues }),
                              });
                              const data = await res.json();
                              setGuidance(data.guidance || []);
                            } catch {
                              setError("Could not generate guidance");
                            } finally {
                              setGuidanceLoading(false);
                            }
                          }}
                          disabled={guidanceLoading}
                          className="btn-secondary px-4 py-2 text-xs disabled:opacity-50"
                        >
                          {guidanceLoading ? "Generating..." : "Manual Fix Guide"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Manual guidance for unfixable issues */}
                {guidance && guidance.length > 0 && (
                  <div className="card p-5 mt-4 border-l-4 border-l-accent">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">Step-by-step fix guide ({guidance.length} issues)</h3>
                      <button
                        onClick={() => setGuidance(null)}
                        className="text-muted hover:text-foreground text-lg px-2"
                        aria-label="Close guide"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="space-y-4">
                      {guidance.map((g, i) => (
                        <div key={i} className="rounded-lg border border-border p-4 bg-gray-50">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xs font-mono text-accent font-bold">{g.module}</span>
                            <h4 className="font-semibold text-sm">{g.title}</h4>
                          </div>
                          <p className="text-xs text-muted mb-3">{g.why}</p>
                          <ol className="text-sm space-y-1 list-decimal list-inside">
                            {g.steps.map((s, j) => (
                              <li key={j} className="text-foreground">{s}</li>
                            ))}
                          </ol>
                          {g.commands && g.commands.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {g.commands.map((cmd, j) => (
                                <pre key={j} className="bg-[#0a0a12] text-emerald-400 text-xs font-mono p-2 rounded overflow-x-auto">{cmd}</pre>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fix result */}
                {fixing && (
                  <div className="card p-6 text-center">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="font-medium">AI is reading your code and generating fixes...</p>
                    <p className="text-xs text-muted mt-1">This may take 30-60 seconds depending on the number of issues</p>
                  </div>
                )}

                {fixResult && (
                  <div className={`card p-5 ${fixResult.prUrl ? "border-success" : "border-accent"}`}>
                    {fixResult.prUrl ? (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-success text-lg">&#10003;</span>
                          <h3 className="font-bold">Pull Request Created</h3>
                        </div>
                        <p className="text-sm text-muted mb-3">
                          Fixed <strong>{fixResult.issuesFixed} issues</strong> across {fixResult.filesFixed} files
                          {totalIssues > (fixResult.issuesFixed || 0) && (
                            <> — <strong>{totalIssues - (fixResult.issuesFixed || 0)} remaining</strong> need manual review (not auto-fixable)</>
                          )}.
                        </p>
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 mb-3">
                          <strong>Important:</strong> Fixes are on a new branch &mdash; <strong>main still has all {totalIssues} issues</strong> until you merge the PR. Re-scanning main will show the same issues. After merging, re-scan to verify.
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={fixResult.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-primary px-4 py-2 text-xs"
                            style={{ background: "#059669" }}
                          >
                            View PR on GitHub &rarr;
                          </a>
                          {fixResult.prUrl && (
                            <button
                              onClick={() => {
                                // Scan the fix branch to verify
                                const prUrl = fixResult.prUrl || "";
                                const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
                                if (match) {
                                  window.open(
                                    `${prUrl}/files`,
                                    "_blank"
                                  );
                                }
                              }}
                              className="btn-secondary px-4 py-2 text-xs"
                            >
                              View Changes
                            </button>
                          )}
                        </div>
                      </>
                    ) : fixResult.status === "api_unavailable" ? (
                      <>
                        <p className="font-semibold text-warning text-sm">Anthropic API Temporarily Degraded</p>
                        <p className="text-sm text-muted mt-1">{fixResult.message}</p>
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-muted">
                              <strong className="text-foreground">{fixResult.failedFiles.length}</strong> file{fixResult.failedFiles.length !== 1 ? "s" : ""} queued for retry
                            </p>
                            <button
                              onClick={retryFailedFiles}
                              disabled={fixing}
                              className="btn-primary px-4 py-2 text-xs font-semibold"
                            >
                              {fixing ? "Retrying..." : "Retry Failed"}
                            </button>
                          </div>
                        )}
                      </>
                    ) : fixResult.status === "no_fixes" ? (
                      <>
                        <p className="text-sm text-muted">{fixResult.message || "No fixes could be generated"}</p>
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-muted">{fixResult.failedFiles.length} network failure{fixResult.failedFiles.length !== 1 ? "s" : ""}</p>
                            <button
                              onClick={retryFailedFiles}
                              disabled={fixing}
                              className="btn-primary px-4 py-2 text-xs font-semibold"
                            >
                              {fixing ? "Retrying..." : "Retry Failed"}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-accent">{fixResult.error || "Fix partially completed"}</p>
                        {fixResult.errors && fixResult.errors.length > 0 && (
                          <ul className="mt-2 text-xs text-muted space-y-1">
                            {fixResult.errors.map((e, i) => <li key={i}>&rarr; {e}</li>)}
                          </ul>
                        )}
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3 pt-3 border-t border-border">
                            <p className="text-xs text-muted">
                              <strong className="text-foreground">{fixResult.failedFiles.length}</strong> additional file{fixResult.failedFiles.length !== 1 ? "s" : ""} failed with API errors
                            </p>
                            <button
                              onClick={retryFailedFiles}
                              disabled={fixing}
                              className="btn-secondary px-4 py-2 text-xs font-semibold"
                            >
                              {fixing ? "Retrying..." : "Retry Failed"}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {modules.map((mod) => {
                  const status = mod.status as string;
                  const details = (mod.details as string[]) || [];
                  return (
                    <div key={mod.name as string} className={`card p-4 ${
                      status === "failed" ? "border-l-4 border-l-danger" :
                      status === "passed" ? "border-l-4 border-l-success" : ""
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-bold ${
                            status === "passed" ? "text-success" : status === "failed" ? "text-danger" : "text-muted"
                          }`}>
                            {status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "SKIP"}
                          </span>
                          <span className="font-semibold text-sm">{mod.name as string}</span>
                        </div>
                        <div className="text-xs text-muted">
                          {mod.checks as number} checks &middot; {mod.issues as number} issues &middot; {mod.duration as number}ms
                        </div>
                      </div>
                      {details.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {details.map((d, i) => (
                            <li key={i} className="text-xs text-muted font-mono pl-14">
                              &rarr; {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Tab: Server Scan */}
        {activeTab === "server" && (
          <ServerScanPanel />
        )}

        {/* Tab: Nuclear Scan */}
        {activeTab === "nuclear" && (
          <NuclearScanPanel />
        )}

        {/* Tab: Recent Scans */}
        {activeTab === "scans" && (
          <div className="card overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-muted">Loading...</div>
            ) : !dbData?.scans?.length ? (
              <div className="p-8 text-center text-muted">No scans recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-solid">
                      <th className="text-left px-4 py-3 font-medium text-muted">Repo</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Tier</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Score</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.scans.map((scan) => (
                      <tr key={scan.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate">
                          {scan.repo_url?.replace("https://github.com/", "") || "-"}
                        </td>
                        <td className="px-4 py-3">{scan.tier}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                            scan.status === "completed" ? "bg-green-50 text-success" :
                            scan.status === "failed" ? "bg-red-50 text-danger" :
                            "bg-yellow-50 text-yellow-700"
                          }`}>
                            {scan.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{scan.score ?? "-"}</td>
                        <td className="px-4 py-3 text-xs">{scan.customer_email || "-"}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {scan.created_at ? new Date(scan.created_at).toLocaleDateString() : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: API Keys */}
        {activeTab === "keys" && (
          <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-lg font-bold mb-1">Issue an API key</h2>
              <p className="text-xs text-muted mb-4">
                For external platforms calling <code className="font-mono">POST /api/v1/scan</code>.
                The plaintext key is shown ONCE after creation — copy it immediately.
              </p>
              <div className="grid sm:grid-cols-[1fr,1fr,auto,auto,auto] gap-3">
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Key name (e.g. Platform A prod)"
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
                />
                <input
                  type="email"
                  value={keyCustomer}
                  onChange={(e) => setKeyCustomer(e.target.value)}
                  placeholder="customer@example.com (optional)"
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
                />
                <select
                  value={keyTier}
                  onChange={(e) => setKeyTier(e.target.value as "quick" | "full")}
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
                >
                  <option value="quick">quick</option>
                  <option value="full">full</option>
                </select>
                <input
                  type="number"
                  value={keyRate}
                  onChange={(e) => setKeyRate(Math.max(1, Number(e.target.value) || 60))}
                  placeholder="60"
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm w-24"
                />
                <button onClick={createKey} className="btn-primary px-6 py-3 text-sm">
                  Create Key
                </button>
              </div>
              {keyError && <p className="text-danger text-sm mt-3">{keyError}</p>}

              {newKey && (
                <div className="mt-4 p-4 border-l-4 border-l-green-500 bg-green-50/50 rounded">
                  <p className="text-sm font-bold text-green-800 mb-1">
                    Key created — copy it now, it will not be shown again.
                  </p>
                  <p className="text-xs text-green-800 mb-2">
                    <strong>{newKey.name}</strong> · tier {newKey.tier_allowed} ·{" "}
                    {newKey.rate_limit_per_hour}/hr
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs bg-white border border-green-200 rounded px-3 py-2 break-all">
                      {newKey.plaintext_key}
                    </code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(newKey.plaintext_key);
                      }}
                      className="btn-secondary px-3 py-2 text-xs"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-solid">
                      <th className="text-left px-4 py-3 font-medium text-muted">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Prefix</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Tier</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Rate/hr</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Calls</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Last used</th>
                      <th className="text-right px-4 py-3 font-medium text-muted">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys === null ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-muted">Loading...</td>
                      </tr>
                    ) : apiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-muted">
                          No keys issued yet. Create one above.
                        </td>
                      </tr>
                    ) : (
                      apiKeys.map((k) => (
                        <tr key={k.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">{k.name}</td>
                          <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}…</td>
                          <td className="px-4 py-3">{k.tier_allowed}</td>
                          <td className="px-4 py-3">{k.rate_limit_per_hour}</td>
                          <td className="px-4 py-3">{k.total_calls}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                              k.active ? "bg-green-50 text-success" : "bg-slate-100 text-slate-500"
                            }`}>
                              {k.active ? "active" : "revoked"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {k.active && (
                              <button
                                onClick={() => revokeKey(k.id)}
                                className="text-xs text-danger hover:underline"
                              >
                                revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-4 text-xs text-muted">
              Docs: <a href="/docs/api" className="text-accent hover:underline">/docs/api</a> ·
              Endpoint: <code className="font-mono">POST /api/v1/scan</code>
            </div>
          </div>
        )}

        {/* Tab: Customers */}
        {activeTab === "customers" && (
          <div className="card overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-muted">Loading...</div>
            ) : !dbData?.customers?.length ? (
              <div className="p-8 text-center text-muted">No customers yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-solid">
                      <th className="text-left px-4 py-3 font-medium text-muted">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">GitHub</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Scans</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Spent</th>
                      <th className="text-left px-4 py-3 font-medium text-muted">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.customers.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-xs">{c.email}</td>
                        <td className="px-4 py-3 font-mono text-xs">{c.github_login || "-"}</td>
                        <td className="px-4 py-3">{c.total_scans}</td>
                        <td className="px-4 py-3">${Number(c.total_spent_usd || 0).toFixed(0)}</td>
                        <td className="px-4 py-3 text-xs text-muted">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString() : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ServerFix {
  platform: string;
  title: string;
  code: string;
  instructions: string;
}

function ServerScanPanel() {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [generatingFixes, setGeneratingFixes] = useState(false);
  const [fixes, setFixes] = useState<Record<string, ServerFix[]> | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function runServerScan() {
    if (!url) { setError("Enter a URL"); return; }
    setScanning(true); setResult(null); setError(""); setFixes(null);
    try {
      const res = await fetch("/api/scan/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Scan failed"); return; }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally { setScanning(false); }
  }

  async function generateFixes() {
    if (!result) return;
    setGeneratingFixes(true);
    try {
      const res = await fetch("/api/scan/server-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: result.hostname, modules: result.modules }),
      });
      const data = await res.json();
      setFixes(data.fixes || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate fixes");
    } finally { setGeneratingFixes(false); }
  }

  function copyCode(code: string, id: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  const modules = (result?.modules as Array<Record<string, unknown>>) || [];
  const totalIssues = (result?.totalIssues as number) || 0;

  return (
    <>
      <div className="card p-6 mb-8">
        <p className="text-sm text-muted mb-3">Scan a live URL for SSL, security headers, DNS, and performance.</p>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runServerScan(); }}
            placeholder="https://example.com"
            className="flex-1 px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
          />
          <button onClick={runServerScan} disabled={scanning} className="btn-primary px-6 py-3 text-sm disabled:opacity-50">
            {scanning ? "Scanning..." : "Scan Server"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {scanning && (
        <div className="card p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Checking SSL, headers, DNS, performance...</p>
        </div>
      )}

      {result && !scanning && (
        <div className="space-y-4">
          <div className={`card p-6 ${totalIssues === 0 ? "border-l-4 border-l-green-500" : "border-l-4 border-l-amber-500"}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                </h2>
                <p className="text-sm text-muted">
                  {result.hostname as string} &middot; {modules.length} modules &middot; {result.duration as number}ms
                </p>
              </div>
              <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                totalIssues === 0 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
              }`}>
                {totalIssues === 0 ? "PASSED" : `${totalIssues} ISSUES`}
              </span>
            </div>
            {totalIssues > 0 && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={generateFixes}
                  disabled={generatingFixes}
                  className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
                  style={{ background: "#059669" }}
                >
                  {generatingFixes ? "Generating..." : `Generate Fixes`}
                </button>
                <button
                  onClick={runServerScan}
                  className="btn-secondary px-4 py-2 text-xs"
                >
                  Re-scan
                </button>
              </div>
            )}
          </div>

          {/* Generated fixes — ready-to-paste configs */}
          {fixes && Object.keys(fixes).length > 0 && (
            <div className="card p-5 border-l-4 border-l-accent">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-accent text-lg">⚡</span>
                <h3 className="font-bold">Ready-to-paste fixes</h3>
              </div>
              <div className="space-y-5">
                {Object.entries(fixes).map(([category, fixList]) => (
                  <div key={category}>
                    <h4 className="font-semibold text-sm text-foreground mb-2">{category}</h4>
                    <div className="space-y-3">
                      {fixList.map((f, idx) => {
                        const id = `${category}-${idx}`;
                        return (
                          <div key={id} className="rounded-lg border border-border bg-gray-50 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-white border-b border-border">
                              <div>
                                <div className="text-xs font-bold text-foreground">{f.platform}</div>
                                <div className="text-xs text-muted">{f.title}</div>
                              </div>
                              <button
                                onClick={() => copyCode(f.code, id)}
                                className="btn-secondary px-3 py-1 text-xs"
                              >
                                {copiedCode === id ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <pre className="p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">{f.code}</pre>
                            <p className="px-3 py-2 bg-amber-50 text-xs text-amber-800 border-t border-amber-100">
                              {f.instructions}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {fixes && Object.keys(fixes).length === 0 && (
            <div className="card p-5 border-l-4 border-l-amber-500">
              <p className="text-sm text-muted">
                No automated fixes available for these specific issues. They require manual review or infrastructure access.
              </p>
            </div>
          )}

          {modules.map((mod) => {
            const status = mod.status as string;
            const details = (mod.details as string[]) || [];
            return (
              <div key={mod.name as string} className={`card p-4 ${
                status === "passed" ? "border-l-4 border-l-green-500" :
                status === "warning" ? "border-l-4 border-l-amber-500" :
                "border-l-4 border-l-red-500"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{mod.label as string || mod.name as string}</span>
                  <span className={`text-xs font-bold ${
                    status === "passed" ? "text-green-600" : status === "warning" ? "text-amber-600" : "text-red-600"
                  }`}>
                    {status === "passed" ? "PASS" : status === "warning" ? "WARN" : "FAIL"}
                  </span>
                </div>
                {details.length > 0 && (
                  <ul className="space-y-1">
                    {details.map((d, i) => (
                      <li key={i} className={`text-xs font-mono ${
                        d.startsWith("error") ? "text-red-600" :
                        d.startsWith("warning") ? "text-amber-600" :
                        d.startsWith("pass") ? "text-green-600" :
                        "text-muted"
                      }`}>
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

interface NuclearFinding {
  category: string;
  severity: "error" | "warning" | "info" | "pass";
  title: string;
  detail: string;
}

function NuclearScanPanel() {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [fixResult, setFixResult] = useState<Record<string, unknown> | null>(null);

  async function runNuclear() {
    if (!url) { setError("Enter a URL"); return; }
    setScanning(true); setResult(null); setError(""); setFixResult(null);
    try {
      const res = await fetch("/api/scan/nuclear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Scan failed"); return; }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally { setScanning(false); }
  }

  async function fixEverything() {
    if (!result) return;
    setFixing(true);
    try {
      const issueFindings = (result.findings as NuclearFinding[] || [])
        .filter(f => f.severity === "error" || f.severity === "warning");

      // Try SSH auto-heal first (autonomous fix)
      const ip = result.resolvedIp as string || "";
      if (ip && issueFindings.length > 0) {
        try {
          const sshRes = await fetch("/api/heal/ssh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host: ip,
              hostname: result.hostname,
              issues: issueFindings.map(f => ({
                category: f.category,
                title: f.title,
                detail: f.detail,
              })),
            }),
          });
          const sshData = await sshRes.json();
          if (sshRes.ok && sshData.status !== "failed") {
            setFixResult(sshData);
            return;
          }
          // SSH failed (no credentials etc.) — fall through to config snippets
        } catch {
          // SSH agent not available — fall through
        }
      }

      // Fallback: generate config snippets
      const res = await fetch("/api/scan/server-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: result.hostname,
          modules: issueFindings.reduce((acc, f) => {
            const cat = f.category.toLowerCase().replace(/[^a-z]/g, "");
            const existing = acc.find((m) => m.name === cat);
            if (existing) { existing.details.push(`${f.severity}: ${f.title} - ${f.detail}`); }
            else { acc.push({ name: cat, status: "failed", details: [`${f.severity}: ${f.title} - ${f.detail}`] }); }
            return acc;
          }, [] as Array<{ name: string; status: string; details: string[] }>),
        }),
      });
      const data = await res.json();
      setFixResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fix failed");
    } finally { setFixing(false); }
  }

  const findings = (result?.findings as NuclearFinding[]) || [];
  const summary = result?.summary as { errors: number; warnings: number; passes: number; total: number } | undefined;
  const diagnosis = (result?.diagnosis as string[]) || [];

  return (
    <>
      <div className="card p-6 mb-6 border-l-4 border-l-red-500">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">☢</span>
          <div>
            <h3 className="font-bold text-lg">Nuclear Scan</h3>
            <p className="text-sm text-muted">Find <strong>anything</strong> and <strong>everything</strong> wrong with a domain. Full stack diagnosis — DNS, ports, SSL, headers, performance, availability, redirects, email auth. Root-cause pinpointed automatically.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runNuclear(); }}
            placeholder="https://crontech.ai"
            className="flex-1 px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
          />
          <button
            onClick={runNuclear}
            disabled={scanning}
            className="btn-primary px-6 py-3 text-sm font-bold disabled:opacity-50"
            style={{ background: "#dc2626" }}
          >
            {scanning ? "Nuking..." : "☢ Nuclear Scan"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {scanning && (
        <div className="card p-8 text-center">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-bold">Running full-stack diagnosis...</p>
          <p className="text-xs text-muted mt-1">DNS · Ports · SSL · Headers · Performance · Redirects · Email</p>
        </div>
      )}

      {result && !scanning && (
        <>
          {/* Diagnosis */}
          <div className="card p-6 mb-4 border-l-4 border-l-red-500">
            <h3 className="font-bold mb-3">Diagnosis</h3>
            {diagnosis.map((d, i) => (
              <p key={i} className={`text-sm mb-1 ${d.startsWith("ROOT CAUSE") ? "text-red-700 font-bold" : d.startsWith("FIX") ? "text-accent font-medium" : "text-foreground"}`}>
                {d}
              </p>
            ))}
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <div className="p-2 bg-red-50 rounded">
                <div className="text-2xl font-bold text-red-700">{summary?.errors ?? 0}</div>
                <div className="text-xs text-muted">Errors</div>
              </div>
              <div className="p-2 bg-amber-50 rounded">
                <div className="text-2xl font-bold text-amber-700">{summary?.warnings ?? 0}</div>
                <div className="text-xs text-muted">Warnings</div>
              </div>
              <div className="p-2 bg-green-50 rounded">
                <div className="text-2xl font-bold text-green-700">{summary?.passes ?? 0}</div>
                <div className="text-xs text-muted">Passes</div>
              </div>
              <div className="p-2 bg-gray-50 rounded">
                <div className="text-2xl font-bold">{summary?.total ?? 0}</div>
                <div className="text-xs text-muted">Total Checks</div>
              </div>
            </div>
            {(summary?.errors ?? 0) + (summary?.warnings ?? 0) > 0 && (
              <div className="mt-5">
                <button
                  onClick={fixEverything}
                  disabled={fixing}
                  className="btn-primary w-full py-4 text-base font-bold disabled:opacity-50"
                  style={{ background: "#059669" }}
                >
                  {fixing ? "Generating fix plan..." : "⚡ Fix Everything Automatically"}
                </button>
                <p className="text-xs text-muted text-center mt-2">
                  Generates ready-to-apply fixes for every issue found. Code fixes go to a PR; config fixes produce Vercel/Nginx/DNS snippets.
                </p>
              </div>
            )}
          </div>

          {/* Fixes */}
          {fixResult && (
            <div className="card p-5 mb-4 border-l-4 border-l-accent">
              {/* SSH auto-heal result */}
              {(fixResult as Record<string, unknown>).actions ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">{(fixResult as Record<string, unknown>).status === "healed" ? "✅" : "⚡"}</span>
                    <h3 className="font-bold">
                      {(fixResult as Record<string, unknown>).status === "healed"
                        ? "Server Healed"
                        : (fixResult as Record<string, unknown>).status === "partial"
                          ? "Partially Healed"
                          : "Heal Attempted"}
                    </h3>
                  </div>
                  <p className="text-sm text-muted mb-3">
                    {(fixResult as Record<string, unknown>).message as string}
                  </p>
                  <div className="space-y-2">
                    {((fixResult as Record<string, unknown>).actions as Array<{ issue: string; command: string; output: string; status: string }>).map((a, i) => (
                      <div key={i} className={`rounded-lg border p-3 text-xs ${
                        a.status === "fixed" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={a.status === "fixed" ? "text-green-600" : "text-red-600"}>
                            {a.status === "fixed" ? "✓" : "✗"}
                          </span>
                          <span className="font-medium">{a.issue}</span>
                        </div>
                        <pre className="font-mono text-xs bg-black/5 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{a.output || "(no output)"}</pre>
                      </div>
                    ))}
                  </div>
                </>
              ) : (fixResult as Record<string, unknown>).fixes && Object.keys((fixResult as Record<string, unknown>).fixes as Record<string, unknown>).length > 0 ? (
                <>
                  <h3 className="font-bold mb-3">⚡ Fixes generated</h3>
                  <p className="text-sm text-muted mb-3">
                    {((fixResult as Record<string, unknown>).totalFixes as number) || 0} fixes across {((fixResult as Record<string, unknown>).categories as number) || 0} categories.
                  </p>
                  <details className="text-xs font-mono bg-gray-50 p-3 rounded max-h-96 overflow-auto">
                    <summary className="cursor-pointer font-semibold">View all fix snippets</summary>
                    <pre className="mt-2 whitespace-pre-wrap">{JSON.stringify((fixResult as Record<string, unknown>).fixes, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <div>
                  <h3 className="font-bold mb-2">⚡ Fix attempted</h3>
                  <p className="text-sm text-muted">
                    To enable autonomous server repair, set these in Vercel env vars:
                  </p>
                  <ul className="text-xs font-mono text-muted mt-2 space-y-1">
                    <li>GATETEST_SSH_HOST — server IP (e.g. 45.76.171.37)</li>
                    <li>GATETEST_SSH_USER — username (default: root)</li>
                    <li>GATETEST_SSH_PASSWORD — server password</li>
                  </ul>
                  <p className="text-xs text-muted mt-2">
                    Once set, &quot;Fix Everything&quot; will SSH into the server and run fix commands automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Findings by category */}
          {(() => {
            const byCategory = findings.reduce((acc: Record<string, NuclearFinding[]>, f) => {
              (acc[f.category] = acc[f.category] || []).push(f);
              return acc;
            }, {});
            return Object.entries(byCategory).map(([cat, items]) => (
              <div key={cat} className="card p-4 mb-3">
                <h4 className="font-bold text-sm mb-2">{cat}</h4>
                <div className="space-y-1">
                  {items.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-bold shrink-0 w-16 ${
                        f.severity === "error" ? "text-red-600" :
                        f.severity === "warning" ? "text-amber-600" :
                        f.severity === "pass" ? "text-green-600" :
                        "text-muted"
                      }`}>{f.severity.toUpperCase()}</span>
                      <span className="font-medium shrink-0 min-w-[140px]">{f.title}</span>
                      <span className="text-muted">{f.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ));
          })()}
        </>
      )}
    </>
  );
}
