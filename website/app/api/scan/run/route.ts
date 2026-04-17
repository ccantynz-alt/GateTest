/**
 * Scan Run API — Runs the scan and returns results directly.
 *
 * POST /api/scan/run
 * Body: { sessionId, repoUrl, tier }
 *
 * NO WEBHOOK DEPENDENCY. The client calls this directly after checkout.
 * Returns the scan result in one response. Simple. Fast. Reliable.
 *
 * Also updates Stripe payment intent metadata and captures payment.
 *
 * Honesty contract: every module listed in scan-modules/index.ts does real
 * work. Modules that cannot run return status "skipped" with a reason —
 * never a fake pass.
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";
import { isAdminRequest } from "@/app/lib/admin-auth";
import { resolveGithubToken } from "@/app/lib/github-app";
import { runTier, type RepoFile } from "@/app/lib/scan-modules";
import { runBridgeTier } from "@/app/lib/cli-bridge/run";

// This route runs the full 67-module CLI engine against a materialized
// /tmp copy of the repo. It MUST be on the Node runtime (fs access) and
// the Pro-tier 300s budget to accommodate a full scan.
export const runtime = "nodejs";
export const maxDuration = 300;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const MAX_FILES_TO_READ = 400;

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
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
        catch { resolve({}); }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function githubGet(path: string, token?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "GateTest/1.2.0",
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const req = https.request(
      { hostname: "api.github.com", port: 443, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
          catch { resolve({}); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("GitHub timeout")); });
    req.end();
  });
}

interface ModuleResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  checks: number;
  issues: number;
  duration: number;
  details?: string[];
  skipped?: string;
}

interface ScanRepoResult {
  modules: ModuleResult[];
  totalIssues: number;
  duration: number;
  authSource?: string | null;
  error?: string;
  engine?: "cli-bridge" | "ts-fallback";
  engineError?: string;
}

async function scanRepo(owner: string, repo: string, tier: string): Promise<ScanRepoResult> {
  const startTime = Date.now();

  // Resolve GitHub auth: PAT first, GitHub App installation token second.
  const auth = await resolveGithubToken(owner, repo);
  const token = auth.token || undefined;

  // Get file tree (authenticated if possible, else try public).
  let tree: { tree?: Array<{ path: string; type: string }> };
  try {
    tree = (await githubGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, token)) as typeof tree;
  } catch {
    tree = (await githubGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`)) as typeof tree;
  }

  if (!tree?.tree) {
    const hint = auth.error ? ` (${auth.error})` : token ? "" : " — set GITHUB_TOKEN or install the GateTest GitHub App";
    return {
      modules: [],
      totalIssues: 0,
      duration: Date.now() - startTime,
      authSource: auth.source,
      error: `Cannot access ${owner}/${repo}${hint}`,
    };
  }

  const files = tree.tree.filter((f) => f.type === "blob").map((f) => f.path);
  const sourceExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb", ".md", ".json", ".yml", ".yaml"];
  const sourceFiles = files.filter(
    (f) => sourceExts.some((ext) => f.endsWith(ext)) &&
      !f.includes("node_modules") && !f.includes(".next") && !f.includes("dist/")
  );

  // Read source files (up to MAX_FILES_TO_READ) in parallel for speed.
  const readPromises = sourceFiles.slice(0, MAX_FILES_TO_READ).map(async (filePath): Promise<RepoFile | null> => {
    try {
      const data = (await githubGet(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token
      )) as { content?: string; encoding?: string };
      if (data.content && data.encoding === "base64") {
        return { path: filePath, content: Buffer.from(data.content, "base64").toString("utf-8") };
      }
      return null;
    } catch { return null; }
  });
  const fileContents: RepoFile[] = (await Promise.all(readPromises)).filter((f): f is RepoFile => f !== null);

  // Primary path: run the real 67-module CLI engine against a materialized
  // /tmp copy of the repo via the bridge. This is what customers paid for.
  const bridgeTier = tier === "full" ? "full" : "quick";
  try {
    const bridge = await runBridgeTier(bridgeTier, {
      owner,
      repo,
      files,
      fileContents,
      token,
    });
    return {
      modules: bridge.modules,
      totalIssues: bridge.totalIssues,
      duration: Date.now() - startTime,
      authSource: auth.source,
      engine: "cli-bridge",
    };
  } catch (bridgeErr) {
    // Loud, non-silent fallback. If the bridge itself crashes (e.g. /tmp
    // exhausted, a module constructor throws) we still deliver a result
    // using the TS-only registry — never a fake pass, never a 500.
    const msg = bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr);
    console.error(`[GateTest] CLI bridge FAILED, falling back to TS registry: ${msg}`);
    const { modules, totalIssues } = await runTier(bridgeTier, {
      owner,
      repo,
      files,
      fileContents,
      token,
    });
    return {
      modules,
      totalIssues,
      duration: Date.now() - startTime,
      authSource: auth.source,
      engine: "ts-fallback",
      engineError: msg,
    };
  }
}

export async function POST(req: NextRequest) {
  let input: { sessionId?: string; repoUrl?: string; tier?: string };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { sessionId, repoUrl, tier } = input;

  if (!repoUrl) {
    return NextResponse.json({ error: "Missing repo URL" }, { status: 400 });
  }

  const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!repoMatch) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }

  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");

  // Admin bypass: if the request carries a valid admin cookie, we skip all
  // Stripe interaction entirely. Admin scans never create or capture charges.
  const isAdmin = isAdminRequest(req);

  // Run the scan
  const result = await scanRepo(owner, repo, tier || "quick");

  // If we have a session ID AND this is NOT an admin request, update Stripe
  // and capture payment. Admins never touch billing.
  if (!isAdmin && sessionId && STRIPE_SECRET_KEY) {
    try {
      const session = (await stripeApi("GET", `/v1/checkout/sessions/${sessionId}`)) as {
        payment_intent?: string;
      };

      if (session.payment_intent) {
        // Store result in Stripe metadata
        const moduleData = result.modules.map((m) =>
          `${m.name}:${m.status}:${m.checks}:${m.issues}:${m.duration}`
        ).join("|");

        const chunks: string[] = [];
        let current = "";
        for (const entry of moduleData.split("|")) {
          if ((current + "|" + entry).length > 490) { chunks.push(current); current = entry; }
          else { current = current ? current + "|" + entry : entry; }
        }
        if (current) chunks.push(current);

        const params = new URLSearchParams({
          "metadata[scan_status]": result.error ? "failed" : "complete",
          "metadata[total_issues]": String(result.totalIssues),
          "metadata[total_modules]": String(result.modules.length),
          "metadata[scan_duration]": String(result.duration),
          "metadata[scan_completed]": new Date().toISOString(),
          "metadata[modules_list]": result.modules.map((m) => m.name).join(","),
        });
        chunks.forEach((chunk, i) => params.set(`metadata[modules_${i}]`, chunk));

        await stripeApi("POST", `/v1/payment_intents/${session.payment_intent}`, params.toString());

        // Capture or cancel payment
        if (!result.error) {
          await stripeApi("POST", `/v1/payment_intents/${session.payment_intent}/capture`);
        } else {
          await stripeApi("POST", `/v1/payment_intents/${session.payment_intent}/cancel`);
        }
      }
    } catch (err) {
      console.error("[GateTest] Stripe update failed:", err);
    }
  }

  return NextResponse.json({
    status: result.error ? "failed" : "complete",
    modules: result.modules,
    totalModules: result.modules.length,
    completedModules: result.modules.length,
    totalIssues: result.totalIssues,
    totalFixed: 0,
    duration: result.duration,
    repoUrl,
    tier,
    admin: isAdmin,
    authSource: result.authSource,
    engine: result.engine,
    engineError: result.engineError,
    error: result.error,
  });
}
