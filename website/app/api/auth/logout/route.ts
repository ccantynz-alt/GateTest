/**
 * Customer logout — clear session cookie.
 *
 * POST /api/auth/logout → clears customer cookie, redirects to home.
 */

import { NextResponse } from "next/server";
import { CUSTOMER_COOKIE_NAME } from "../../../lib/customer-session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `${CUSTOMER_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
  );
  return response;
}
