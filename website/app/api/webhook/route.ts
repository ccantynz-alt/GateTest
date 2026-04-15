/**
 * GateTest GitHub App Webhook — Vercel Serverless Function
 *
 * Receives GitHub webhooks, authenticates as GitHub App,
 * clones the repo, runs GateTest, posts results back.
 *
 * Environment variables (set in Vercel dashboard):
 *   GATETEST_APP_ID
 *   GATETEST_PRIVATE_KEY  (contents of .pem file, not path)
 *   GATETEST_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import https from "https";
import { postGluecronResult } from "@/app/lib/gluecron-callback";

const APP_ID = process.env.GATETEST_APP_ID;
const WEBHOOK_SECRET = process.env.GATETEST_WEBHOOK_SECRET;

// ── GitHub App JWT ──────────────────────────────────

function getPrivateKey(): string {
  const key = process.env.GATETEST_PRIVATE_KEY || "";
  if (key.includes("BEGIN")) return key;
  // Handle escaped newlines from Vercel env
  return key.replace(/\\n/g, "\n");
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 10 * 60, iss: APP_ID })
  );
  const signature = crypto.sign(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    getPrivateKey()
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

// ── GitHub API ──────────────────────────────────────

function githubApi(
  method: string,
  urlPath: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      path: urlPath,
      method,
      headers: {
        "User-Agent": "GateTest-App/1.0.0",
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    };
    let payload: string | null = null;
    if (body) {
      payload = JSON.stringify(body);
      options.headers = {
        ...options.headers,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(payload)),
      };
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({ raw } as unknown as Record<string, unknown>);
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getInstallationToken(installationId: number): Promise<string> {
  const jwt = createJWT();
  const result = await githubApi(
    "POST",
    `/app/installations/${installationId}/access_tokens`,
    jwt
  );
  return result.token as string;
}

// ── Signature Verification ──────────────────────────

function verifySignature(payload: string, signature: string | null): boolean {
  if (!WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

// ── Scan Logic ──────────────────────────────────────

interface ScanResult {
  passed: boolean;
  issuesFound: number;
  checksPassed: number;
  checksTotal: number;
  modulesPassed: number;
  modulesTotal: number;
  failures: Array<{ module: string; error: string }>;
}

async function scanRepo(
  owner: string,
  name: string,
  branch: string,
  token: string
): Promise<ScanResult> {
  // Fetch file tree to analyze
  const tree = (await githubApi(
    "GET",
    `/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
    token
  )) as { tree?: Array<{ path: string; type: string }> };

  if (!tree.tree) {
    return {
      passed: false,
      issuesFound: 1,
      checksPassed: 0,
      checksTotal: 1,
      modulesPassed: 0,
      modulesTotal: 1,
      failures: [{ module: "clone", error: "Could not read repo tree" }],
    };
  }

  const files = tree.tree.filter((f) => f.type === "blob").map((f) => f.path);
  const issues: Array<{ module: string; error: string }> = [];
  let totalChecks = 0;
  let passedChecks = 0;

  // ── Check 1: Package.json exists ──
  totalChecks++;
  if (files.some((f) => f === "package.json" || f.endsWith("/package.json"))) {
    passedChecks++;
  } else {
    issues.push({ module: "structure", error: "No package.json found" });
  }

  // ── Check 2: Scan for potential secrets ──
  const sensitivePatterns = [
    ".env",
    ".pem",
    ".key",
    "credentials.json",
    ".env.local",
    ".env.production",
  ];
  for (const f of files) {
    totalChecks++;
    const basename = f.split("/").pop() || "";
    if (sensitivePatterns.includes(basename)) {
      issues.push({
        module: "secrets",
        error: `Sensitive file committed: ${f}`,
      });
    } else {
      passedChecks++;
    }
  }

  // ── Check 3: Scan source files for issues ──
  const sourceFiles = files.filter(
    (f) =>
      (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".js") || f.endsWith(".jsx")) &&
      !f.includes("node_modules") &&
      !f.includes(".next")
  );

  // Sample up to 30 files to check (Vercel has time limits)
  const filesToCheck = sourceFiles.slice(0, 30);

  for (const filePath of filesToCheck) {
    try {
      const fileData = (await githubApi(
        "GET",
        `/repos/${owner}/${name}/contents/${filePath}?ref=${branch}`,
        token
      )) as { content?: string; encoding?: string };

      if (fileData.content && fileData.encoding === "base64") {
        const content = Buffer.from(fileData.content, "base64").toString("utf-8");

        // Console.log check
        totalChecks++;
        const consoleMatches = content.match(/console\.(log|debug|info)\(/g);
        if (consoleMatches && !filePath.includes("test") && !filePath.includes("spec")) {
          issues.push({
            module: "quality",
            error: `${filePath}: ${consoleMatches.length} console.log statement(s)`,
          });
        } else {
          passedChecks++;
        }

        // Secrets in code
        totalChecks++;
        const secretPatterns = [
          /['"]sk_live_[a-zA-Z0-9]+['"]/,
          /['"]ghp_[a-zA-Z0-9]+['"]/,
          /['"]AKIA[A-Z0-9]{16}['"]/,
          /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
        ];
        const hasSecret = secretPatterns.some((p) => p.test(content));
        if (hasSecret) {
          issues.push({
            module: "secrets",
            error: `${filePath}: Potential hardcoded secret`,
          });
        } else {
          passedChecks++;
        }

        // eval / innerHTML
        totalChecks++;
        if (/\beval\s*\(/.test(content) || /\.innerHTML\s*=/.test(content)) {
          issues.push({
            module: "security",
            error: `${filePath}: eval() or innerHTML usage`,
          });
        } else {
          passedChecks++;
        }

        // TODO/FIXME
        totalChecks++;
        const todoMatch = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
        if (todoMatch) {
          issues.push({
            module: "quality",
            error: `${filePath}: ${todoMatch.length} unresolved TODO/FIXME`,
          });
        } else {
          passedChecks++;
        }

        // Accessibility: img without alt
        totalChecks++;
        if (
          (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) &&
          /<img\s(?![^>]*\balt\b)/i.test(content)
        ) {
          issues.push({
            module: "accessibility",
            error: `${filePath}: <img> without alt text`,
          });
        } else {
          passedChecks++;
        }
      }
    } catch {
      // File couldn't be read, skip
    }
  }

  // Group failures by module
  const moduleMap = new Map<string, string[]>();
  for (const issue of issues) {
    if (!moduleMap.has(issue.module)) moduleMap.set(issue.module, []);
    moduleMap.get(issue.module)!.push(issue.error);
  }

  const failures = Array.from(moduleMap.entries()).map(([mod, errs]) => ({
    module: mod,
    error: `${errs.length} issue(s): ${errs.slice(0, 3).join("; ")}${errs.length > 3 ? "..." : ""}`,
  }));

  return {
    passed: issues.length === 0,
    issuesFound: issues.length,
    checksPassed: passedChecks,
    checksTotal: totalChecks,
    modulesPassed: failures.length === 0 ? 1 : 0,
    modulesTotal: 1,
    failures,
  };
}

// ── Format PR Comment ───────────────────────────────

function formatComment(result: ScanResult): string {
  const status = result.passed
    ? "### GateTest: PASSED"
    : "### GateTest: BLOCKED";

  const pct =
    result.checksTotal > 0
      ? Math.round((result.checksPassed / result.checksTotal) * 100)
      : 0;

  let body = `${status}

| Metric | Value |
|--------|-------|
| Pass Rate | ${pct}% |
| Issues | ${result.issuesFound} |
| Checks | ${result.checksPassed}/${result.checksTotal} |`;

  if (result.failures.length > 0) {
    body +=
      "\n\n**Issues found:**\n" +
      result.failures.map((f) => `- **${f.module}**: ${f.error}`).join("\n");
  }

  body +=
    "\n\n---\n*Scanned by [GateTest](https://gatetest.io) — the QA gate for AI-generated code*";

  return body;
}

// ── Webhook Handler ─────────────────────────────────

export async function POST(req: NextRequest) {
  if (!APP_ID) {
    return NextResponse.json(
      { error: "GateTest App not configured" },
      { status: 500 }
    );
  }

  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256");

  if (!verifySignature(body, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Respond fast, process in background
  const event = JSON.parse(body);
  const eventType = req.headers.get("x-github-event");
  const installationId = event.installation?.id;

  if (!installationId) {
    return NextResponse.json({ status: "no installation" });
  }

  // Don't await — let it run in background
  processWebhook(eventType, event, installationId).catch((err) => {
    console.error("[GateTest] Webhook error:", err.message);
  });

  return NextResponse.json({ status: "processing" });
}

async function processWebhook(
  eventType: string | null,
  event: Record<string, unknown>,
  installationId: number
) {
  const token = await getInstallationToken(installationId);
  const repo = event.repository as { owner: { login: string }; name: string };

  if (eventType === "push") {
    const sha = event.after as string;
    const ref = event.ref as string;
    const branch = ref.replace("refs/heads/", "");
    const owner = repo.owner.login;
    const name = repo.name;
    const startedAt = Date.now();

    // Set pending
    await githubApi("POST", `/repos/${owner}/${name}/statuses/${sha}`, token, {
      state: "pending",
      context: "GateTest",
      description: "Scanning...",
    });

    const result = await scanRepo(owner, name, branch, token);

    // Set result
    await githubApi("POST", `/repos/${owner}/${name}/statuses/${sha}`, token, {
      state: result.passed ? "success" : "failure",
      context: "GateTest",
      description: result.passed
        ? `All clear — ${result.checksPassed} checks passed`
        : `${result.issuesFound} issues found`,
    });

    // Fire-and-forget GlueCron callback. Never blocks the user flow.
    postGluecronResult({
      repository: `${owner}/${name}`,
      sha,
      ref,
      status: result.passed ? "passed" : "failed",
      summary: result.passed
        ? `${result.checksPassed}/${result.checksTotal} checks passed`
        : `${result.issuesFound} issues across ${result.failures.length} module(s)`,
      details: { failures: result.failures, checksPassed: result.checksPassed, checksTotal: result.checksTotal },
      durationMs: Date.now() - startedAt,
    }).then((r) => {
      if (!r.ok && !r.skipped) console.error("[GateTest] GlueCron callback failed:", r.error || r.status);
    });
  } else if (eventType === "pull_request") {
    const action = event.action as string;
    if (!["opened", "synchronize", "reopened"].includes(action)) return;

    const pr = event.pull_request as {
      number: number;
      head: { sha: string; ref: string };
    };
    const owner = repo.owner.login;
    const name = repo.name;
    const startedAt = Date.now();

    // Set pending
    await githubApi(
      "POST",
      `/repos/${owner}/${name}/statuses/${pr.head.sha}`,
      token,
      {
        state: "pending",
        context: "GateTest",
        description: "Scanning...",
      }
    );

    const result = await scanRepo(owner, name, pr.head.ref, token);

    // Post comment
    await githubApi(
      "POST",
      `/repos/${owner}/${name}/issues/${pr.number}/comments`,
      token,
      { body: formatComment(result) }
    );

    // Set status
    await githubApi(
      "POST",
      `/repos/${owner}/${name}/statuses/${pr.head.sha}`,
      token,
      {
        state: result.passed ? "success" : "failure",
        context: "GateTest",
        description: result.passed
          ? `All clear — ${result.checksPassed} checks passed`
          : `${result.issuesFound} issues found`,
      }
    );

    // Fire-and-forget GlueCron callback for PR runs.
    postGluecronResult({
      repository: `${owner}/${name}`,
      sha: pr.head.sha,
      ref: `refs/heads/${pr.head.ref}`,
      pullRequestNumber: pr.number,
      status: result.passed ? "passed" : "failed",
      summary: result.passed
        ? `${result.checksPassed}/${result.checksTotal} checks passed`
        : `${result.issuesFound} issues across ${result.failures.length} module(s)`,
      details: { failures: result.failures, checksPassed: result.checksPassed, checksTotal: result.checksTotal },
      durationMs: Date.now() - startedAt,
    }).then((r) => {
      if (!r.ok && !r.skipped) console.error("[GateTest] GlueCron callback failed:", r.error || r.status);
    });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    app: "GateTest",
    configured: !!APP_ID,
  });
}
