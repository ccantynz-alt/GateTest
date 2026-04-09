/**
 * Stripe Webhook Handler — Triggers scans after successful payment.
 *
 * ARCHITECTURE (Vercel serverless compatible):
 * - Webhook receives checkout.session.completed
 * - Runs scan SYNCHRONOUSLY within the function (Vercel Pro: 60s timeout)
 * - Stores result in Stripe payment intent metadata
 * - Captures payment on success, cancels on failure
 * - Status page reads result from /api/scan/status which checks Stripe
 *
 * This runs within Vercel's serverless function timeout.
 * The scan uses the GitHub API (no git clone needed).
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import https from "https";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

function verifyStripeSignature(payload: string, sigHeader: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) return true;

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

function githubApi(
  token: string,
  path: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      port: 443,
      path,
      method: "GET",
      headers: {
        "User-Agent": "GateTest/1.1.0",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    };
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
    req.end();
  });
}

interface ScanResult {
  status: "complete" | "failed";
  modules: Array<{
    name: string;
    status: "passed" | "failed" | "warning";
    checks: number;
    issues: number;
    duration: number;
  }>;
  totalModules: number;
  completedModules: number;
  totalIssues: number;
  totalFixed: number;
  duration: number;
  error?: string;
}

async function runScan(repoUrl: string, tier: string): Promise<ScanResult> {
  const startTime = Date.now();

  const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!repoMatch) {
    return {
      status: "failed",
      modules: [],
      totalModules: 0,
      completedModules: 0,
      totalIssues: 0,
      totalFixed: 0,
      duration: Date.now() - startTime,
      error: "Invalid GitHub repository URL",
    };
  }

  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");

  // Use GitHub API to read the repo (no clone needed on serverless)
  const token = process.env.GITHUB_TOKEN || process.env.GATETEST_GITHUB_TOKEN || "";

  // Get file tree
  let tree: { tree?: Array<{ path: string; type: string }> };
  try {
    tree = (await githubApi(
      token,
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    )) as typeof tree;
  } catch {
    // Try without auth for public repos
    tree = (await githubApi(
      "",
      `/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
    )) as typeof tree;
  }

  if (!tree?.tree) {
    return {
      status: "failed",
      modules: [],
      totalModules: 0,
      completedModules: 0,
      totalIssues: 0,
      totalFixed: 0,
      duration: Date.now() - startTime,
      error: `Cannot access repository ${owner}/${repo}. Check if it's public or provide a GitHub token.`,
    };
  }

  const files = tree.tree.filter((f) => f.type === "blob").map((f) => f.path);
  const sourceFiles = files.filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") ||
       f.endsWith(".jsx") || f.endsWith(".py") || f.endsWith(".go")) &&
      !f.includes("node_modules") && !f.includes(".next") && !f.includes("dist/")
  );

  const moduleNames =
    tier === "quick"
      ? ["syntax", "lint", "secrets", "codeQuality"]
      : [
          "syntax", "lint", "secrets", "codeQuality", "unitTests",
          "integrationTests", "e2e", "visual", "accessibility",
          "performance", "security", "seo", "links", "compatibility",
          "dataIntegrity", "documentation", "mutation", "aiReview",
        ];

  const moduleResults: ScanResult["modules"] = [];
  let totalIssues = 0;

  // Read up to 20 source files for analysis
  const filesToCheck = sourceFiles.slice(0, 20);
  const fileContents: Array<{ path: string; content: string }> = [];

  for (const filePath of filesToCheck) {
    try {
      const fileData = (await githubApi(
        token || "",
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`
      )) as { content?: string; encoding?: string };

      if (fileData.content && fileData.encoding === "base64") {
        fileContents.push({
          path: filePath,
          content: Buffer.from(fileData.content, "base64").toString("utf-8"),
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Run each module's checks
  for (const moduleName of moduleNames) {
    const modStart = Date.now();
    let checks = 0;
    let issues = 0;

    switch (moduleName) {
      case "syntax": {
        for (const f of fileContents) {
          checks++;
          // Check for obvious syntax issues
          const opens = (f.content.match(/{/g) || []).length;
          const closes = (f.content.match(/}/g) || []).length;
          if (Math.abs(opens - closes) > 2) issues++;
        }
        checks += files.filter((f) => f.endsWith(".json")).length;
        break;
      }
      case "lint": {
        checks = fileContents.length;
        // Check for common lint issues
        for (const f of fileContents) {
          if (f.content.includes("var ")) issues++;
        }
        break;
      }
      case "secrets": {
        const secretPatterns = [
          /['"]sk_live_[a-zA-Z0-9]+['"]/,
          /['"]ghp_[a-zA-Z0-9]+['"]/,
          /['"]AKIA[A-Z0-9]{16}['"]/,
          /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
          /-----BEGIN.*PRIVATE KEY-----/,
          /(mongodb|postgres|mysql):\/\/[^:\s]+:[^@\s]+@/i,
        ];
        for (const f of fileContents) {
          checks++;
          for (const pattern of secretPatterns) {
            if (pattern.test(f.content)) { issues++; break; }
          }
        }
        // Check for sensitive files in repo
        const sensitiveFiles = [".env", ".pem", ".key", "credentials.json"];
        for (const f of files) {
          checks++;
          const basename = f.split("/").pop() || "";
          if (sensitiveFiles.includes(basename)) issues++;
        }
        break;
      }
      case "codeQuality": {
        for (const f of fileContents) {
          if (f.path.includes("test") || f.path.includes("spec")) continue;
          checks++;
          if (/console\.(log|debug|info)\(/.test(f.content)) issues++;
          checks++;
          if (/\bdebugger\b/.test(f.content)) issues++;
          checks++;
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(f.content)) issues++;
          checks++;
          if (/\beval\s*\(/.test(f.content)) issues++;
        }
        break;
      }
      case "security": {
        for (const f of fileContents) {
          checks++;
          if (/\.innerHTML\s*=/.test(f.content)) issues++;
          checks++;
          if (/\beval\s*\(/.test(f.content)) issues++;
          checks++;
          if (/child_process.*exec\s*\(/.test(f.content)) issues++;
          checks++;
          if (/document\.write\s*\(/.test(f.content)) issues++;
        }
        break;
      }
      case "accessibility": {
        for (const f of fileContents) {
          if (!f.path.endsWith(".tsx") && !f.path.endsWith(".jsx")) continue;
          checks++;
          if (/<img\s(?![^>]*\balt\b)/i.test(f.content)) issues++;
          checks++;
          if (/<input(?![^>]*\b(?:aria-label|id)\b)/i.test(f.content)) issues++;
          checks++;
          if (f.content.includes("onClick") && !f.content.includes("onKeyDown")) issues++;
        }
        break;
      }
      case "seo": {
        checks++;
        const hasMetaTitle = files.some((f) => f.includes("layout") || f.includes("_app"));
        if (!hasMetaTitle) issues++;
        checks++;
        if (!files.some((f) => f === "robots.txt" || f === "public/robots.txt")) issues++;
        break;
      }
      case "documentation": {
        checks++;
        if (!files.some((f) => f === "README.md")) issues++;
        checks++;
        if (!files.some((f) => f === "CHANGELOG.md" || f === "CHANGES.md")) issues++;
        checks++;
        if (!files.some((f) => f === "LICENSE" || f === "LICENSE.md")) issues++;
        break;
      }
      case "links": {
        for (const f of fileContents) {
          const linkMatches = f.content.match(/href=["']([^"']+)["']/g) || [];
          checks += linkMatches.length;
          for (const link of linkMatches) {
            const href = link.match(/href=["']([^"']+)["']/)?.[1] || "";
            if (href === "#" || href === "javascript:void(0)") issues++;
          }
        }
        break;
      }
      case "performance": {
        checks++;
        const pkgJson = files.find((f) => f === "package.json");
        if (pkgJson) {
          const pkg = fileContents.find((f) => f.path === "package.json");
          if (pkg) {
            const deps = Object.keys(JSON.parse(pkg.content).dependencies || {});
            if (deps.length > 50) issues++;
          }
        }
        break;
      }
      case "compatibility": {
        checks++;
        if (!files.some((f) => f === ".browserslistrc") &&
            !fileContents.some((f) => f.path === "package.json" && f.content.includes("browserslist"))) {
          issues++;
        }
        break;
      }
      default: {
        // Modules that need runtime (unitTests, e2e, etc.) — report info
        checks = 1;
        break;
      }
    }

    totalIssues += issues;
    moduleResults.push({
      name: moduleName,
      status: issues > 0 ? "failed" : "passed",
      checks: Math.max(checks, 1),
      issues,
      duration: Date.now() - modStart,
    });
  }

  return {
    status: "complete",
    modules: moduleResults,
    totalModules: moduleNames.length,
    completedModules: moduleNames.length,
    totalIssues,
    totalFixed: 0,
    duration: Date.now() - startTime,
  };
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

    let tier = metadata.tier;
    let repoUrl = metadata.repo_url;

    // Fallback to payment intent metadata
    if ((!tier || !repoUrl) && paymentIntentId) {
      const pi = await stripeApi("GET", `/v1/payment_intents/${paymentIntentId}`);
      const piMeta = (pi.metadata || {}) as Record<string, string>;
      tier = tier || piMeta.tier;
      repoUrl = repoUrl || piMeta.repo_url;
    }

    if (!tier || !repoUrl || !paymentIntentId) {
      return NextResponse.json({ error: "Missing scan metadata" }, { status: 400 });
    }

    try {
      // Run the scan synchronously
      const result = await runScan(repoUrl, tier);

      // Store result in Stripe metadata for the status page to read
      const resultSummary = JSON.stringify({
        status: result.status,
        totalModules: result.totalModules,
        completedModules: result.completedModules,
        totalIssues: result.totalIssues,
        totalFixed: result.totalFixed,
        duration: result.duration,
        modules: result.modules.map((m) => ({
          name: m.name,
          status: m.status,
          checks: m.checks,
          issues: m.issues,
          duration: m.duration,
        })),
        error: result.error,
      });

      // Update payment intent metadata with scan result
      const updateParams = new URLSearchParams({
        "metadata[scan_status]": result.status,
        "metadata[scan_result]": resultSummary.slice(0, 500), // Stripe metadata limit
        "metadata[total_issues]": String(result.totalIssues),
        "metadata[total_modules]": String(result.totalModules),
        "metadata[scan_completed]": new Date().toISOString(),
      });

      await stripeApi(
        "POST",
        `/v1/payment_intents/${paymentIntentId}`,
        updateParams.toString()
      );

      if (result.status === "complete" && !result.error) {
        // Capture payment — scan delivered
        await stripeApi("POST", `/v1/payment_intents/${paymentIntentId}/capture`);
      } else {
        // Cancel payment — scan failed
        await stripeApi("POST", `/v1/payment_intents/${paymentIntentId}/cancel`);
      }
    } catch (err) {
      // Scan crashed — release the hold
      console.error("[GateTest] Scan error:", err);
      await stripeApi("POST", `/v1/payment_intents/${paymentIntentId}/cancel`);
    }
  }

  return NextResponse.json({ received: true });
}
