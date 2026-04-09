/**
 * Scan Status API — Reads scan result from Stripe payment intent metadata.
 *
 * GET /api/scan/status?id=<checkoutSessionId>
 *
 * Simple logic:
 * 1. Fetch checkout session from Stripe
 * 2. Fetch payment intent
 * 3. If scan_status exists in metadata → return the result
 * 4. If payment cancelled → return failed
 * 5. Otherwise → show scanning animation
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

function stripeGet(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.stripe.com",
        port: 443,
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
          } catch {
            resolve({});
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Stripe timeout")); });
    req.end();
  });
}

function parseModulesFromMetadata(meta: Record<string, string>): Array<Record<string, unknown>> {
  const modules: Array<Record<string, unknown>> = [];

  // Collect chunked module data: modules_0, modules_1, etc.
  let allModuleData = "";
  for (let i = 0; i < 10; i++) {
    const chunk = meta[`modules_${i}`];
    if (!chunk) break;
    allModuleData += (allModuleData ? "|" : "") + chunk;
  }

  if (allModuleData) {
    for (const entry of allModuleData.split("|")) {
      const parts = entry.split(":");
      if (parts.length >= 5) {
        modules.push({
          name: parts[0],
          status: parts[1],
          checks: parseInt(parts[2]) || 0,
          issues: parseInt(parts[3]) || 0,
          duration: parseInt(parts[4]) || 0,
        });
      }
    }
  }

  // Fallback: use modules_list
  if (modules.length === 0 && meta.modules_list) {
    for (const name of meta.modules_list.split(",")) {
      if (name.trim()) {
        modules.push({ name: name.trim(), status: "passed", checks: 0, issues: 0, duration: 0 });
      }
    }
  }

  return modules;
}

function buildModuleAnimation(tier: string, startTime: number) {
  const moduleNames =
    tier === "quick"
      ? ["syntax", "lint", "secrets", "codeQuality"]
      : [
          "syntax", "lint", "secrets", "codeQuality", "unitTests",
          "integrationTests", "e2e", "visual", "accessibility",
          "performance", "security", "seo", "links", "compatibility",
          "dataIntegrity", "documentation", "mutation", "aiReview",
        ];

  // Progress based on time since scan started — never resets
  const elapsedMs = Date.now() - startTime;
  const totalEstimatedMs = moduleNames.length * 2000; // ~2s per module estimate
  const progress = Math.min(Math.round((elapsedMs / totalEstimatedMs) * 95) + 5, 95);
  const completed = Math.min(
    Math.floor((elapsedMs / totalEstimatedMs) * moduleNames.length),
    moduleNames.length - 1
  );

  return {
    status: "scanning" as const,
    progress,
    currentModule: moduleNames[completed],
    modules: moduleNames.map((name, i) => ({
      name,
      status: i < completed ? "passed" : i === completed ? "running" : "pending",
      checks: i < completed ? 5 + (i * 3) : 0,
      issues: 0,
      duration: i < completed ? 100 + (i * 50) : 0,
    })),
    totalModules: moduleNames.length,
    completedModules: completed,
    totalIssues: 0,
    totalFixed: 0,
  };
}

export async function GET(req: NextRequest) {
  const scanId = req.nextUrl.searchParams.get("id");

  if (!scanId || !STRIPE_SECRET_KEY) {
    return NextResponse.json({
      id: scanId, status: "pending", progress: 0, modules: [],
      totalModules: 0, completedModules: 0, totalIssues: 0, totalFixed: 0,
    });
  }

  try {
    // Step 1: Get checkout session
    const session = (await stripeGet(`/v1/checkout/sessions/${scanId}`)) as {
      payment_intent?: string;
      metadata?: Record<string, string>;
      status?: string;
      created?: number;
      error?: { message?: string };
    };

    if (session.error) {
      return NextResponse.json({
        id: scanId, status: "failed", progress: 0, modules: [],
        totalModules: 0, completedModules: 0, totalIssues: 0, totalFixed: 0,
        error: "Invalid scan ID",
      });
    }

    const sessionMeta = session.metadata || {};
    const tier = sessionMeta.tier || "full";
    const repoUrl = sessionMeta.repo_url || "";
    const sessionCreated = (session.created || Math.floor(Date.now() / 1000)) * 1000;

    // No payment intent — checkout not completed yet
    if (!session.payment_intent) {
      return NextResponse.json({
        id: scanId, status: "pending", progress: 0, modules: [],
        totalModules: 0, completedModules: 0, totalIssues: 0, totalFixed: 0,
        repoUrl, tier,
      });
    }

    // Step 2: Get payment intent
    const pi = (await stripeGet(`/v1/payment_intents/${session.payment_intent}`)) as {
      metadata?: Record<string, string>;
      status?: string;
    };

    const piMeta = pi.metadata || {};
    const piStatus = pi.status;

    // ──────────────────────────────────────────────────
    // PRIORITY 1: Check if scan_status exists in metadata
    // This is the DEFINITIVE answer — if it's there, the scan finished
    // ──────────────────────────────────────────────────
    if (piMeta.scan_status) {
      const modules = parseModulesFromMetadata(piMeta);

      return NextResponse.json({
        id: scanId,
        status: piMeta.scan_status === "complete" ? "complete" : "failed",
        progress: 100,
        modules,
        totalModules: parseInt(piMeta.total_modules || "0"),
        completedModules: parseInt(piMeta.total_modules || "0"),
        totalIssues: parseInt(piMeta.total_issues || "0"),
        totalFixed: parseInt(piMeta.total_fixed || "0"),
        repoUrl: piMeta.repo_url || repoUrl,
        tier: piMeta.tier || tier,
        completedAt: piMeta.scan_completed,
        duration: parseInt(piMeta.scan_duration || "0"),
        error: piMeta.scan_status === "failed" ? (piMeta.scan_error || "Scan failed") : null,
      });
    }

    // ──────────────────────────────────────────────────
    // PRIORITY 2: Payment cancelled without scan result
    // ──────────────────────────────────────────────────
    if (piStatus === "canceled") {
      return NextResponse.json({
        id: scanId,
        status: "failed",
        progress: 0,
        modules: [],
        totalModules: 0,
        completedModules: 0,
        totalIssues: 0,
        totalFixed: 0,
        repoUrl, tier,
        error: "Payment cancelled — card hold released",
      });
    }

    // ──────────────────────────────────────────────────
    // PRIORITY 3: Scan is still running — show animation
    // Progress is based on time since checkout, never resets
    // ──────────────────────────────────────────────────
    const animation = buildModuleAnimation(tier, sessionCreated);

    return NextResponse.json({
      id: scanId,
      ...animation,
      repoUrl, tier,
    });

  } catch (err) {
    return NextResponse.json({
      id: scanId, status: "failed", progress: 0, modules: [],
      totalModules: 0, completedModules: 0, totalIssues: 0, totalFixed: 0,
      error: `Error: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }
}
