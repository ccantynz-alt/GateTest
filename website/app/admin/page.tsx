"use client";

import { useState } from "react";

/**
 * Admin console — run scans on any repo without payment.
 *
 * Auth flow:
 *   1. User types password → POST /api/admin/auth
 *   2. Server verifies against GATETEST_ADMIN_PASSWORD env var (constant time)
 *   3. On success, server sets an httpOnly cookie. The browser sends it
 *      automatically on subsequent /api/scan/run requests, where it bypasses
 *      Stripe entirely.
 *
 * The password is NEVER stored in this file or the JS bundle. It never touches
 * localStorage or sessionStorage. It lives in React state for the duration of
 * the login request and is then discarded.
 */
export default function AdminPage() {
  const [auth, setAuth] = useState(false);
  const [password, setPassword] = useState("");
  const [authing, setAuthing] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [tier, setTier] = useState("quick");
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function login() {
    setError("");
    if (!password) {
      setError("Enter a password");
      return;
    }
    setAuthing(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
      });
      if (res.ok) {
        setAuth(true);
        setPassword(""); // discard from memory
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid password");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setAuthing(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE", credentials: "same-origin" });
    setAuth(false);
    setResult(null);
    setRepoUrl("");
  }

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-sm w-full">
          <h1 className="text-2xl font-bold mb-2 text-center">Admin Access</h1>
          <p className="text-xs text-muted text-center mb-6">
            Password is verified server-side against the GATETEST_ADMIN_PASSWORD
            environment variable.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") login(); }}
            placeholder="Enter admin password"
            className="w-full px-4 py-3 rounded-xl border border-border bg-surface-solid text-foreground text-sm mb-3"
            autoFocus
          />
          <button
            onClick={login}
            disabled={authing}
            className="btn-primary w-full py-3 text-sm disabled:opacity-50"
          >
            {authing ? "Verifying..." : "Enter"}
          </button>
          {error && <p className="text-danger text-sm mt-2 text-center">{error}</p>}
        </div>
      </div>
    );
  }

  async function runScan() {
    if (!repoUrl.includes("github.com")) {
      setError("Enter a valid GitHub repo URL");
      return;
    }

    setScanning(true);
    setResult(null);
    setError("");

    try {
      const res = await fetch("/api/scan/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl, tier }),
        credentials: "same-origin",
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const modules = (result?.modules as Array<Record<string, unknown>>) || [];
  const totalIssues = (result?.totalIssues as number) || 0;
  const adminMode = result?.admin === true;

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">GateTest Admin</h1>
            <p className="text-sm text-muted">Run scans on any repo. No payment required.</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={logout} className="text-sm text-muted hover:text-foreground">
              Log out
            </button>
            <a href="/" className="text-sm text-muted hover:text-foreground">&larr; Back to site</a>
          </div>
        </div>

        {/* Scan form */}
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
              <option value="full">Full (13 modules via GitHub API)</option>
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

        {/* Scanning state */}
        {scanning && (
          <div className="card p-8 text-center">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted">Scanning {repoUrl}...</p>
          </div>
        )}

        {/* Results */}
        {result && !scanning && (
          <div className="space-y-4">
            {/* Summary */}
            <div className={`card p-6 ${totalIssues === 0 ? "border-success" : "border-danger"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {totalIssues === 0 ? "All Clear" : `${totalIssues} Issues Found`}
                  </h2>
                  <p className="text-sm text-muted">
                    {modules.length} modules &middot; {result.duration as number}ms
                    {adminMode && " \u00b7 admin mode (no charge)"}
                  </p>
                </div>
                <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                  totalIssues === 0 ? "bg-green-50 text-success" : "bg-red-50 text-danger"
                }`}>
                  {totalIssues === 0 ? "PASSED" : "BLOCKED"}
                </span>
              </div>
            </div>

            {/* Module results */}
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
      </div>
    </div>
  );
}
