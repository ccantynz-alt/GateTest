/**
 * Admin Page — server-rendered entry point.
 *
 * Supports two auth methods (checked in order):
 *   1. GitHub OAuth session — HMAC-signed cookie, allowlisted by username
 *   2. Password-based cookie — HMAC-derived from GATETEST_ADMIN_PASSWORD
 *
 * If neither cookie is valid, renders the login UI.
 */

import { cookies } from "next/headers";
import { createHmac } from "crypto";
import {
  getAdminConfig,
  getAdminUser,
  SESSION_COOKIE_NAME,
} from "../lib/admin-session";
import { ADMIN_COOKIE_NAME } from "../lib/admin-auth";
import AdminPanel from "./AdminPanel";
import AdminLogin from "./AdminLogin";

const HMAC_PAYLOAD = "gatetest-admin-v1";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const params = await searchParams;

  // --- Auth check 1: GitHub OAuth session ---
  const adminConfig = getAdminConfig();
  if (adminConfig.ok && adminConfig.config) {
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const adminUser = getAdminUser(sessionCookie, adminConfig.config);
    if (adminUser) {
      return <AdminPanel adminLogin={adminUser} />;
    }
  }

  // --- Auth check 2: Password-based cookie ---
  const adminPassword = process.env.GATETEST_ADMIN_PASSWORD || "";
  if (adminPassword) {
    const passwordCookie = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
    if (passwordCookie) {
      const expectedToken = createHmac("sha256", adminPassword)
        .update(HMAC_PAYLOAD)
        .digest("hex");
      if (passwordCookie === expectedToken) {
        return <AdminPanel adminLogin="admin" />;
      }
    }
  }

  // --- Not authenticated — show login UI ---
  const hasGitHubOAuth = adminConfig.ok;
  const hasPasswordAuth = !!adminPassword;

  return (
    <AdminLogin
      hasGitHubOAuth={hasGitHubOAuth}
      hasPasswordAuth={hasPasswordAuth}
      error={params.error}
    />
  );
}
