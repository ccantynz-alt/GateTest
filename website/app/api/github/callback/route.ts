/**
 * GitHub App Installation Callback
 *
 * After a user installs the GateTest GitHub App, GitHub redirects here with
 * installation_id and setup_action parameters. We persist the installation_id
 * against the currently-signed-in customer (if any), then redirect to the
 * success page.
 *
 * URL: https://gatetest.io/api/github/callback?installation_id=123&setup_action=install
 *
 * Persistence: Neon Postgres `installations` table via
 * `website/app/lib/installation-store.js`. Per the Bible, installation_id is
 * a long-lived mapping (not per-scan state), so the database is the correct
 * layer — Stripe metadata is reserved for scan state.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "../../../lib/db";
import {
  getOAuthConfig,
  verifyCustomerSession,
  CUSTOMER_COOKIE_NAME,
} from "../../../lib/customer-session";
// CommonJS helper — imported the same way as gluecron-callback.js
import {
  ensureInstallationsTable,
  persistInstallation,
} from "../../../lib/installation-store";

async function getActiveCustomer(): Promise<{ email: string | null; login: string | null }> {
  const status = getOAuthConfig();
  if (!status.ok || !status.config) return { email: null, login: null };

  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE_NAME)?.value;
  const session = verifyCustomerSession(token, status.config.sessionSecret);
  if (!session) return { email: null, login: null };

  return { email: session.e || null, login: session.u || null };
}

async function storeInstallation(
  installationId: string,
  setupAction: string
): Promise<void> {
  // Silently skip if DATABASE_URL is not configured — persistence is
  // best-effort at callback time; the user must still land on the success
  // page even if the DB is unreachable.
  if (!process.env.DATABASE_URL) return;

  try {
    const sql = getDb();
    await ensureInstallationsTable(sql);
    const { email, login } = await getActiveCustomer();
    await persistInstallation({
      installationId,
      customerEmail: email,
      customerLogin: login,
      setupAction,
      sql,
    });
  } catch (err) {
    // Never block the redirect on persistence failure. Log for visibility.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[github-callback] installation persistence failed:", msg);
  }
}

export async function GET(req: NextRequest) {
  const installationId = req.nextUrl.searchParams.get("installation_id");
  const setupAction = req.nextUrl.searchParams.get("setup_action");

  if (setupAction === "install" && installationId) {
    await storeInstallation(installationId, setupAction);
    return NextResponse.redirect(new URL("/github/installed", req.url));
  }

  // Handle uninstall or other actions
  if (setupAction === "update" && installationId) {
    await storeInstallation(installationId, setupAction);
    return NextResponse.redirect(new URL("/github/installed", req.url));
  }

  // Default: redirect to setup page
  return NextResponse.redirect(new URL("/github/setup", req.url));
}
