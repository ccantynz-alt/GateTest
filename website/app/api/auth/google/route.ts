/**
 * Customer Google OAuth — initiate login.
 *
 * GET /api/auth/google → redirect to Google OAuth consent screen.
 * After consent, Google redirects to /api/auth/google/callback.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGoogleOAuthConfig, generateState } from "../../../lib/customer-session";
import { authUnavailable } from "../../../lib/auth-unavailable";

export async function GET() {
  const status = getGoogleOAuthConfig();
  if (!status.ok || !status.config) {
    // Was a JSON body that also listed our unset env var names to an
    // anonymous visitor. See lib/auth-unavailable.ts.
    return authUnavailable("Google");
  }

  const { clientId, redirectUri } = status.config;
  const state = generateState();

  const cookieStore = await cookies();
  cookieStore.set("goog_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
