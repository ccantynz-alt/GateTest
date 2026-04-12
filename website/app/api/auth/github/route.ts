/**
 * Customer GitHub OAuth — initiate login.
 *
 * GET /api/auth/github → redirect to GitHub OAuth consent screen.
 * After consent, GitHub redirects to /api/auth/callback.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOAuthConfig, generateState } from "../../../lib/customer-session";

export async function GET() {
  const status = getOAuthConfig();
  if (!status.ok || !status.config) {
    return NextResponse.json(
      { error: "GitHub login not configured" },
      { status: 503 }
    );
  }

  const { clientId, redirectUri } = status.config;
  const state = generateState();

  // Store state in cookie for CSRF validation
  const cookieStore = await cookies();
  cookieStore.set("gh_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  );
}
