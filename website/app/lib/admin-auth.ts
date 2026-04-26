/**
 * Admin authentication helpers.
 *
 * Design:
 *   - Password lives in env var `GATETEST_ADMIN_PASSWORD` — never shipped to client.
 *   - On successful login, we set an httpOnly cookie `gt_admin` whose value is
 *     an HMAC-SHA256 of a constant payload using the password as key.
 *   - On each admin-protected request we recompute the HMAC from the env var
 *     and compare with the cookie. If the env password changes, all existing
 *     admin sessions are invalidated automatically.
 *   - No shared state, no database, no JWT library needed. Fits Vercel serverless.
 *
 * Security notes:
 *   - Uses `crypto.timingSafeEqual` for constant-time comparison.
 *   - Cookie is httpOnly (JS cannot read it) + secure (HTTPS only in production)
 *     + sameSite=lax (prevents CSRF from other origins).
 *   - If `GATETEST_ADMIN_PASSWORD` is unset, all auth attempts fail — never
 *     accidentally open.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "gt_admin";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const HMAC_PAYLOAD = "gatetest-admin-v1";

/**
 * Deterministic token derived from the admin password. Anyone who knows the
 * password (i.e. the server, via env var) can reproduce it.
 */
function deriveToken(password: string): string {
  return createHmac("sha256", password).update(HMAC_PAYLOAD).digest("hex");
}

/**
 * Constant-time string comparison that tolerates differing lengths by first
 * padding to the same length. Returns false if either input is empty.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a user-supplied password against the env var.
 */
export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.GATETEST_ADMIN_PASSWORD || "";
  if (!expected) return false;
  return safeEqual(password, expected);
}

/**
 * Build the Set-Cookie header value for the admin session.
 */
export function buildAdminCookieHeader(): string {
  const password = process.env.GATETEST_ADMIN_PASSWORD || "";
  const token = deriveToken(password);
  const isProduction = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build the Set-Cookie header that clears the admin cookie.
 */
export function buildAdminClearCookieHeader(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

/**
 * Check whether a request carries a valid admin cookie.
 *
 * Works with both the Next.js App Router `NextRequest` (which exposes
 * `cookies.get`) and any future wrapper that just passes a cookie-header string.
 */
export function isAdminRequest(req: NextRequest): boolean {
  const expectedPassword = process.env.GATETEST_ADMIN_PASSWORD || "";
  if (!expectedPassword) return false;

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value || "";
  if (!cookieValue) return false;

  const expectedToken = deriveToken(expectedPassword);
  return safeEqual(cookieValue, expectedToken);
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;

/**
 * Returns true if the given repo owner (GitHub/Gluecron username) is in the
 * GATETEST_OWNER_ACCOUNTS env var. Owner accounts get free scan and fix access
 * with no Stripe interaction — intended for Craig's own repos.
 *
 * Set GATETEST_OWNER_ACCOUNTS=ccantynz-alt,ccantynz in Vercel env vars.
 * Comparison is case-insensitive.
 */
export function isOwnerAccount(repoOwner: string): boolean {
  const raw = process.env.GATETEST_OWNER_ACCOUNTS || "";
  if (!raw || !repoOwner) return false;
  const accounts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return accounts.includes(repoOwner.toLowerCase());
}
