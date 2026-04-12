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

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

function NotConfigured({ missing }: { missing: string[] }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-lg w-full card p-8">
        <h1 className="text-2xl font-bold mb-3">Admin panel not configured</h1>
        <p className="text-sm text-muted mb-4">
          The GateTest admin panel is intentionally locked down until the
          following environment variables are set on the server. No data is
          exposed until configuration is complete.
        </p>
        <ul className="text-sm font-mono bg-surface-solid rounded-lg p-4 space-y-1">
          {missing.map((m) => (
            <li key={m}>&rarr; {m}</li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-4">
          See <span className="font-mono">GITHUB-APP-SETUP.md</span> for setup
          instructions.
        </p>
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

export default async function AdminPage({ searchParams }: PageProps) {
  const status = getAdminConfig();
  if (!status.ok || !status.config) {
    return <NotConfigured missing={status.missing} />;
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const adminLogin = getAdminUser(sessionCookie, status.config);

  const params = await searchParams;

  if (!adminLogin) {
    return <SignInPrompt error={params.error} />;
  }

  return <AdminPanel adminLogin={adminLogin} />;
}
