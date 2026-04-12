/**
 * Admin Page — server-rendered entry point.
 *
 * Auth model: GitHub OAuth, allowlisted by username via GATETEST_ADMIN_USERNAMES.
 *
 * Flow:
 *   1. Read signed session cookie (HMAC-SHA256, 7-day expiry)
 *   2. Verify cookie and check GitHub login against allowlist
 *   3. If missing/invalid, show a sign-in CTA that redirects to /api/github/admin-login
 *   4. If the panel is not configured (missing env vars), show a clear notice
 *      instead of crashing (green ecosystem mandate: never leak data by default).
 */

import { cookies } from "next/headers";
import {
  getAdminConfig,
  getAdminUser,
  SESSION_COOKIE_NAME,
} from "../lib/admin-session";
import AdminPanel from "./AdminPanel";

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
    </div>
  );
}

function SignInPrompt({ error }: { error?: string }) {
  const messages: Record<string, string> = {
    invalid_state: "OAuth state mismatch. Please try again.",
    token_exchange_failed: "GitHub rejected the token exchange.",
    user_fetch_failed: "Could not read your GitHub profile.",
    not_authorized: "That GitHub account is not on the admin allowlist.",
  };
  const message = error ? messages[error] || "Sign in required." : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-2 text-center">Admin Access</h1>
        <p className="text-sm text-muted text-center mb-6">
          Sign in with GitHub to continue.
        </p>
        <a
          href="/api/github/admin-login"
          className="btn-primary w-full py-3 text-sm block text-center"
        >
          Sign in with GitHub
        </a>
        {message && (
          <p className="text-danger text-sm mt-4 text-center">{message}</p>
        )}
      </div>
    </div>
  );
}

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

  return <AdminPanel adminLogin={adminLogin} />;
}
