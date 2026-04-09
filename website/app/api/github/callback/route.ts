/**
 * GitHub App Installation Callback
 *
 * After a user installs the GateTest GitHub App, GitHub redirects here with
 * installation_id and setup_action parameters. We redirect to the success page.
 *
 * URL: https://gatetest.io/api/github/callback?installation_id=123&setup_action=install
 */

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const installationId = req.nextUrl.searchParams.get("installation_id");
  const setupAction = req.nextUrl.searchParams.get("setup_action");

  if (setupAction === "install" && installationId) {
    // TODO: Store installation_id in database for this customer
    // For now, redirect to success page
    return NextResponse.redirect(new URL("/github/installed", req.url));
  }

  // Handle uninstall or other actions
  if (setupAction === "update") {
    return NextResponse.redirect(new URL("/github/installed", req.url));
  }

  // Default: redirect to setup page
  return NextResponse.redirect(new URL("/github/setup", req.url));
}
