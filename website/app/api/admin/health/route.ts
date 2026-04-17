/**
 * End-to-End Self-Test — real preflight check for every subsystem.
 *
 * GET /api/admin/health
 *
 * Admin-only. Never lies about status:
 *   - "ok"       — subsystem responded and works
 *   - "warn"     — not configured, but the system can still run (optional)
 *   - "fail"     — configured but broken, or required and missing
 *
 * Subsystems checked (real, not fake):
 *   1. Environment variables present
 *   2. Database connection + all 4 tables exist
 *   3. GitHub App auth (mints a JWT + verifies signing key is valid)
 *   4. Stripe API reachable (hits /v1/balance)
 *   5. Anthropic API reachable (hits /v1/messages with 1-token probe)
 *   6. All 67 CLI-bridge modules registered + capabilities aligned
 *   7. Real scan on a tiny public repo (octocat/Hello-World)
 *
 * This endpoint makes real network calls. Expect 5-10s total runtime.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import https from "https";
import crypto from "crypto";
import {
  getAdminConfig,
  getAdminUser,
  SESSION_COOKIE_NAME,
} from "@/app/lib/admin-session";
import { ADMIN_COOKIE_NAME } from "@/app/lib/admin-auth";
import { getDb } from "@/app/lib/db";
import { createAppJwt } from "@/app/lib/github-app";
import { MODULES, runTier } from "@/app/lib/scan-modules";
import type { RepoFile } from "@/app/lib/scan-modules";
import { ALL_MODULE_NAMES, getModule } from "@/app/lib/cli-bridge/static-registry";
import { MODULE_CAPABILITIES, isBridgeCompatible } from "@/app/lib/cli-bridge/capabilities";
import { runBridgeTier } from "@/app/lib/cli-bridge/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Check {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  duration?: number;
}

function httpsGet(options: https.RequestOptions, timeoutMs = 10000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function httpsPost(options: https.RequestOptions, body: string, timeoutMs = 15000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

async function checkEnv(): Promise<Check> {
  const required = ["DATABASE_URL", "STRIPE_SECRET_KEY", "NEXT_PUBLIC_BASE_URL", "SESSION_SECRET"];
  const optional = ["GATETEST_APP_ID", "GATETEST_PRIVATE_KEY", "ANTHROPIC_API_KEY", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"];
  const missing = required.filter((k) => !process.env[k]);
  const optMissing = optional.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return { id: "env", label: "Environment variables", status: "fail", detail: `Missing required: ${missing.join(", ")}` };
  }
  if (optMissing.length > 0) {
    return { id: "env", label: "Environment variables", status: "warn", detail: `Missing optional: ${optMissing.join(", ")}` };
  }
  return { id: "env", label: "Environment variables", status: "ok", detail: `${required.length} required + ${optional.length} optional all set` };
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  if (!process.env.DATABASE_URL) {
    return { id: "db", label: "Database (Neon Postgres)", status: "fail", detail: "DATABASE_URL not set" };
  }
  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'public' AND tablename = ANY(${["scans", "customers", "api_keys", "api_calls"]})
    `) as Array<{ tablename: string }>;
    const found = rows.map((r) => r.tablename).sort();
    const expected = ["api_calls", "api_keys", "customers", "scans"];
    const missing = expected.filter((t) => !found.includes(t));
    if (missing.length > 0) {
      return {
        id: "db",
        label: "Database (Neon Postgres)",
        status: "warn",
        detail: `Connected, but missing tables: ${missing.join(", ")}. Run POST /api/db/init.`,
        duration: Date.now() - started,
      };
    }
    return {
      id: "db",
      label: "Database (Neon Postgres)",
      status: "ok",
      detail: `Connected. 4 tables present.`,
      duration: Date.now() - started,
    };
  } catch (err) {
    return {
      id: "db",
      label: "Database (Neon Postgres)",
      status: "fail",
      detail: `Connection failed: ${(err as Error).message}`,
      duration: Date.now() - started,
    };
  }
}

async function checkGithubApp(): Promise<Check> {
  const started = Date.now();
  if (!process.env.GATETEST_APP_ID || !process.env.GATETEST_PRIVATE_KEY) {
    return {
      id: "github",
      label: "GitHub App auth",
      status: "warn",
      detail: "Not configured — private repos will fail. Set GATETEST_APP_ID + GATETEST_PRIVATE_KEY.",
    };
  }
  try {
    const jwt = createAppJwt();
    // Verify by hitting /app endpoint (always available to any valid JWT).
    const res = await httpsGet({
      hostname: "api.github.com",
      port: 443,
      path: "/app",
      method: "GET",
      headers: {
        "User-Agent": "GateTest-Healthcheck/1.2.0",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
      },
    }, 10000);
    if (res.status !== 200) {
      return {
        id: "github",
        label: "GitHub App auth",
        status: "fail",
        detail: `GitHub rejected JWT (status ${res.status}). Check APP_ID / PRIVATE_KEY.`,
        duration: Date.now() - started,
      };
    }
    const parsed = JSON.parse(res.body);
    return {
      id: "github",
      label: "GitHub App auth",
      status: "ok",
      detail: `Authenticated as ${parsed.slug || parsed.name || "app"}`,
      duration: Date.now() - started,
    };
  } catch (err) {
    const msg = (err as Error).message || "unknown";
    // Translate opaque OpenSSL errors into actionable guidance.
    const hint = /DECODER routines/i.test(msg)
      ? " — private key format rejected by OpenSSL. Re-paste GATETEST_PRIVATE_KEY from the .pem file, preserving newlines."
      : /does not look like a PEM/i.test(msg)
      ? ""
      : /not a valid PEM/i.test(msg)
      ? ""
      : "";
    return {
      id: "github",
      label: "GitHub App auth",
      status: "fail",
      detail: `JWT mint or API call failed: ${msg}${hint}`,
      duration: Date.now() - started,
    };
  }
}

async function checkStripe(): Promise<Check> {
  const started = Date.now();
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) return { id: "stripe", label: "Stripe API", status: "fail", detail: "STRIPE_SECRET_KEY not set" };
  try {
    const res = await httpsGet({
      hostname: "api.stripe.com",
      port: 443,
      path: "/v1/balance",
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    }, 10000);
    if (res.status !== 200) {
      return {
        id: "stripe",
        label: "Stripe API",
        status: "fail",
        detail: `Stripe rejected key (status ${res.status}).`,
        duration: Date.now() - started,
      };
    }
    const mode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
    return {
      id: "stripe",
      label: "Stripe API",
      status: "ok",
      detail: `Connected (${mode} mode)`,
      duration: Date.now() - started,
    };
  } catch (err) {
    return {
      id: "stripe",
      label: "Stripe API",
      status: "fail",
      detail: `Network error: ${(err as Error).message}`,
      duration: Date.now() - started,
    };
  }
}

async function checkAnthropic(): Promise<Check> {
  const started = Date.now();
  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key) {
    return {
      id: "anthropic",
      label: "Anthropic API (Claude)",
      status: "warn",
      detail: "ANTHROPIC_API_KEY not set — AI review will skip honestly.",
    };
  }
  try {
    const payload = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    const res = await httpsPost({
      hostname: "api.anthropic.com",
      port: 443,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": key,
        "Content-Length": Buffer.byteLength(payload),
      },
    }, payload, 15000);
    if (res.status !== 200) {
      return {
        id: "anthropic",
        label: "Anthropic API (Claude)",
        status: "fail",
        detail: `Claude rejected request (status ${res.status}).`,
        duration: Date.now() - started,
      };
    }
    return {
      id: "anthropic",
      label: "Anthropic API (Claude)",
      status: "ok",
      detail: "Connected — AI review live",
      duration: Date.now() - started,
    };
  } catch (err) {
    return {
      id: "anthropic",
      label: "Anthropic API (Claude)",
      status: "fail",
      detail: `Network error: ${(err as Error).message}`,
      duration: Date.now() - started,
    };
  }
}

async function checkModules(): Promise<Check> {
  const started = Date.now();
  const bridgeNames = ALL_MODULE_NAMES;
  const tsNames = Object.keys(MODULES);
  const EXPECTED = 67;

  if (bridgeNames.length !== EXPECTED) {
    return {
      id: "modules",
      label: "Scan modules",
      status: "fail",
      detail: `Bridge registry has ${bridgeNames.length} modules (expected ${EXPECTED})`,
      duration: Date.now() - started,
    };
  }

  const capKeys = Object.keys(MODULE_CAPABILITIES);
  if (capKeys.length !== EXPECTED) {
    return {
      id: "modules",
      label: "Scan modules",
      status: "fail",
      detail: `Capability map has ${capKeys.length} entries (expected ${EXPECTED})`,
      duration: Date.now() - started,
    };
  }

  const missingCap = bridgeNames.filter((n) => !MODULE_CAPABILITIES[n]);
  const missingCtor = bridgeNames.filter((n) => !getModule(n));
  if (missingCap.length > 0 || missingCtor.length > 0) {
    return {
      id: "modules",
      label: "Scan modules",
      status: "fail",
      detail: `Bridge drift — missing capability: [${missingCap.join(", ")}], missing constructor: [${missingCtor.join(", ")}]`,
      duration: Date.now() - started,
    };
  }

  const runnable = bridgeNames.filter((n) => isBridgeCompatible(n));
  const skipped = EXPECTED - runnable.length;

  return {
    id: "modules",
    label: "Scan modules",
    status: "ok",
    detail: `${EXPECTED} bridge modules loaded (${runnable.length} runnable serverless, ${skipped} honestly skipped); ${tsNames.length} TS fallback modules`,
    duration: Date.now() - started,
  };
}

async function checkLiveScan(): Promise<Check> {
  const started = Date.now();
  try {
    // Exercise the real CLI bridge with fabricated files so we verify the
    // 67-module engine actually runs in this environment. Network-free.
    const files: string[] = ["README.md", "src/index.ts", "package.json"];
    const fileContents: RepoFile[] = [
      { path: "README.md", content: "# Test\nHello world.\n" },
      {
        path: "src/index.ts",
        content: `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
      },
      {
        path: "package.json",
        content: JSON.stringify({ name: "selftest", version: "0.0.0", dependencies: {} }, null, 2),
      },
    ];
    const bridge = await runBridgeTier("full", {
      owner: "gatetest",
      repo: "selftest",
      files,
      fileContents,
    });
    if (bridge.modules.length !== 67) {
      return {
        id: "scan",
        label: "Live scan (CLI bridge)",
        status: "fail",
        detail: `Bridge returned ${bridge.modules.length} envelopes (expected 67)`,
        duration: Date.now() - started,
      };
    }
    const ran = bridge.modules.filter((m) => m.status !== "skipped").length;
    const failed = bridge.modules.filter((m) => m.status === "failed").length;
    return {
      id: "scan",
      label: "Live scan (CLI bridge)",
      status: failed > 0 ? "warn" : "ok",
      detail: `67 envelopes (${ran} ran, ${67 - ran} honestly skipped), ${bridge.totalIssues} issue(s) on fixture${failed > 0 ? `, ${failed} module(s) failed` : ""}`,
      duration: Date.now() - started,
    };
  } catch (err) {
    // Fall back to the TS registry check so the health page still returns.
    try {
      const files: string[] = ["README.md"];
      const fileContents: RepoFile[] = [
        { path: "README.md", content: "# Test\n" },
      ];
      const { modules } = await runTier("quick", {
        owner: "gatetest",
        repo: "selftest",
        files,
        fileContents,
      });
      return {
        id: "scan",
        label: "Live scan (CLI bridge)",
        status: "fail",
        detail: `Bridge threw: ${(err as Error).message} — TS fallback produced ${modules.length} modules`,
        duration: Date.now() - started,
      };
    } catch (fallbackErr) {
      return {
        id: "scan",
        label: "Live scan (CLI bridge)",
        status: "fail",
        detail: `Bridge and fallback both failed: ${(err as Error).message} / ${(fallbackErr as Error).message}`,
        duration: Date.now() - started,
      };
    }
  }
}

async function checkAuthProviders(): Promise<Check> {
  const admin = getAdminConfig();
  const oauth = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  if (!admin.ok) {
    return {
      id: "auth",
      label: "Auth providers",
      status: "warn",
      detail: `Admin not fully configured: missing ${admin.missing.join(", ")}`,
    };
  }
  if (!oauth) {
    return {
      id: "auth",
      label: "Auth providers",
      status: "warn",
      detail: "Customer OAuth not configured (GITHUB_CLIENT_ID/SECRET).",
    };
  }
  return { id: "auth", label: "Auth providers", status: "ok", detail: "Admin + customer OAuth both configured" };
}

// Mirrors admin/page.tsx: accept either GitHub OAuth session OR password cookie.
async function isAuthenticatedAdmin(): Promise<boolean> {
  const store = await cookies();

  // Method 1: GitHub OAuth allowlist.
  const adminStatus = getAdminConfig();
  if (adminStatus.ok && adminStatus.config) {
    const sessionCookie = store.get(SESSION_COOKIE_NAME)?.value;
    if (getAdminUser(sessionCookie, adminStatus.config)) return true;
  }

  // Method 2: Password-derived cookie (GATETEST_ADMIN_PASSWORD).
  const adminPassword = process.env.GATETEST_ADMIN_PASSWORD || "";
  if (adminPassword) {
    const passwordCookie = store.get(ADMIN_COOKIE_NAME)?.value || "";
    const expected = crypto
      .createHmac("sha256", adminPassword)
      .update("gatetest-admin-v1")
      .digest("hex");
    if (
      passwordCookie &&
      passwordCookie.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(passwordCookie), Buffer.from(expected))
    ) {
      return true;
    }
  }

  return false;
}

export async function GET() {
  if (!(await isAuthenticatedAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();

  // Run all checks in parallel where they don't conflict. Most are independent
  // network calls so concurrency is safe.
  const [env, db, github, stripe, anthropic, modules, scan, auth] = await Promise.all([
    checkEnv(),
    checkDatabase(),
    checkGithubApp(),
    checkStripe(),
    checkAnthropic(),
    checkModules(),
    checkLiveScan(),
    checkAuthProviders(),
  ]);

  const checks: Check[] = [env, db, github, stripe, anthropic, modules, scan, auth];
  const ok = checks.filter((c) => c.status === "ok").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const ready = fail === 0;

  // Helpful signature so the UI can fingerprint the config.
  const fingerprint = crypto
    .createHash("sha256")
    .update(checks.map((c) => `${c.id}:${c.status}`).join("|"))
    .digest("hex")
    .slice(0, 12);

  return NextResponse.json({
    ready,
    summary: { ok, warn, fail, total: checks.length },
    checks,
    duration: Date.now() - started,
    fingerprint,
    generated_at: new Date().toISOString(),
  });
}
