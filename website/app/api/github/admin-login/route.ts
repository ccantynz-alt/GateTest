/**
 * GitHub OAuth — Admin Login Start
 *
 * Redirects to GitHub's OAuth authorize endpoint with a signed state cookie
 * so /api/github/admin-callback can validate the flow wasn't spoofed.
 *
 * URL: /api/github/admin-login
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminConfig, generateState } from "../../../lib/admin-session";

const STATE_COOKIE_NAME = "gatetest_admin_oauth_state";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const status = getAdminConfig();

  if (!status.ok || !status.config) {
    return NextResponse.json(
      {
        error: "Admin panel not configured",
        missing: status.missing,
      },
      { status: 503 }
    );
  }

  const { clientId, redirectUri } = status.config;
  const state = generateState();

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "false");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete the flow
  });
  return res;
}
