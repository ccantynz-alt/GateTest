/**
 * Website URL Scan API — scans a live deployed URL without source code.
 *
 * POST /api/scan/url
 * Body: { url: string }
 *
 * Free scan — no GitHub account, no payment required.
 * Designed for non-technical users who just have a website URL.
 *
 * Returns: WebScanResult with plain-English findings + score 0-100.
 */

import { NextRequest, NextResponse } from "next/server";
import { scanWebsite } from "@/app/lib/website-scanner";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveAndValidateUrl } = require("@/app/lib/ssrf-guard") as {
  resolveAndValidateUrl: (input: string) => Promise<{ ok: true; url: URL } | { ok: false; reason: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createLimiter, PRESETS } = require("@lib/rate-limit") as {
  createLimiter: (opts: { windowMs: number; maxRequests: number }) => {
    guard: (req: NextRequest) => Promise<{ allowed: boolean; status?: number; body?: Record<string, unknown>; headers?: Record<string, string> }>;
  };
  PRESETS: Record<string, { windowMs: number; maxRequests: number }>;
};
const _urlScanLimiter = createLimiter(PRESETS.webScan);

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let url: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (!body.url || typeof body.url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    url = body.url.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ error: "url must not be empty" }, { status: 400 });
  }

  // Basic sanity — must be an http(s) URL or a bare domain
  if (
    !/^https?:\/\//i.test(url) &&
    !/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/.test(url)
  ) {
    return NextResponse.json(
      { error: "Please enter a website URL like https://example.com" },
      { status: 400 }
    );
  }

  // SSRF: resolve the hostname and refuse private / reserved / metadata /
  // tailnet targets BEFORE any request leaves the box. This route used to
  // pass a regex-checked string straight to fetch(redirect:"follow") — an
  // unauthenticated internal port scanner (2026-08-18 audit).
  const validated = await resolveAndValidateUrl(url);
  if (!validated.ok) {
    return NextResponse.json(
      { error: "That URL cannot be scanned: it does not resolve to a public internet address" },
      { status: 400 }
    );
  }
  const rl = await _urlScanLimiter.guard(req);
  if (!rl.allowed) {
    return NextResponse.json(rl.body || { error: "Too many scans — try again in a minute" }, { status: rl.status || 429, headers: rl.headers });
  }

  try {
    const result = await scanWebsite(validated.url.toString());
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json(
      { error: `Could not scan ${url}: ${msg}` },
      { status: 500 }
    );
  }
}
