/**
 * Customer GitLab OAuth — initiate login.
 *
 * GET /api/auth/gitlab → redirect to GitLab OAuth consent screen.
 * After consent, GitLab redirects to /api/auth/gitlab/callback.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGitLabOAuthConfig, generateState } from "../../../lib/customer-session";
import { authUnavailable } from "../../../lib/auth-unavailable";

export async function GET() {
  const status = getGitLabOAuthConfig();
  if (!status.ok || !status.config) {
    // Was a JSON body that also listed our unset env var names to an
    // anonymous visitor. See lib/auth-unavailable.ts.
    return authUnavailable("GitLab");
  }

  const { clientId, redirectUri } = status.config;
  const state = generateState();

  const cookieStore = await cookies();
  cookieStore.set("gl_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read_user",
    state,
  });

  return NextResponse.redirect(
    `https://gitlab.com/oauth/authorize?${params.toString()}`
  );
}
