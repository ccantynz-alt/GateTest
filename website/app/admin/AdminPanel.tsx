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
      // code-quality-ok — operational info log in admin UI, not customer-facing
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
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-base font-[var(--font-mono)]">G</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">GateTest Admin</h1>
              <p className="text-xs text-gray-500">
                Signed in as <span className="font-mono text-emerald-600 font-medium">{adminLogin}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/admin/health"
              className="text-xs px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors font-medium"
            >
              Self-Test
            </a>
            <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              &larr; Site
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{stats.total_scans}</p>
              <p className="text-xs text-gray-500">Total Scans</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{stats.total_customers}</p>
              <p className="text-xs text-gray-500">Customers</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">
                ${Number(stats.total_revenue || 0).toFixed(0)}
              </p>
              <p className="text-xs text-gray-500">Revenue</p>
            </div>
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{stats.avg_score || 0}</p>
              <p className="text-xs text-gray-500">Avg Score</p>
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
          {(["scan", "server", "nuclear", "watchdog", "scans", "customers", "keys"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "border-emerald-600 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              } ${tab === "nuclear" ? "font-bold text-red-600" : ""}`}
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
          <div className="rounded-xl bg-white border border-yellow-200 shadow-sm p-4 mb-6 border-l-4 border-l-yellow-400">
            <p className="text-sm text-gray-600">{dbData.note}</p>
            <button onClick={initDb} className="btn-primary px-4 py-2 text-xs mt-2">
              Initialize Database
            </button>
          </div>
        )}

        {/* Tab: Run Scan */}
        {activeTab === "scan" && (
          <>
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 mb-6">
              <div className="grid sm:grid-cols-[1fr,auto,auto] gap-3">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm w-full"
                />
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 focus:border-emerald-500 focus:outline-none text-sm"
                >
                  <option value="quick">Quick (39 modules)</option>
                  <option value="full">Full (67 modules)</option>
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
                <div className={`rounded-xl bg-white border shadow-sm p-6 ${totalIssues === 0 ? "border-emerald-300" : "border-amber-300"}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-xl font-bold">
                        {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {modules.length} modules &middot; {result.duration as number}ms
                      </p>
                    </div>
                    <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                      totalIssues === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
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
                  <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 mt-4 border-l-4 border-l-accent">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-bold">Step-by-step fix guide ({guidance.length} issues)</h3>
                      <button
                        onClick={() => setGuidance(null)}
                        className="text-gray-500 hover:text-gray-900 text-lg px-2"
                        aria-label="Close guide"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="space-y-4">
                      {guidance.map((g, i) => (
                        <div key={i} className="rounded-lg border border-gray-200 p-4 bg-gray-50">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xs font-mono text-accent font-bold">{g.module}</span>
                            <h4 className="font-semibold text-sm">{g.title}</h4>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">{g.why}</p>
                          <ol className="text-sm space-y-1 list-decimal list-inside">
                            {g.steps.map((s, j) => (
                              <li key={j} className="text-gray-800">{s}</li>
                            ))}
                          </ol>
                          {g.commands && g.commands.length > 0 && (
                            <div className="mt-3 space-y-1">
                              {g.commands.map((cmd, j) => (
                                <pre key={j} className="bg-gray-900 text-emerald-400 text-xs font-mono p-2 rounded overflow-x-auto">{cmd}</pre>
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
                  <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 text-center">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="font-medium">AI is reading your code and generating fixes...</p>
                    <p className="text-xs text-gray-500 mt-1">This may take 30-60 seconds depending on the number of issues</p>
                  </div>
                )}

                {fixResult && (
                  <div className={`rounded-xl bg-white border shadow-sm p-5 ${fixResult.prUrl ? "border-emerald-300" : "border-gray-200"}`}>
                    {fixResult.prUrl ? (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-success text-lg">&#10003;</span>
                          <h3 className="font-bold">Pull Request Created</h3>
                        </div>
                        <p className="text-sm text-gray-500 mb-3">
                          Fixed <strong>{fixResult.issuesFixed} issues</strong> across {fixResult.filesFixed} files
                          {totalIssues > (fixResult.issuesFixed || 0) && (
                            <> — <strong>{totalIssues - (fixResult.issuesFixed || 0)} remaining</strong> need manual review (not auto-fixable)</>
                          )}.
                        </p>
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700 mb-3">
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
                        <p className="text-sm text-gray-500 mt-1">{fixResult.message}</p>
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500">
                              <strong className="text-gray-900">{fixResult.failedFiles.length}</strong> file{fixResult.failedFiles.length !== 1 ? "s" : ""} queued for retry
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
                        <p className="text-sm text-gray-500">{fixResult.message || "No fixes could be generated"}</p>
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-500">{fixResult.failedFiles.length} network failure{fixResult.failedFiles.length !== 1 ? "s" : ""}</p>
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
                          <ul className="mt-2 text-xs text-gray-500 space-y-1">
                            {fixResult.errors.map((e, i) => <li key={i}>&rarr; {e}</li>)}
                          </ul>
                        )}
                        {fixResult.failedFiles && fixResult.failedFiles.length > 0 && (
                          <div className="mt-3 flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-500">
                              <strong className="text-gray-900">{fixResult.failedFiles.length}</strong> additional file{fixResult.failedFiles.length !== 1 ? "s" : ""} failed with API errors
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
                    <div key={mod.name as string} className={`rounded-xl bg-white border shadow-sm p-4 ${status === "failed" ? "border-l-4 border-l-red-500 border-red-200" : status === "passed" ? "border-l-4 border-l-emerald-500 border-emerald-200" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            status === "passed" ? "bg-emerald-100 text-emerald-700" : status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
                          }`}>
                            {status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "SKIP"}
                          </span>
                          <span className="font-semibold text-sm text-gray-900">{mod.name as string}</span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {mod.checks as number} checks &middot; {mod.issues as number} issues &middot; {mod.duration as number}ms
                        </div>
                      </div>
                      {details.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {details.map((d, i) => (
                            <li key={i} className="text-xs text-gray-600 font-mono pl-14">
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

        {/* Tab: Watchdog */}
        {activeTab === "watchdog" && (
          <WatchdogPanel />
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
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : !dbData?.scans?.length ? (
              <div className="p-8 text-center text-gray-400">No scans recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Repo</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Tier</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Score</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Customer</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.scans.map((scan) => (
                      <tr key={scan.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-[200px] truncate">
                          {scan.repo_url?.replace("https://github.com/", "") || "-"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{scan.tier}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                            scan.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                            scan.status === "failed" ? "bg-red-100 text-red-700" :
                            "bg-amber-100 text-amber-700"
                          }`}>
                            {scan.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 font-medium">{scan.score ?? "-"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{scan.customer_email || "-"}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
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
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6">
              <h2 className="text-lg font-bold mb-1">Issue an API key</h2>
              <p className="text-xs text-gray-500 mb-4">
                For external platforms calling <code className="font-mono">POST /api/v1/scan</code>.
                The plaintext key is shown ONCE after creation — copy it immediately.
              </p>
              <div className="grid sm:grid-cols-[1fr,1fr,auto,auto,auto] gap-3">
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Key name (e.g. Platform A prod)"
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm"
                />
                <input
                  type="email"
                  value={keyCustomer}
                  onChange={(e) => setKeyCustomer(e.target.value)}
                  placeholder="customer@example.com (optional)"
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm"
                />
                <select
                  value={keyTier}
                  onChange={(e) => setKeyTier(e.target.value as "quick" | "full")}
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm"
                >
                  <option value="quick">quick</option>
                  <option value="full">full</option>
                </select>
                <input
                  type="number"
                  value={keyRate}
                  onChange={(e) => setKeyRate(Math.max(1, Number(e.target.value) || 60))}
                  placeholder="60"
                  className="px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm w-24"
                />
                <button onClick={createKey} className="btn-primary px-6 py-3 text-sm">
                  Create Key
                </button>
              </div>
              {keyError && <p className="text-danger text-sm mt-3">{keyError}</p>}

              {newKey && (
                <div className="mt-4 p-4 border-l-4 border-l-emerald-500 bg-emerald-50 rounded">
                  <p className="text-sm font-bold text-emerald-700 mb-1">
                    Key created — copy it now, it will not be shown again.
                  </p>
                  <p className="text-xs text-emerald-700 mb-2">
                    <strong>{newKey.name}</strong> · tier {newKey.tier_allowed} ·{" "}
                    {newKey.rate_limit_per_hour}/hr
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs bg-white border border-gray-200 rounded px-3 py-2 break-all text-gray-800">
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

            <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Prefix</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Tier</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Rate/hr</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Calls</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Last used</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-400">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys === null ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-gray-400">Loading...</td>
                      </tr>
                    ) : apiKeys.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-gray-400">
                          No keys issued yet. Create one above.
                        </td>
                      </tr>
                    ) : (
                      apiKeys.map((k) => (
                        <tr key={k.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-900 font-medium">{k.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-600">{k.key_prefix}…</td>
                          <td className="px-4 py-3 text-gray-700">{k.tier_allowed}</td>
                          <td className="px-4 py-3 text-gray-700">{k.rate_limit_per_hour}</td>
                          <td className="px-4 py-3 text-gray-700">{k.total_calls}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                              k.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                            }`}>
                              {k.active ? "active" : "revoked"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">
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

            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 text-xs text-gray-500">
              Docs: <a href="/docs/api" className="text-accent hover:underline">/docs/api</a> ·
              Endpoint: <code className="font-mono">POST /api/v1/scan</code>
            </div>
          </div>
        )}

        {/* Tab: Customers */}
        {activeTab === "customers" && (
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            {dbLoading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : !dbData?.customers?.length ? (
              <div className="p-8 text-center text-gray-400">No customers yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Email</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">GitHub</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Scans</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Spent</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-400">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.customers.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-4 py-3 text-xs text-gray-700">{c.email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">{c.github_login || "-"}</td>
                        <td className="px-4 py-3 text-gray-700">{c.total_scans}</td>
                        <td className="px-4 py-3 text-gray-700">${Number(c.total_spent_usd || 0).toFixed(0)}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">
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

// ---------------------------------------------------------------------------
// Watchdog Panel — multi-repo CI health + batch scan-and-fix
// ---------------------------------------------------------------------------

interface RepoInfo {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  private: boolean;
  pushed_at: string;
  default_branch: string;
  latestRun: { conclusion: string | null; status: string; created_at: string; html_url: string; head_branch: string; name: string } | null;
  ciStatus: "passing" | "failing" | "pending" | "none";
}

interface RepoScanState {
  status: "idle" | "scanning" | "fixing" | "done" | "error";
  prUrl?: string;
  error?: string;
  issues?: number;
}

function WatchdogPanel() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "failing">("failing");
  const [scanStates, setScanStates] = useState<Record<string, RepoScanState>>({});
  const [batchRunning, setBatchRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/repos");
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || `HTTP ${res.status}`);
        return;
      }
      const d = await res.json();
      setRepos(d.repos || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load repos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function scanAndFix(repo: RepoInfo) {
    setScanStates((s) => ({ ...s, [repo.full_name]: { status: "scanning" } }));
    try {
      // Step 1: scan
      const scanRes = await fetch("/api/scan/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.html_url, tier: "full" }),
      });
      const scanData = await scanRes.json();
      const issues = (scanData.totalIssues as number) || 0;

      if (issues === 0) {
        setScanStates((s) => ({ ...s, [repo.full_name]: { status: "done", issues: 0 } }));
        return;
      }

      // Step 2: fix
      setScanStates((s) => ({ ...s, [repo.full_name]: { status: "fixing", issues } }));
      const fixableIssues = (scanData.fixableIssues as Array<{ file: string; issue: string; module: string }>) || [];

      if (fixableIssues.length === 0) {
        setScanStates((s) => ({ ...s, [repo.full_name]: { status: "done", issues, error: "No auto-fixable issues" } }));
        return;
      }

      const fixRes = await fetch("/api/scan/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.html_url, issues: fixableIssues }),
      });
      const fixData = await fixRes.json();
      setScanStates((s) => ({
        ...s,
        [repo.full_name]: {
          status: "done",
          issues,
          prUrl: fixData.prUrl,
          error: fixData.prUrl ? undefined : (fixData.error || fixData.message),
        },
      }));
    } catch (err) {
      setScanStates((s) => ({
        ...s,
        [repo.full_name]: { status: "error", error: err instanceof Error ? err.message : "Failed" },
      }));
    }
  }

  async function fixAllFailing() {
    const failing = repos.filter((r) => r.ciStatus === "failing");
    setBatchRunning(true);
    for (const repo of failing) {
      const current = scanStates[repo.full_name];
      if (current?.status === "scanning" || current?.status === "fixing") continue;
      await scanAndFix(repo);
    }
    setBatchRunning(false);
  }

  const displayed = filter === "failing" ? repos.filter((r) => r.ciStatus === "failing") : repos;
  const failCount = repos.filter((r) => r.ciStatus === "failing").length;
  const passCount = repos.filter((r) => r.ciStatus === "passing").length;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">CI Watchdog</h2>
            <p className="text-xs text-gray-500 mt-0.5">All your repos. Failing ones first. GateTest fixes them.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="btn-secondary px-3 py-2 text-xs disabled:opacity-50">
              {loading ? "Loading…" : "Refresh"}
            </button>
            {failCount > 0 && (
              <button
                onClick={fixAllFailing}
                disabled={batchRunning || loading}
                className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: "#059669" }}
              >
                {batchRunning ? "Fixing…" : `⚡ Fix All ${failCount} Failing`}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {!loading && repos.length > 0 && (
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-gray-700"><strong className="text-red-600">{failCount}</strong> failing</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-gray-700"><strong className="text-emerald-600">{passCount}</strong> passing</span>
            </span>
            <span className="text-gray-400">{repos.length} total repos</span>
          </div>
        )}
      </div>

      {/* Filter tabs */}
      {!loading && repos.length > 0 && (
        <div className="flex gap-1">
          {(["failing", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filter === f
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-400 hover:text-gray-700"
              }`}
            >
              {f === "failing" ? `Failing (${failCount})` : `All repos (${repos.length})`}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          <strong>Could not load repos:</strong> {error}
          {error.includes("token") && (
            <p className="mt-2 text-xs text-red-700/70">Set <code className="font-mono">GATETEST_GITHUB_TOKEN</code> or <code className="font-mono">GITHUB_TOKEN</code> in your Vercel environment variables.</p>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-gray-200" />
                <div className="h-4 bg-gray-200 rounded w-48" />
                <div className="ml-auto h-3 bg-gray-200 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Repo list */}
      {!loading && displayed.length === 0 && !error && (
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-8 text-center text-gray-400">
          {filter === "failing" ? "No failing workflows — all green! 🎉" : "No repos found."}
        </div>
      )}

      {!loading && displayed.map((repo) => {
        const state = scanStates[repo.full_name];
        const isWorking = state?.status === "scanning" || state?.status === "fixing";

        const ciDot =
          repo.ciStatus === "failing" ? "bg-red-400" :
          repo.ciStatus === "passing" ? "bg-emerald-400" :
          repo.ciStatus === "pending" ? "bg-amber-400 animate-pulse" :
          "bg-gray-300";

        const ciLabel =
          repo.ciStatus === "failing" ? "FAILING" :
          repo.ciStatus === "passing" ? "PASSING" :
          repo.ciStatus === "pending" ? "PENDING" : "NO CI";

        const ciColor =
          repo.ciStatus === "failing" ? "text-red-600" :
          repo.ciStatus === "passing" ? "text-emerald-600" :
          repo.ciStatus === "pending" ? "text-amber-600" : "text-gray-400";

        return (
          <div
            key={repo.id}
            className={`rounded-xl bg-white border shadow-sm p-4 ${
              repo.ciStatus === "failing" ? "border-l-4 border-l-red-500 border-red-200" :
              repo.ciStatus === "passing" ? "border-l-4 border-l-emerald-500 border-emerald-200" : "border-gray-200"
            }`}
          >
            <div className="flex flex-wrap items-center gap-3">
              {/* Status dot */}
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ciDot}`} />

              {/* Repo name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm font-semibold text-gray-900 hover:text-emerald-700 transition-colors"
                  >
                    {repo.full_name}
                  </a>
                  {repo.private && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">private</span>
                  )}
                  <span className={`text-[11px] font-bold font-mono ${ciColor}`}>{ciLabel}</span>
                </div>
                {repo.latestRun && (
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{repo.latestRun.name}</span>
                    <span>·</span>
                    <span>{repo.latestRun.head_branch}</span>
                    <span>·</span>
                    <span>{new Date(repo.latestRun.created_at).toLocaleDateString()}</span>
                    <a href={repo.latestRun.html_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      view run →
                    </a>
                  </div>
                )}
              </div>

              {/* Action area */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Scan state feedback */}
                {state?.status === "scanning" && (
                  <span className="text-xs text-teal-700 font-medium animate-pulse">Scanning…</span>
                )}
                {state?.status === "fixing" && (
                  <span className="text-xs text-emerald-600 animate-pulse font-medium">AI fixing {state.issues} issues…</span>
                )}
                {state?.status === "done" && state.prUrl && (
                  <a
                    href={state.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors font-medium"
                  >
                    View Fix PR →
                  </a>
                )}
                {state?.status === "done" && !state.prUrl && state.issues === 0 && (
                  <span className="text-xs text-emerald-600 font-medium">✓ No issues found</span>
                )}
                {state?.status === "done" && !state.prUrl && (state.issues || 0) > 0 && (
                  <span className="text-xs text-gray-400">{state.error || "No auto-fixable issues"}</span>
                )}
                {state?.status === "error" && (
                  <span className="text-xs text-red-600">{state.error}</span>
                )}

                {/* Scan button */}
                {!isWorking && (
                  <button
                    onClick={() => scanAndFix(repo)}
                    disabled={isWorking}
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {state?.status === "done" ? "Re-scan" : "Scan & Fix"}
                  </button>
                )}

                {isWorking && (
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
          </div>
        );
      })}
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
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 mb-8">
        <p className="text-sm text-gray-500 mb-3">Scan a live URL for SSL, security headers, DNS, and performance.</p>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runServerScan(); }}
            placeholder="https://example.com"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm"
          />
          <button onClick={runServerScan} disabled={scanning} className="btn-primary px-6 py-3 text-sm disabled:opacity-50">
            {scanning ? "Scanning..." : "Scan Server"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {scanning && (
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Checking SSL, headers, DNS, performance...</p>
        </div>
      )}

      {result && !scanning && (
        <div className="space-y-4">
          <div className={`rounded-xl bg-white border border-gray-200 shadow-sm p-6 ${totalIssues === 0 ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-amber-500"}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                </h2>
                <p className="text-sm text-gray-500">
                  {result.hostname as string} &middot; {modules.length} modules &middot; {result.duration as number}ms
                </p>
              </div>
              <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                totalIssues === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
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
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 border-l-4 border-l-accent">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-accent text-lg">⚡</span>
                <h3 className="font-bold">Ready-to-paste fixes</h3>
              </div>
              <div className="space-y-5">
                {Object.entries(fixes).map(([category, fixList]) => (
                  <div key={category}>
                    <h4 className="font-semibold text-sm text-gray-800 mb-2">{category}</h4>
                    <div className="space-y-3">
                      {fixList.map((f, idx) => {
                        const id = `${category}-${idx}`;
                        return (
                          <div key={id} className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                              <div>
                                <div className="text-xs font-bold text-gray-800">{f.platform}</div>
                                <div className="text-xs text-gray-500">{f.title}</div>
                              </div>
                              <button
                                onClick={() => copyCode(f.code, id)}
                                className="btn-secondary px-3 py-1 text-xs"
                              >
                                {copiedCode === id ? "Copied!" : "Copy"}
                              </button>
                            </div>
                            <pre className="p-3 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre-wrap">{f.code}</pre>
                            <p className="px-3 py-2 bg-amber-50 text-xs text-amber-700 border-t border-amber-200">
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
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 border-l-4 border-l-amber-500">
              <p className="text-sm text-gray-500">
                No automated fixes available for these specific issues. They require manual review or infrastructure access.
              </p>
            </div>
          )}

          {modules.map((mod) => {
            const status = mod.status as string;
            const details = (mod.details as string[]) || [];
            return (
              <div key={mod.name as string} className={`rounded-xl bg-white border border-gray-200 shadow-sm p-4 ${
                status === "passed" ? "border-l-4 border-l-emerald-500" :
                status === "warning" ? "border-l-4 border-l-amber-500" :
                "border-l-4 border-l-red-500"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-gray-800">{mod.label as string || mod.name as string}</span>
                  <span className={`text-xs font-bold ${
                    status === "passed" ? "text-emerald-600" : status === "warning" ? "text-amber-600" : "text-red-600"
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
                        d.startsWith("pass") ? "text-emerald-600" :
                        "text-gray-500"
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

function NuclearFixSnippets({ fixResult }: { fixResult: Record<string, unknown> }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fixes = fixResult.fixes as Record<string, ServerFix[]> || {};
  const total = (fixResult.totalFixes as number) || 0;
  const cats = (fixResult.categories as number) || 0;

  function copySnippet(code: string, id: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-emerald-600 text-lg font-bold">⚡</span>
        <h3 className="font-bold text-gray-900">
          {total} ready-to-paste fix{total !== 1 ? "es" : ""} across {cats} categor{cats !== 1 ? "ies" : "y"}
        </h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">Copy each snippet and apply it to your server config. No SSH credentials needed — paste and deploy.</p>
      <div className="space-y-5">
        {Object.entries(fixes).map(([category, fixList]) => (
          <div key={category}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">{category}</h4>
            <div className="space-y-3">
              {fixList.map((f, idx) => {
                const id = `nuclear-${category}-${idx}`;
                return (
                  <div key={id} className="rounded-lg border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                      <div>
                        <span className="text-xs font-bold text-gray-800">{f.platform}</span>
                        <span className="text-xs text-gray-500 ml-2">{f.title}</span>
                      </div>
                      <button
                        onClick={() => copySnippet(f.code, id)}
                        className="text-xs px-3 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium transition-colors"
                      >
                        {copiedId === id ? "✓ Copied!" : "Copy"}
                      </button>
                    </div>
                    <pre className="p-3 text-xs font-mono text-gray-700 bg-white overflow-x-auto whitespace-pre-wrap">{f.code}</pre>
                    <p className="px-3 py-2 bg-amber-50 text-xs text-amber-700 border-t border-amber-200">
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
  );
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
      <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 mb-6 border-l-4 border-l-red-500">
        <div className="flex items-start gap-3 mb-3">
          <span className="text-2xl">☢</span>
          <div>
            <h3 className="font-bold text-lg">Nuclear Scan</h3>
            <p className="text-sm text-gray-500">Find <strong>anything</strong> and <strong>everything</strong> wrong with a domain. Full stack diagnosis — DNS, ports, SSL, headers, performance, availability, redirects, email auth. Root-cause pinpointed automatically.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runNuclear(); }}
            placeholder="https://crontech.ai"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 text-sm"
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
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-8 text-center">
          <div className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-bold">Running full-stack diagnosis...</p>
          <p className="text-xs text-gray-500 mt-1">DNS · Ports · SSL · Headers · Performance · Redirects · Email</p>
        </div>
      )}

      {result && !scanning && (
        <>
          {/* Diagnosis */}
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 mb-4 border-l-4 border-l-red-500">
            <h3 className="font-bold mb-3">Diagnosis</h3>
            {diagnosis.map((d, i) => (
              <p key={i} className={`text-sm mb-1 ${d.startsWith("ROOT CAUSE") ? "text-red-700 font-bold" : d.startsWith("FIX") ? "text-emerald-700 font-medium" : "text-gray-800"}`}>
                {d}
              </p>
            ))}
            <div className="mt-4 grid grid-cols-4 gap-2 text-center">
              <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                <div className="text-2xl font-bold text-red-600">{summary?.errors ?? 0}</div>
                <div className="text-xs text-gray-500">Errors</div>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                <div className="text-2xl font-bold text-amber-600">{summary?.warnings ?? 0}</div>
                <div className="text-xs text-gray-500">Warnings</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="text-2xl font-bold text-emerald-600">{summary?.passes ?? 0}</div>
                <div className="text-xs text-gray-500">Passes</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-700">{summary?.total ?? 0}</div>
                <div className="text-xs text-gray-500">Total Checks</div>
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
                <p className="text-xs text-gray-400 text-center mt-2">
                  Generates ready-to-apply fixes for every issue found. Code fixes go to a PR; config fixes produce Vercel/Nginx/DNS snippets.
                </p>
              </div>
            )}
          </div>

          {/* Fixes */}
          {fixResult && (
            <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-5 mb-4">
              {/* SSH auto-heal result */}
              {(fixResult as Record<string, unknown>).actions ? (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">{(fixResult as Record<string, unknown>).status === "healed" ? "✅" : "⚡"}</span>
                    <h3 className="font-bold text-gray-900">
                      {(fixResult as Record<string, unknown>).status === "healed"
                        ? "Server Healed"
                        : (fixResult as Record<string, unknown>).status === "partial"
                          ? "Partially Healed"
                          : "Heal Attempted"}
                    </h3>
                  </div>
                  <p className="text-sm text-gray-500 mb-3">
                    {(fixResult as Record<string, unknown>).message as string}
                  </p>
                  <div className="space-y-2">
                    {((fixResult as Record<string, unknown>).actions as Array<{ issue: string; command: string; output: string; status: string }>).map((a, i) => (
                      <div key={i} className={`rounded-lg border p-3 text-xs ${
                        a.status === "fixed" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={a.status === "fixed" ? "text-emerald-600" : "text-red-600"}>
                            {a.status === "fixed" ? "✓" : "✗"}
                          </span>
                          <span className="font-medium text-gray-800">{a.issue}</span>
                        </div>
                        <pre className="font-mono text-xs bg-gray-900 text-gray-300 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{a.output || "(no output)"}</pre>
                      </div>
                    ))}
                  </div>
                </>
              ) : (fixResult as Record<string, unknown>).fixes && Object.keys((fixResult as Record<string, unknown>).fixes as Record<string, unknown>).length > 0 ? (
                <NuclearFixSnippets fixResult={fixResult as Record<string, unknown>} />
              ) : (
                <div>
                  <h3 className="font-bold mb-2 text-gray-900">⚡ Fix attempted</h3>
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 mb-3">
                    <p className="text-sm text-amber-800 font-medium">SSH credentials not found</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Set these env vars in Vercel, then <strong>trigger a new deployment</strong> — env vars only take effect after redeployment.
                    </p>
                  </div>
                  <ul className="text-xs font-mono bg-gray-50 border border-gray-200 rounded p-3 space-y-1.5 text-gray-700">
                    <li><span className="text-emerald-700 font-bold">GATETEST_SSH_HOST</span> — server IP (e.g. 45.76.171.37)</li>
                    <li><span className="text-gray-500 font-bold">GATETEST_SSH_USER</span> — username (default: root)</li>
                    <li><span className="text-emerald-700 font-bold">GATETEST_SSH_PASSWORD</span> — server password</li>
                  </ul>
                  <p className="text-xs text-gray-400 mt-2">
                    Or use <span className="font-mono">GATETEST_SSH_KEY</span> (PEM private key) instead of a password.
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
              <div key={cat} className="rounded-xl bg-white border border-gray-200 shadow-sm p-4 mb-3">
                <h4 className="font-bold text-sm mb-2 text-gray-800">{cat}</h4>
                <div className="space-y-1">
                  {items.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-bold shrink-0 w-16 ${
                        f.severity === "error" ? "text-red-600" :
                        f.severity === "warning" ? "text-amber-600" :
                        f.severity === "pass" ? "text-emerald-600" :
                        "text-gray-400"
                      }`}>{f.severity.toUpperCase()}</span>
                      <span className="font-medium shrink-0 min-w-[140px] text-gray-700">{f.title}</span>
                      <span className="text-gray-400">{f.detail}</span>
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
