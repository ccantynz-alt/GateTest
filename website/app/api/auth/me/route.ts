/**
 * GET /api/auth/me — return current customer session info.
 * Returns { login, email } if authenticated, 401 if not.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getOAuthConfig,
  verifyCustomerSession,
  CUSTOMER_COOKIE_NAME,
} from "../../../lib/customer-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = getOAuthConfig();
  if (!status.ok || !status.config) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_COOKIE_NAME)?.value;
  const session = verifyCustomerSession(token, status.config.sessionSecret);

  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ login: session.u, email: session.e });
}
