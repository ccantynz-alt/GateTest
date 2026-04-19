"use client";

import { useState, useEffect, useCallback } from "react";
import LiveScanTerminal from "@/app/components/LiveScanTerminal";

interface FixResult {
  status: string;
  prUrl?: string;
  prNumber?: number;
  filesFixed?: number;
  issuesFixed?: number;
  message?: string;
  error?: string;
  errors?: string[];
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
  const [dbData, setDbData] = useState<DbData | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"scan" | "server" | "scans" | "customers" | "keys">("scan");
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
    setError("");
  }

  async function fixIssues() {
    if (!result || !repoUrl) return;
    const failedMods = modules.filter((m) => (m.status as string) === "failed");
    const issues = failedMods.flatMap((m) => {
      const details = (m.details as string[]) || [];
      return details.map((d) => {
        const colonIdx = d.indexOf(":");
        const file = colonIdx > 0 ? d.slice(0, colonIdx).trim() : "";
        const issue = colonIdx > 0 ? d.slice(colonIdx + 1).trim() : d;
        return { file, issue, module: m.name as string };
      });
    }).filter((i) => i.file);

    if (issues.length === 0) {
      setError("No fixable issues found (issues need file paths)");
      return;
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
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">GateTest Admin</h1>
            <p className="text-sm text-muted">
              Signed in as <span className="font-mono">{adminLogin}</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/admin/health"
              className="text-sm px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors font-medium"
            >
              Run Self-Test
            </a>
            <a href="/" className="text-sm text-muted hover:text-foreground">
              &larr; Back to site
            </a>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">{stats.total_scans}</p>
              <p className="text-xs text-muted">Total Scans</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">{stats.total_customers}</p>
              <p className="text-xs text-muted">Customers</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">
                ${Number(stats.total_revenue || 0).toFixed(0)}
              </p>
              <p className="text-xs text-muted">Revenue</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">{stats.avg_score || 0}</p>
              <p className="text-xs text-muted">Avg Score</p>
            </div>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 mb-6 border-b border-border">
          {(["scan", "server", "scans", "customers", "keys"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab === "scan"
                ? "Repo Scan"
                : tab === "server"
                ? "Server Scan"
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
          <div className="card p-4 mb-6 border-l-4 border-l-yellow-400">
            <p className="text-sm text-muted">{dbData.note}</p>
            <button onClick={initDb} className="btn-primary px-4 py-2 text-xs mt-2">
              Initialize Database
            </button>
          </div>
        )}

        {/* Tab: Run Scan */}
        {activeTab === "scan" && (
          <>
            <div className="card p-6 mb-8">
              <div className="grid sm:grid-cols-[1fr,auto,auto] gap-3">
                <input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm w-full"
                />
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className="px-4 py-3 rounded-xl border border-border bg-white text-foreground text-sm"
                >
                  <option value="quick">Quick (4 modules)</option>
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
                        <button
                          onClick={fixIssues}
                          disabled={fixing}
                          className="btn-primary px-4 py-2 text-xs disabled:opacity-50"
                          style={{ background: "#059669" }}
                        >
                          {fixing ? "AI Fixing..." : `Fix ${totalIssues} Issues (AI + PR)`}
                        </button>
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
                      </>
                    )}
                  </div>
                </div>

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
                    ) : fixResult.status === "no_fixes" ? (
                      <p className="text-sm text-muted">{fixResult.message || "No fixes could be generated"}</p>
                    ) : (
                      <>
                        <p className="font-medium text-accent">{fixResult.error || "Fix partially completed"}</p>
                        {fixResult.errors && fixResult.errors.length > 0 && (
                          <ul className="mt-2 text-xs text-muted space-y-1">
                            {fixResult.errors.map((e, i) => <li key={i}>&rarr; {e}</li>)}
                          </ul>
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

function ServerScanPanel() {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function runServerScan() {
    if (!url) { setError("Enter a URL"); return; }
    setScanning(true); setResult(null); setError("");
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
          </div>

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
