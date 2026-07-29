/**
 * GET /api/integrations/sentry/connect
 *
 * Phase 5.3.1 — Sentry OAuth flow START. Redirects the customer to
 * Sentry's authorization page. After they approve, Sentry redirects
 * back to /api/integrations/sentry/callback with a `code` param.
 *
 * Required env vars (BOSS RULE territory — Craig must add to Vercel):
 *   SENTRY_CLIENT_ID
 *   SENTRY_CLIENT_SECRET
 *
 * Until those are set, this route returns a clear "not configured"
 * message rather than failing silently.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { SITE_URL } from "@/app/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const clientId = process.env.SENTRY_CLIENT_ID || "";
  // SITE_URL, not a raw env read — this builds the OAuth redirect_uri, and
  // Sentry compares it by exact string match. A trailing slash in the env var
  // silently breaks the callback.
  const baseUrl = SITE_URL;
  const url = new URL(req.url);
  const repoUrl = url.searchParams.get("repoUrl");

  if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        error: "SENTRY_CLIENT_ID is not configured. Sentry integration not yet active.",
        hint: "Add SENTRY_CLIENT_ID + SENTRY_CLIENT_SECRET in Vercel env vars to enable.",
      },
      { status: 503 }
    );
  }
  if (!repoUrl) {
    return NextResponse.json(
      { ok: false, error: "repoUrl query parameter is required" },
      { status: 400 }
    );
  }

  // CSRF protection — random state + repoUrl encoded together. The
  // callback verifies the state matches before exchanging the code.
  const state = crypto.randomBytes(16).toString("hex") + ":" + Buffer.from(repoUrl).toString("base64url");
  const redirectUri = `${baseUrl}/api/integrations/sentry/callback`;
  const authUrl = new URL("https://sentry.io/oauth/authorize/");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "project:read org:read event:read");
  authUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authUrl.toString());
  // Stash the state in a short-lived httpOnly cookie so the callback
  // can verify it. 10-minute expiry is plenty for an OAuth flow.
  res.cookies.set("gatetest_sentry_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/sentry",
  });
  return res;
}
