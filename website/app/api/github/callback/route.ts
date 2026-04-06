/**
 * GitHub OAuth Callback
 *
 * After a user installs the GateTest GitHub App or authorizes via OAuth,
 * GitHub redirects here with a code. We exchange it for user info,
 * create/update their account, and redirect to the dashboard.
 *
 * Two flows land here:
 *   1. App installation → ?installation_id=123&setup_action=install
 *   2. OAuth authorize  → ?code=abc123&state=xyz
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL = process.env.GATETEST_APP_URL || "https://gatetest.io";

function githubPost(
  path: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "github.com",
        path,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
          "User-Agent": "GateTest-App/1.0.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("GitHub token exchange failed"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function githubGet(
  path: string,
  token: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "GateTest-App/1.0.0",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error("GitHub API request failed"));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // ── Flow 1: App installation callback ────────────────
  const installationId = params.get("installation_id");
  const setupAction = params.get("setup_action");

  if (installationId && setupAction) {
    // User just installed the app on their repos
    // Redirect to dashboard with installation context
    const url = new URL("/dashboard", APP_URL);
    url.searchParams.set("installation_id", installationId);
    url.searchParams.set("setup", setupAction);
    url.searchParams.set("status", "connected");
    return NextResponse.redirect(url.toString());
  }

  // ── Flow 2: OAuth code exchange ──────────────────────
  const code = params.get("code");

  if (!code) {
    return NextResponse.redirect(
      `${APP_URL}?error=no_code`
    );
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.redirect(
      `${APP_URL}?error=oauth_not_configured`
    );
  }

  try {
    // Exchange code for access token
    const tokenResult = await githubPost("/login/oauth/access_token", {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
    });

    const accessToken = tokenResult.access_token as string;
    if (!accessToken) {
      return NextResponse.redirect(
        `${APP_URL}?error=token_exchange_failed`
      );
    }

    // Get user info
    const user = await githubGet("/user", accessToken);

    // Redirect to dashboard with user context
    // In production, you'd set an httpOnly cookie here instead
    const url = new URL("/dashboard", APP_URL);
    url.searchParams.set("user", user.login as string);
    url.searchParams.set("status", "authenticated");

    const response = NextResponse.redirect(url.toString());

    // Set secure session cookie
    response.cookies.set("gatetest_token", accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    response.cookies.set("gatetest_user", user.login as string, {
      httpOnly: false, // Readable by client JS for UI
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[GateTest] OAuth callback error:", err);
    return NextResponse.redirect(
      `${APP_URL}?error=auth_failed`
    );
  }
}
