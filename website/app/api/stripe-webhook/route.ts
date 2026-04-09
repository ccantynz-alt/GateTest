/**
 * Stripe Webhook Handler — Triggers scans after successful payment.
 *
 * Flow:
 * 1. Customer completes checkout → Stripe sends checkout.session.completed
 * 2. We extract repo URL and tier from session metadata
 * 3. We trigger the scan and update progress in real-time
 * 4. Scan completes → capture the payment
 * 5. Scan fails → cancel the payment intent (release hold)
 *
 * Environment: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import https from "https";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://gatetest.io";

function verifyStripeSignature(payload: string, sigHeader: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) return true; // Skip in dev

  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [key, val] = part.split("=");
      if (key === "t") acc.timestamp = val;
      if (key === "v1") acc.signatures.push(val);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  const signedPayload = `${parts.timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  return parts.signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

function stripeApi(
  method: string,
  path: string,
  body?: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.stripe.com",
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    if (body) {
      options.headers = {
        ...options.headers,
        "Content-Length": String(Buffer.byteLength(body)),
      };
    }
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function updateScanStatus(scanId: string, update: Record<string, unknown>) {
  try {
    await fetch(`${BASE_URL}/api/scan/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scanId, ...update }),
    });
  } catch {
    // Non-fatal — status update failed but scan continues
  }
}

async function runScan(sessionId: string, repoUrl: string, tier: string, paymentIntentId: string) {
  const modules =
    tier === "quick"
      ? ["syntax", "lint", "secrets", "codeQuality"]
      : [
          "syntax", "lint", "secrets", "codeQuality", "unitTests",
          "integrationTests", "e2e", "visual", "accessibility",
          "performance", "security", "seo", "links", "compatibility",
          "dataIntegrity", "documentation", "mutation", "aiReview",
        ];

  // Parse owner/repo from URL
  const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!repoMatch) {
    await updateScanStatus(sessionId, {
      status: "failed",
      error: "Invalid GitHub repository URL",
      progress: 0,
    });
    // Cancel payment — release hold
    await stripeApi("POST", `/v1/payment_intents/${paymentIntentId}/cancel`);
    return;
  }

  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");

  // Initialize scan state
  await updateScanStatus(sessionId, {
    repoUrl,
    tier,
    status: "cloning",
    progress: 5,
    currentModule: null,
    modules: modules.map((m) => ({ name: m, status: "pending" })),
    totalModules: modules.length,
    completedModules: 0,
    totalIssues: 0,
    totalFixed: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    reportUrl: null,
    error: null,
  });

  // Simulate scanning each module with real-time updates
  // In production, this calls the actual GateTest engine
  let totalIssues = 0;
  let totalFixed = 0;
  const moduleResults: Array<Record<string, unknown>> = [];

  for (let i = 0; i < modules.length; i++) {
    const moduleName = modules[i];
    const progress = Math.round(10 + (i / modules.length) * 85);

    // Mark current module as running
    const updatedModules = modules.map((m, j) => {
      if (j < i) return moduleResults[j] || { name: m, status: "passed" };
      if (j === i) return { name: m, status: "running" };
      return { name: m, status: "pending" };
    });

    await updateScanStatus(sessionId, {
      status: "scanning",
      progress,
      currentModule: moduleName,
      modules: updatedModules,
      completedModules: i,
    });

    // TODO: Replace with actual GateTest scan execution via GitHub API
    // For now, simulate with a small delay per module
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));

    // Simulated result (replace with real scan)
    const issues = Math.random() > 0.7 ? Math.floor(Math.random() * 5) + 1 : 0;
    const checks = Math.floor(Math.random() * 30) + 5;
    const duration = Math.floor(Math.random() * 500) + 50;

    totalIssues += issues;
    const fixed = issues > 0 && (tier === "fix" || tier === "nuclear") ? Math.floor(issues * 0.6) : 0;
    totalFixed += fixed;

    moduleResults[i] = {
      name: moduleName,
      status: issues > 0 ? "failed" : "passed",
      checks,
      issues,
      duration,
      message: issues > 0 ? `${issues} issue${issues > 1 ? "s" : ""} found` : undefined,
    };
  }

  // Auto-fix phase
  if ((tier === "fix" || tier === "nuclear") && totalFixed > 0) {
    await updateScanStatus(sessionId, {
      status: "fixing",
      progress: 95,
      currentModule: null,
      totalFixed,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Complete
  await updateScanStatus(sessionId, {
    status: "complete",
    progress: 100,
    currentModule: null,
    modules: moduleResults,
    completedModules: modules.length,
    totalIssues,
    totalFixed,
    completedAt: new Date().toISOString(),
  });

  // Capture the payment — scan delivered successfully
  await stripeApi("POST", `/v1/payment_intents/${paymentIntentId}/capture`);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  if (!verifyStripeSignature(body, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(body);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const paymentIntentId = session.payment_intent;
    const metadata = session.metadata || {};

    // Also check payment_intent metadata (we set it there in checkout)
    let tier = metadata.tier;
    let repoUrl = metadata.repo_url;

    if (!tier || !repoUrl) {
      // Fetch from payment intent metadata
      const pi = await stripeApi("GET", `/v1/payment_intents/${paymentIntentId}`);
      const piMeta = (pi.metadata || {}) as Record<string, string>;
      tier = tier || piMeta.tier;
      repoUrl = repoUrl || piMeta.repo_url;
    }

    if (tier && repoUrl && paymentIntentId) {
      // Fire and forget — don't block the webhook response
      runScan(session.id, repoUrl, tier, paymentIntentId).catch((err) => {
        console.error("[GateTest] Scan failed:", err);
      });
    }
  }

  return NextResponse.json({ received: true });
}
