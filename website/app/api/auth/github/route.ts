/**
 * Customer GitHub OAuth — initiate login.
 *
 * GET /api/auth/github → redirect to GitHub OAuth consent screen.
 * After consent, GitHub redirects to /api/auth/callback.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getOAuthConfig, generateState } from "../../../lib/customer-session";
import { authUnavailable } from "../../../lib/auth-unavailable";

export async function GET() {
  const status = getOAuthConfig();
  if (!status.ok || !status.config) {
    // See lib/auth-unavailable.ts — a human clicked a button, so answer with
    // a page, not a JSON error body.
    return authUnavailable("GitHub");
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
