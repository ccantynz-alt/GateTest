/**
 * GitHub App Setup / Installation Redirect
 *
 * This route handles the "Connect GitHub" button flow:
 *   1. GET /api/github/setup → redirects to GitHub App install page
 *   2. User selects repos and installs
 *   3. GitHub redirects back to /api/github/callback
 *
 * If the app doesn't exist yet (first time), it uses the
 * App Manifest flow to create it automatically.
 */

import { NextRequest, NextResponse } from "next/server";

const APP_SLUG = process.env.GATETEST_APP_SLUG || "gatetest-qa";
const APP_URL = process.env.GATETEST_APP_URL || "https://gatetest.io";
const APP_ID = process.env.GATETEST_APP_ID;
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "install";

  // ── Action: Install the app on repos ─────────────────
  if (action === "install") {
    if (!APP_SLUG) {
      return NextResponse.json(
        { error: "App not configured. Set GATETEST_APP_SLUG." },
        { status: 500 }
      );
    }
    // Send user to the GitHub App installation page
    // They pick which repos to give GateTest access to
    const installUrl = `https://github.com/apps/${APP_SLUG}/installations/new`;
    return NextResponse.redirect(installUrl);
  }

  // ── Action: OAuth login (link GitHub identity) ───────
  if (action === "login") {
    if (!CLIENT_ID) {
      return NextResponse.json(
        { error: "OAuth not configured. Set GITHUB_CLIENT_ID." },
        { status: 500 }
      );
    }
    const state = Math.random().toString(36).slice(2);
    const oauthUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(`${APP_URL}/api/github/callback`)}` +
      `&scope=read:user,user:email` +
      `&state=${state}`;
    return NextResponse.redirect(oauthUrl);
  }

  // ── Action: Create app via manifest (one-time admin) ─
  if (action === "create") {
    const manifest = {
      name: "GateTest",
      url: APP_URL,
      hook_attributes: {
        url: `${APP_URL}/api/webhook`,
        active: true,
      },
      redirect_url: `${APP_URL}/api/github/callback`,
      setup_url: `${APP_URL}/api/github/setup`,
      callback_urls: [`${APP_URL}/api/github/callback`],
      setup_on_update: true,
      public: true,
      default_permissions: {
        contents: "read",
        metadata: "read",
        statuses: "write",
        pull_requests: "write",
        issues: "write",
        checks: "write",
      },
      default_events: [
        "push",
        "pull_request",
        "installation",
        "installation_repositories",
        "check_suite",
      ],
    };

    // Return an HTML page with a form that auto-submits to GitHub
    // GitHub's manifest flow requires a POST with the manifest as form data
    const html = `<!DOCTYPE html>
<html>
<head><title>Create GateTest GitHub App</title></head>
<body>
  <p>Creating GateTest GitHub App... redirecting to GitHub.</p>
  <form id="f" method="post" action="https://github.com/settings/apps/new">
    <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replace(/'/g, "&#39;")}' />
  </form>
  <script>document.getElementById('f').submit();</script>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  // ── Status check ─────────────────────────────────────
  return NextResponse.json({
    configured: !!APP_ID,
    appSlug: APP_SLUG,
    hasOAuth: !!CLIENT_ID,
    installUrl: `https://github.com/apps/${APP_SLUG}/installations/new`,
    actions: ["install", "login", "create"],
  });
}

/**
 * POST /api/github/setup
 * Handles the manifest creation callback from GitHub.
 * GitHub POSTs back with the new app's credentials.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // GitHub returns: id, slug, client_id, client_secret, pem, webhook_secret
    // In production, store these securely. For now, display them for env setup.
    return NextResponse.json({
      message: "GitHub App created successfully! Set these as environment variables:",
      env: {
        GATETEST_APP_ID: body.id,
        GATETEST_APP_SLUG: body.slug,
        GITHUB_CLIENT_ID: body.client_id,
        GITHUB_CLIENT_SECRET: body.client_secret,
        GATETEST_WEBHOOK_SECRET: body.webhook_secret,
        GATETEST_PRIVATE_KEY: "(saved — check GitHub App settings)",
      },
      next_steps: [
        "Set these env vars in Vercel dashboard",
        "Redeploy the site",
        "Install the app on your repos",
      ],
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process GitHub App creation" },
      { status: 500 }
    );
  }
}
