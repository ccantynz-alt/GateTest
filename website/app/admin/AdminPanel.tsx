"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import LiveScanTerminal from "@/app/components/LiveScanTerminal";

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

type FileFixStatus = "pending" | "fixing" | "done" | "timeout" | "failed";

interface FileProgress {
  file: string;
  status: FileFixStatus;
  error?: string;
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
  const [fileProgress, setFileProgress] = useState<FileProgress[]>([]);
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

  function parseIssues(mods: typeof modules) {
    return mods.flatMap((m) => {
      const details = (m.details as string[]) || [];
      return details.map((d) => {
        let file = "";
        let issue = d;
        let line: number | undefined;
        const fileLineMatch = d.match(/^([\w./\-@+]+?\.[\w]{1,8}):(\d+)(?::\d+)?(?:\s*[-—:]\s*|\s+)(.+)$/);
        if (fileLineMatch) {
          file = fileLineMatch[1]; line = Number(fileLineMatch[2]); issue = fileLineMatch[3];
        } else {
          const fileOnly = d.match(/^([\w./\-@+]+?\.[\w]{1,8})\s*[:—-]\s*(.+)$/);
          if (fileOnly) { file = fileOnly[1]; issue = fileOnly[2]; }
        }
        const missingMatch = d.match(/(?:missing|no|needs)\s+([.\w/\-]+\.(?:md|json|yml|yaml|toml|gitignore|env|example))/i);
        if (!file && missingMatch) {
          file = missingMatch[1].toLowerCase() === "gitignore" ? ".gitignore" : missingMatch[1];
          issue = `CREATE_FILE: ${d}`;
        }
        return { file, issue, module: m.name as string, line };
      });
    });
  }

  function buildFileProgress(fixableIssues: ReturnType<typeof parseIssues>): FileProgress[] {
    const seen = new Set<string>();
    return fixableIssues
      .filter((i) => i.file && !seen.has(i.file) && seen.add(i.file))
      .map((i) => ({ file: i.file, status: "pending" as FileFixStatus }));
  }

  function applyFixResult(progress: FileProgress[], data: FixResult): FileProgress[] {
    const failedSet = new Set<string>((data.failedFiles || []).map((f) => f.file));
    const timeoutSet = new Set<string>();
    for (const e of data.errors || []) {
      const m = e.match(/^([\w./\-@+]+?\.[\w]{1,8}):\s*(request timed out|Anthropic API)/);
      if (m) timeoutSet.add(m[1]);
    }
    return progress.map((fp) => {
      if (timeoutSet.has(fp.file)) return { ...fp, status: "timeout", error: "timed out — queued for retry" };
      if (failedSet.has(fp.file)) {
        const ff = (data.failedFiles || []).find((f) => f.file === fp.file);
        return { ...fp, status: "failed", error: ff?.reason || "api error" };
      }
      return { ...fp, status: "done" };
    });
  }

  async function fixIssues() {
    if (!result || !repoUrl) return;
    const failedMods = modules.filter((m) => (m.status as string) === "failed");
    const issues = parseIssues(failedMods);
    const fixable = issues.filter((i) => i.file);
    const unfixable = issues.filter((i) => !i.file);

    if (fixable.length === 0) {
      setError(`No auto-fixable issues. ${unfixable.length} issue(s) need manual review.`);
      return;
    }
    if (unfixable.length > 0) {
      console.info(`[GateTest] ${fixable.length} auto-fixable, ${unfixable.length} need manual review`); // code-quality-ok
    }

    const initialProgress = buildFileProgress(fixable);
    setFileProgress(initialProgress);
    setFixing(true);
    setFixResult(null);
    setError("");

    // Animate files through "fixing" state so the user sees activity
    let idx = 0;
    const ticker = setInterval(() => {
      idx += 1;
      setFileProgress((prev) => prev.map((fp, i) => {
        if (i < idx && fp.status === "pending") return { ...fp, status: "fixing" };
        return fp;
      }));
    }, Math.max(2000, (50_000 / Math.max(initialProgress.length, 1))));

    try {
      const res = await fetch("/api/scan/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, issues }),
      });
      const data = await res.json() as FixResult;
      clearInterval(ticker);
      setFileProgress((prev) => applyFixResult(prev, data));
      setFixResult(data);
    } catch (err) {
      clearInterval(ticker);
      setError(err instanceof Error ? err.message : "Fix failed");
      setFileProgress((prev) => prev.map((fp) => fp.status !== "done" ? { ...fp, status: "failed", error: "request failed" } : fp));
    } finally {
      setFixing(false);
    }
  }

  async function retryFailedFiles() {
    if (!fixResult?.failedFiles?.length || !repoUrl) return;
    const issues = fixResult.failedFiles.flatMap((ff) =>
      ff.issues.map((i) => ({ file: ff.file, issue: i, module: "retry" })),
    );
    const retryFiles = fixResult.failedFiles.map((ff) => ({ file: ff.file, status: "pending" as FileFixStatus }));
    setFileProgress((prev) => {
      const retrySet = new Set(retryFiles.map((f) => f.file));
      return prev.map((fp) => retrySet.has(fp.file) ? { ...fp, status: "pending", error: undefined } : fp);
    });
    setFixing(true);
    setError("");

    let idx = 0;
    const ticker = setInterval(() => {
      idx += 1;
      setFileProgress((prev) => prev.map((fp, i) => {
        if (i < idx && fp.status === "pending") return { ...fp, status: "fixing" };
        return fp;
      }));
    }, Math.max(2000, (50_000 / Math.max(retryFiles.length, 1))));

    try {
      const res = await fetch("/api/scan/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, issues }),
      });
      const data = await res.json() as FixResult;
      clearInterval(ticker);
      setFileProgress((prev) => applyFixResult(prev, data));
      setFixResult(data);
    } catch (err) {
      clearInterval(ticker);
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
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Dark command center header */}
      <div className="border-b border-white/8 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-lg font-[var(--font-mono)]">G</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Command Center</h1>
              <p className="text-xs text-white/40">
                Signed in as <span className="font-mono text-emerald-400">{adminLogin}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/admin/health"
              className="text-xs px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors font-medium"
            >
              Self-Test
            </a>
            <Link href="/" className="text-xs text-white/30 hover:text-white/60 transition-colors">
              &larr; Site
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl bg-white/[0.04] border border-white/8 p-4 text-center">
              <p className="text-2xl font-bold text-white">{stats.total_scans}</p>
              <p className="text-xs text-white/40">Total Scans</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/8 p-4 text-center">
              <p className="text-2xl font-bold text-white">{stats.total_customers}</p>
              <p className="text-xs text-white/40">Customers</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/8 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">
                ${Number(stats.total_revenue || 0).toFixed(0)}
              </p>
              <p className="text-xs text-white/40">Revenue</p>
            </div>
            <div className="rounded-xl bg-white/[0.04] border border-white/8 p-4 text-center">
              <p className="text-2xl font-bold text-white">{stats.avg_score || 0}</p>
              <p className="text-xs text-white/40">Avg Score</p>
            </div>
          </div>
        )}

        {/* Tab navigation — dark themed */}
        <div className="flex gap-1 mb-6 border-b border-white/10 overflow-x-auto">
          {(["scan", "server", "nuclear", "watchdog", "scans", "customers", "keys"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "border-emerald-400 text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              } ${tab === "nuclear" ? "font-bold text-red-400" : ""}`}
            >
              {tab === "scan"
                ? "Repo Scan"
                : tab === "server"
                ? "Server Scan"
                : tab === "nuclear"
                ? "☢ Nuclear Scan"
                : tab === "watchdog"
                ? "Watchdog"
                : tab === "scans"
                ? "Recent Scans"
                : tab === "customers"
                ? "Customers"
                : "API Keys"}
            </button>
          ))}
        </div>

        {/* DB init notice */}
        {dbData?.note && (
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 mb-6 border-l-4 border-l-yellow-400">
            <p className="text-sm text-white/50">{dbData.note}</p>
            <button onClick={initDb} className="btn-primary px-4 py-2 text-xs mt-2">
              Initialize Database
            </button>
          </div>
        )}

        {/* Tab: Run Scan */}
        {activeTab === "scan" && (
          <>
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-6 mb-8">
              <div className="grid sm:grid-cols-[1fr,auto,auto] gap-3">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm w-full"
                />
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
                >
                  <option value="quick">Quick (39 modules)</option>
                  <option value="full">Full (90 modules)</option>
                </select>
                <button
                  onClick={runScan}
                  disabled={scanning}
                  className="btn-primary px-6 py-3 text-sm disabled:opacity-50"
                >
                  {scanning ? "Scanning..." : "Run Scan"}
                </button>
              </div>
              {error && <p className="text-danger text-sm mt-3">{error}</p>}
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
                <div className={`rounded-xl bg-white/[0.04] border ${totalIssues === 0 ? "border-emerald-500/50" : "border-emerald-500/30"} p-6`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">
                        {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                      </h2>
                      <p className="text-sm text-white/50">
                        {modules.length} modules &middot; {result.duration as number}ms
                      </p>
                    </div>
                    <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                      totalIssues === 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
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
                  <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-5 mt-4 border-l-4 border-l-accent">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">Step-by-step fix guide ({guidance.length} issues)</h3>
                      <button
                        onClick={() => setGuidance(null)}
                        className="text-white/50 hover:text-white text-lg px-2"
                        aria-label="Close guide"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="space-y-4">
                      {guidance.map((g, i) => (
                        <div key={i} className="rounded-lg border border-white/10 p-4 bg-white/[0.03]">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xs font-mono text-accent font-bold">{g.module}</span>
                            <h4 className="font-semibold text-sm">{g.title}</h4>
                          </div>
                          <p className="text-xs text-white/50 mb-3">{g.why}</p>
                          <ol className="text-sm space-y-1 list-decimal list-inside">
                            {g.steps.map((s, j) => (
                              <li key={j} className="text-white/80">{s}</li>
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
                {/* Live fix progress — shows during and after the fix run */}
                {fileProgress.length > 0 && (
                  <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                    {/* Header bar */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        {fixing && <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />}
                        <span className="text-sm font-semibold">
                          {fixing ? "Fixing files with Claude AI..." : fixResult?.prUrl ? "✓ Pull request created" : "Fix complete"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-white/40">
                        <span className="text-emerald-400">{fileProgress.filter((f) => f.status === "done").length} done</span>
                        {fileProgress.filter((f) => f.status === "timeout" || f.status === "failed").length > 0 && (
                          <span className="text-amber-400">{fileProgress.filter((f) => f.status === "timeout" || f.status === "failed").length} retry</span>
                        )}
                        <span>{fileProgress.length} total</span>
                      </div>
                    </div>

                    {/* Progress bar */}
                    {fixing && (
                      <div className="h-1 bg-white/[0.06]">
                        <div
                          className="h-1 bg-accent transition-all duration-700"
                          style={{ width: `${Math.round((fileProgress.filter((f) => f.status !== "pending").length / fileProgress.length) * 100)}%` }}
                        />
                      </div>
                    )}

                    {/* Per-file list */}
                    <div className="divide-y divide-white/[0.04] max-h-72 overflow-y-auto">
                      {fileProgress.map((fp) => (
                        <div key={fp.file} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 w-4 shrink-0 text-center text-xs">
                            {fp.status === "done" && <span className="text-emerald-400">✓</span>}
                            {fp.status === "fixing" && <span className="inline-block w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />}
                            {fp.status === "pending" && <span className="text-white/20">·</span>}
                            {fp.status === "timeout" && <span className="text-amber-400">⏱</span>}
                            {fp.status === "failed" && <span className="text-red-400">✗</span>}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-mono text-white/80 truncate block">{fp.file}</span>
                            {fp.error && <span className="text-xs text-white/40 truncate block">{fp.error}</span>}
                          </div>
                          <span className={`text-xs shrink-0 font-mono ${
                            fp.status === "done" ? "text-emerald-400" :
                            fp.status === "fixing" ? "text-accent" :
                            fp.status === "timeout" ? "text-amber-400" :
                            fp.status === "failed" ? "text-red-400" : "text-white/20"
                          }`}>
                            {fp.status === "fixing" ? "fixing…" : fp.status}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Result footer */}
                    {fixResult && !fixing && (
                      <div className="px-4 py-3 border-t border-white/[0.06] flex flex-wrap items-center gap-3">
                        {fixResult.prUrl && (
                          <>
                            <a href={fixResult.prUrl} target="_blank" rel="noopener noreferrer"
                              className="btn-primary px-4 py-2 text-xs" style={{ background: "#059669" }}>
                              View PR on GitHub →
                            </a>
                            <span className="text-xs text-white/40">
                              Fixed {fixResult.issuesFixed} issues across {fixResult.filesFixed} files
                            </span>
                          </>
                        )}
                        {(fixResult.failedFiles?.length ?? 0) > 0 && (
                          <>
                            <button onClick={retryFailedFiles} disabled={fixing}
                              className="btn-secondary px-4 py-2 text-xs font-semibold disabled:opacity-50">
                              {fixing ? "Retrying…" : `Retry ${fixResult.failedFiles!.length} timed-out file${fixResult.failedFiles!.length !== 1 ? "s" : ""}`}
                            </button>
                            <span className="text-xs text-white/40">Files above marked ⏱ or ✗ will be retried</span>
                          </>
                        )}
                        {!fixResult.prUrl && !fixResult.failedFiles?.length && (
                          <span className="text-xs text-white/50">{fixResult.message || fixResult.error || "No changes generated"}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {modules.map((mod) => {
                  const status = mod.status as string;
                  const details = (mod.details as string[]) || [];
                  return (
                    <div key={mod.name as string} className={`rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 ${status === "failed" ? "border-l-4 border-l-red-500" : status === "passed" ? "border-l-4 border-l-emerald-500" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-bold ${
                            status === "passed" ? "text-emerald-400" : status === "failed" ? "text-red-400" : "text-white/40"
                          }`}>
                            {status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "SKIP"}
                          </span>
                          <span className="font-semibold text-sm">{mod.name as string}</span>
                        </div>
                        <div className="text-xs text-white/40">
                          {mod.checks as number} checks &middot; {mod.issues as number} issues &middot; {mod.duration as number}ms
                        </div>
                      </div>
                      {details.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {details.map((d, i) => (
                            <li key={i} className="text-xs text-white/50 font-mono pl-14">
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
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-white/40">Loading...</div>
            ) : !dbData?.scans?.length ? (
              <div className="p-8 text-center text-white/40">No scans recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.04]">
                      <th className="text-left px-4 py-3 font-medium text-white/40">Repo</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Tier</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Score</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Customer</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.scans.map((scan) => (
                      <tr key={scan.id} className="border-b border-white/[0.06] last:border-0">
                        <td className="px-4 py-3 font-mono text-xs text-white/70 max-w-[200px] truncate">
                          {scan.repo_url?.replace("https://github.com/", "") || "-"}
                        </td>
                        <td className="px-4 py-3 text-white/70">{scan.tier}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                            scan.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                            scan.status === "failed" ? "bg-red-500/20 text-red-400" :
                            "bg-amber-500/20 text-amber-400"
                          }`}>
                            {scan.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/70">{scan.score ?? "-"}</td>
                        <td className="px-4 py-3 text-xs text-white/40">{scan.customer_email || "-"}</td>
                        <td className="px-4 py-3 text-xs text-white/40">
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
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-6">
              <h2 className="text-lg font-bold mb-1">Issue an API key</h2>
              <p className="text-xs text-white/50 mb-4">
                For external platforms calling <code className="font-mono">POST /api/v1/scan</code>.
                The plaintext key is shown ONCE after creation — copy it immediately.
              </p>
              <div className="grid sm:grid-cols-[1fr,1fr,auto,auto,auto] gap-3">
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Key name (e.g. Platform A prod)"
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
                />
                <input
                  type="email"
                  value={keyCustomer}
                  onChange={(e) => setKeyCustomer(e.target.value)}
                  placeholder="customer@example.com (optional)"
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
                />
                <select
                  value={keyTier}
                  onChange={(e) => setKeyTier(e.target.value as "quick" | "full")}
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
                >
                  <option value="quick">quick</option>
                  <option value="full">full</option>
                </select>
                <input
                  type="number"
                  value={keyRate}
                  onChange={(e) => setKeyRate(Math.max(1, Number(e.target.value) || 60))}
                  placeholder="60"
                  className="px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm w-24"
                />
                <button onClick={createKey} className="btn-primary px-6 py-3 text-sm">
                  Create Key
                </button>
              </div>
              {keyError && <p className="text-danger text-sm mt-3">{keyError}</p>}

              {newKey && (
                <div className="mt-4 p-4 border-l-4 border-l-emerald-500 bg-emerald-900/20 rounded">
                  <p className="text-sm font-bold text-emerald-300 mb-1">
                    Key created — copy it now, it will not be shown again.
                  </p>
                  <p className="text-xs text-emerald-300 mb-2">
                    <strong>{newKey.name}</strong> · tier {newKey.tier_allowed} ·{" "}
                    {newKey.rate_limit_per_hour}/hr
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs bg-white/5 border border-white/10 rounded px-3 py-2 break-all text-white/80">
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

            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.04]">
                      <th className="text-left px-4 py-3 font-medium text-white/40">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Prefix</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Tier</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Rate/hr</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Calls</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Last used</th>
                      <th className="text-right px-4 py-3 font-medium text-white/40">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys === null ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-white/40">Loading...</td>
                      </tr>
                    ) : apiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-white/40">
                          No keys issued yet. Create one above.
                        </td>
                      </tr>
                    ) : (
                      apiKeys.map((k) => (
                        <tr key={k.id} className="border-b border-white/[0.06] last:border-0">
                          <td className="px-4 py-3 text-white/70">{k.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-white/70">{k.key_prefix}…</td>
                          <td className="px-4 py-3 text-white/70">{k.tier_allowed}</td>
                          <td className="px-4 py-3 text-white/70">{k.rate_limit_per_hour}</td>
                          <td className="px-4 py-3 text-white/70">{k.total_calls}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                              k.active ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/40"
                            }`}>
                              {k.active ? "active" : "revoked"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-white/40">
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

            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 text-xs text-white/50">
              Docs: <a href="/docs/api" className="text-accent hover:underline">/docs/api</a> ·
              Endpoint: <code className="font-mono">POST /api/v1/scan</code>
            </div>
          </div>
        )}

        {/* Tab: Customers */}
        {activeTab === "customers" && (
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-white/40">Loading...</div>
            ) : !dbData?.customers?.length ? (
              <div className="p-8 text-center text-white/40">No customers yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.04]">
                      <th className="text-left px-4 py-3 font-medium text-white/40">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">GitHub</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Scans</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Spent</th>
                      <th className="text-left px-4 py-3 font-medium text-white/40">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.customers.map((c) => (
                      <tr key={c.id} className="border-b border-white/[0.06] last:border-0">
                        <td className="px-4 py-3 text-xs text-white/70">{c.email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-white/70">{c.github_login || "-"}</td>
                        <td className="px-4 py-3 text-white/70">{c.total_scans}</td>
                        <td className="px-4 py-3 text-white/70">${Number(c.total_spent_usd || 0).toFixed(0)}</td>
                        <td className="px-4 py-3 text-xs text-white/40">
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
      <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-6 mb-8">
        <p className="text-sm text-white/50 mb-3">Scan a live URL for SSL, security headers, DNS, and performance.</p>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runServerScan(); }}
            placeholder="https://example.com"
            className="flex-1 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
          />
          <button onClick={runServerScan} disabled={scanning} className="btn-primary px-6 py-3 text-sm disabled:opacity-50">
            {scanning ? "Scanning..." : "Scan Server"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {scanning && (
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/50">Checking SSL, headers, DNS, performance...</p>
        </div>
      )}

      {result && !scanning && (
        <div className="space-y-4">
          <div className={`rounded-xl bg-white/[0.04] border border-white/[0.08] p-6 ${totalIssues === 0 ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-amber-500"}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                </h2>
                <p className="text-sm text-white/50">
                  {result.hostname as string} &middot; {modules.length} modules &middot; {result.duration as number}ms
                </p>
              </div>
              <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                totalIssues === 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
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
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-5 border-l-4 border-l-accent">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-accent text-lg">⚡</span>
                <h3 className="font-bold">Ready-to-paste fixes</h3>
              </div>
              <div className="space-y-5">
                {Object.entries(fixes).map(([category, fixList]) => (
                  <div key={category}>
                    <h4 className="font-semibold text-sm text-white/80 mb-2">{category}</h4>
                    <div className="space-y-3">
                      {fixList.map((f, idx) => {
                        const id = `${category}-${idx}`;
                        return (
                          <div key={id} className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-white/[0.04] border-b border-white/10">
                              <div>
                                <div className="text-xs font-bold text-white/80">{f.platform}</div>
                                <div className="text-xs text-white/50">{f.title}</div>
                              </div>
                              <button
                                onClick={() => copyCode(f.code, id)}
                                className="btn-secondary px-3 py-1 text-xs"
                              >
                                {copiedCode === id ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <pre className="p-3 text-xs font-mono text-white/70 overflow-x-auto whitespace-pre-wrap">{f.code}</pre>
                            <p className="px-3 py-2 bg-amber-900/30 text-xs text-amber-300 border-t border-amber-500/30">
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
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-5 border-l-4 border-l-amber-500">
              <p className="text-sm text-white/50">
                No automated fixes available for these specific issues. They require manual review or infrastructure access.
              </p>
            </div>
          )}

          {modules.map((mod) => {
            const status = mod.status as string;
            const details = (mod.details as string[]) || [];
            return (
              <div key={mod.name as string} className={`rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 ${
                status === "passed" ? "border-l-4 border-l-emerald-500" :
                status === "warning" ? "border-l-4 border-l-amber-500" :
                "border-l-4 border-l-red-500"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-white/80">{mod.label as string || mod.name as string}</span>
                  <span className={`text-xs font-bold ${
                    status === "passed" ? "text-emerald-400" : status === "warning" ? "text-amber-400" : "text-red-400"
                  }`}>
                    {status === "passed" ? "PASS" : status === "warning" ? "WARN" : "FAIL"}
                  </span>
                </div>
                {details.length > 0 && (
                  <ul className="space-y-1">
                    {details.map((d, i) => (
                      <li key={i} className={`text-xs font-mono ${
                        d.startsWith("error") ? "text-red-400" :
                        d.startsWith("warning") ? "text-amber-400" :
                        d.startsWith("pass") ? "text-emerald-400" :
                        "text-white/50"
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
      <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-6 mb-6 border-l-4 border-l-red-500">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">☢</span>
          <div>
            <h3 className="font-bold text-lg">Nuclear Scan</h3>
            <p className="text-sm text-white/50">Find <strong>anything</strong> and <strong>everything</strong> wrong with a domain. Full stack diagnosis — DNS, ports, SSL, headers, performance, availability, redirects, email auth. Root-cause pinpointed automatically.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runNuclear(); }}
            placeholder="https://crontech.ai"
            className="flex-1 px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-white placeholder:text-white/30 focus:border-emerald-500/50 focus:outline-none text-sm"
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
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-8 text-center">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-bold">Running full-stack diagnosis...</p>
          <p className="text-xs text-white/50 mt-1">DNS · Ports · SSL · Headers · Performance · Redirects · Email</p>
        </div>
      )}

      {result && !scanning && (
        <>
          {/* Diagnosis */}
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-6 mb-4 border-l-4 border-l-red-500">
            <h3 className="font-bold mb-3">Diagnosis</h3>
            {diagnosis.map((d, i) => (
              <p key={i} className={`text-sm mb-1 ${d.startsWith("ROOT CAUSE") ? "text-red-400 font-bold" : d.startsWith("FIX") ? "text-accent font-medium" : "text-white/80"}`}>
                {d}
              </p>
            ))}
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <div className="p-2 bg-red-500/10 rounded border border-red-500/20">
                <div className="text-2xl font-bold text-red-400">{summary?.errors ?? 0}</div>
                <div className="text-xs text-white/40">Errors</div>
              </div>
              <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20">
                <div className="text-2xl font-bold text-amber-400">{summary?.warnings ?? 0}</div>
                <div className="text-xs text-white/40">Warnings</div>
              </div>
              <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20">
                <div className="text-2xl font-bold text-emerald-400">{summary?.passes ?? 0}</div>
                <div className="text-xs text-white/40">Passes</div>
              </div>
              <div className="p-2 bg-white/[0.04] rounded border border-white/10">
                <div className="text-2xl font-bold text-white/70">{summary?.total ?? 0}</div>
                <div className="text-xs text-white/40">Total Checks</div>
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
                <p className="text-xs text-white/40 text-center mt-2">
                  Generates ready-to-apply fixes for every issue found. Code fixes go to a PR; config fixes produce Vercel/Nginx/DNS snippets.
                </p>
              </div>
            )}
          </div>

          {/* Fixes */}
          {fixResult && (
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-5 mb-4 border-l-4 border-l-accent">
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
                  <p className="text-sm text-white/50 mb-3">
                    {(fixResult as Record<string, unknown>).message as string}
                  </p>
                  <div className="space-y-2">
                    {((fixResult as Record<string, unknown>).actions as Array<{ issue: string; command: string; output: string; status: string }>).map((a, i) => (
                      <div key={i} className={`rounded-lg border p-3 text-xs ${
                        a.status === "fixed" ? "border-emerald-500/30 bg-emerald-900/20" : "border-red-500/30 bg-red-900/20"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={a.status === "fixed" ? "text-emerald-400" : "text-red-400"}>
                            {a.status === "fixed" ? "✓" : "✗"}
                          </span>
                          <span className="font-medium text-white/80">{a.issue}</span>
                        </div>
                        <pre className="font-mono text-xs bg-black/20 text-white/60 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{a.output || "(no output)"}</pre>
                      </div>
                    ))}
                  </div>
                </>
              ) : (fixResult as Record<string, unknown>).fixes && Object.keys((fixResult as Record<string, unknown>).fixes as Record<string, unknown>).length > 0 ? (
                <>
                  <h3 className="font-bold mb-3">⚡ Fixes generated</h3>
                  <p className="text-sm text-white/50 mb-3">
                    {((fixResult as Record<string, unknown>).totalFixes as number) || 0} fixes across {((fixResult as Record<string, unknown>).categories as number) || 0} categories.
                  </p>
                  <details className="text-xs font-mono bg-white/[0.03] border border-white/10 p-3 rounded max-h-96 overflow-auto">
                    <summary className="cursor-pointer font-semibold text-white/70">View all fix snippets</summary>
                    <pre className="mt-2 whitespace-pre-wrap text-white/60">{JSON.stringify((fixResult as Record<string, unknown>).fixes, null, 2)}</pre>
                  </details>
                </>
              ) : (
                <div>
                  <h3 className="font-bold mb-2">⚡ Fix attempted</h3>
                  <p className="text-sm text-white/50">
                    To enable autonomous server repair, set these in Vercel env vars:
                  </p>
                  <ul className="text-xs font-mono text-white/50 mt-2 space-y-1">
                    <li>GATETEST_SSH_HOST — server IP (e.g. 45.76.171.37)</li>
                    <li>GATETEST_SSH_USER — username (default: root)</li>
                    <li>GATETEST_SSH_PASSWORD — server password</li>
                  </ul>
                  <p className="text-xs text-white/40 mt-2">
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
              <div key={cat} className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 mb-3">
                <h4 className="font-bold text-sm mb-2 text-white/80">{cat}</h4>
                <div className="space-y-1">
                  {items.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-bold shrink-0 w-16 ${
                        f.severity === "error" ? "text-red-400" :
                        f.severity === "warning" ? "text-amber-400" :
                        f.severity === "pass" ? "text-emerald-400" :
                        "text-white/40"
                      }`}>{f.severity.toUpperCase()}</span>
                      <span className="font-medium shrink-0 min-w-[140px] text-white/70">{f.title}</span>
                      <span className="text-white/40">{f.detail}</span>
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
