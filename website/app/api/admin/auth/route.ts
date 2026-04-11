/**
 * Admin authentication endpoint.
 *
 *   POST /api/admin/auth   → { password } → 200 + Set-Cookie  | 401
 *   DELETE /api/admin/auth → clears admin cookie (logout)
 *
 * Password is compared in constant time against the `GATETEST_ADMIN_PASSWORD`
 * environment variable. On success we set an httpOnly, SameSite=Lax cookie
 * derived from the password via HMAC — see app/lib/admin-auth.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminPassword,
  buildAdminCookieHeader,
  buildAdminClearCookieHeader,
} from "@/app/lib/admin-auth";

export async function POST(req: NextRequest) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const password = (body.password || "").toString();

  if (!password) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  if (!process.env.GATETEST_ADMIN_PASSWORD) {
    // Fail loudly so a misconfigured deployment cannot silently allow access.
    return NextResponse.json(
      { error: "Admin access is not configured on this server" },
      { status: 503 },
    );
  }

  if (!verifyAdminPassword(password)) {
    // Small delay to blunt trivial brute-force attempts on the endpoint.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildAdminCookieHeader());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildAdminClearCookieHeader());
  return response;
}
