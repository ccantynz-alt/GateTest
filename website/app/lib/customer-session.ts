/**
 * Customer session utilities — HMAC-signed cookies for GitHub OAuth customer access.
 *
 * Reuses the same GitHub OAuth App as admin, but without the allowlist check.
 * Any GitHub user can sign in as a customer. Session lasts 30 days.
 */

import crypto from "crypto";

export const CUSTOMER_COOKIE_NAME = "gatetest_customer";
export const CUSTOMER_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface CustomerPayload {
  u: string; // GitHub login
  e: string; // email
  exp: number; // Unix seconds
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
}

export interface OAuthConfigStatus {
  ok: boolean;
  missing: string[];
  config?: OAuthConfig;
}

export function getOAuthConfig(): OAuthConfigStatus {
  const clientId = process.env.GITHUB_CLIENT_ID || "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || "";
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  const redirectUri = baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/api/auth/callback`
    : "";
  const sessionSecret = process.env.SESSION_SECRET || "";

  const missing: string[] = [];
  if (!clientId) missing.push("GITHUB_CLIENT_ID");
  if (!clientSecret) missing.push("GITHUB_CLIENT_SECRET");
  if (!redirectUri) missing.push("NEXT_PUBLIC_BASE_URL");
  if (!sessionSecret) missing.push("SESSION_SECRET");

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    missing: [],
    config: { clientId, clientSecret, redirectUri, sessionSecret },
  };
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str: string): Buffer {
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string, secret: string): string {
  return b64urlEncode(
    crypto.createHmac("sha256", secret).update(payload).digest()
  );
}

export function signCustomerSession(
  login: string,
  email: string,
  secret: string
): string {
  const payload: CustomerPayload = {
    u: login,
    e: email,
    exp: Math.floor(Date.now() / 1000) + CUSTOMER_MAX_AGE_SECONDS,
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = sign(encoded, secret);
  return `${encoded}.${sig}`;
}

export function verifyCustomerSession(
  token: string | undefined | null,
  secret: string
): CustomerPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;

  const expectedSig = sign(encoded, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let payload: CustomerPayload;
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString("utf-8"));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof payload.u !== "string" || !payload.u) return null;

  return payload;
}

export function generateState(): string {
  return b64urlEncode(crypto.randomBytes(24));
}
