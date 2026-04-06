/**
 * POST /api/github/scan
 *
 * Trigger an on-demand scan of any connected repo.
 * This is the "Scan Now" button in the dashboard.
 *
 * Body: { owner: string, repo: string, branch?: string }
 * Returns: scan results
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import https from "https";

const APP_ID = process.env.GATETEST_APP_ID;

function getPrivateKey(): string {
  const key = process.env.GATETEST_PRIVATE_KEY || "";
  if (key.includes("BEGIN")) return key;
  return key.replace(/\\n/g, "\n");
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function createJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 10 * 60, iss: APP_ID }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), getPrivateKey());
  return `${header}.${payload}.${base64url(signature)}`;
}

function githubApi(
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<Record<string, unknown> & { _statusCode?: number }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "User-Agent": "GateTest-App/1.0.0",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    let payload: string | undefined;
    if (body) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request(
      { hostname: "api.github.com", path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          try { resolve({ ...JSON.parse(raw), _statusCode: res.statusCode }); }
          catch { resolve({ raw, _statusCode: res.statusCode } as never); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
    if (payload) req.write(payload);
    req.end();
  });
}

interface ScanIssue {
  module: string;
  file: string;
  message: string;
  severity: "error" | "warning";
  line?: number;
}

export async function POST(req: NextRequest) {
  // Auth check
  const userToken = req.cookies.get("gatetest_token")?.value;
  if (!userToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!APP_ID) {
    return NextResponse.json({ error: "App not configured" }, { status: 500 });
  }

  const { owner, repo, branch, installation_id } = await req.json();
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo required" }, { status: 400 });
  }

  try {
    // Get installation token
    const jwt = createJWT();
    const tokenResult = await githubApi("POST", `/app/installations/${installation_id}/access_tokens`, jwt);
    const installToken = tokenResult.token as string;
    if (!installToken) {
      return NextResponse.json({ error: "Could not get repo access" }, { status: 403 });
    }

    const ref = branch || "HEAD";
    const startTime = Date.now();

    // Get file tree
    const tree = (await githubApi("GET", `/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, installToken)) as {
      tree?: Array<{ path: string; type: string; size?: number }>;
    };

    if (!tree.tree) {
      return NextResponse.json({ error: "Could not read repo" }, { status: 500 });
    }

    const files = tree.tree.filter((f) => f.type === "blob");
    const issues: ScanIssue[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    // ── Structure checks ─────────────────────────────
    totalChecks++;
    const hasPackageJson = files.some((f) => f.path === "package.json");
    if (hasPackageJson) passedChecks++;
    else issues.push({ module: "structure", file: "/", message: "No package.json found", severity: "warning" });

    totalChecks++;
    const hasReadme = files.some((f) => f.path.toLowerCase() === "readme.md");
    if (hasReadme) passedChecks++;
    else issues.push({ module: "documentation", file: "/", message: "No README.md found", severity: "warning" });

    totalChecks++;
    const hasTests = files.some((f) => f.path.includes("test") || f.path.includes("spec") || f.path.includes("__tests__"));
    if (hasTests) passedChecks++;
    else issues.push({ module: "testing", file: "/", message: "No test files found", severity: "error" });

    // ── Sensitive file checks ────────────────────────
    const sensitiveFiles = [".env", ".env.local", ".env.production", ".pem", ".key", "credentials.json", ".env.development"];
    for (const f of files) {
      const basename = f.path.split("/").pop() || "";
      if (sensitiveFiles.includes(basename)) {
        totalChecks++;
        issues.push({ module: "secrets", file: f.path, message: `Sensitive file committed: ${basename}`, severity: "error" });
      }
    }

    // ── Source code analysis ─────────────────────────
    const sourceFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".tsx") || f.path.endsWith(".js") || f.path.endsWith(".jsx")) &&
        !f.path.includes("node_modules") &&
        !f.path.includes(".next") &&
        !f.path.includes("dist/") &&
        (f.size || 0) < 100000 // Skip huge files
    );

    // Sample up to 50 files (Vercel 60s limit)
    const sample = sourceFiles.slice(0, 50);

    for (const file of sample) {
      try {
        const fileData = (await githubApi(
          "GET",
          `/repos/${owner}/${repo}/contents/${file.path}?ref=${ref}`,
          installToken
        )) as { content?: string; encoding?: string };

        if (!fileData.content || fileData.encoding !== "base64") continue;
        const content = Buffer.from(fileData.content, "base64").toString("utf-8");
        const lines = content.split("\n");
        const isTest = file.path.includes("test") || file.path.includes("spec");

        // Console.log
        totalChecks++;
        const consoleLogs = content.match(/console\.(log|debug|info)\(/g);
        if (consoleLogs && !isTest) {
          issues.push({ module: "quality", file: file.path, message: `${consoleLogs.length} console.log statement(s)`, severity: "warning" });
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
          /['"]sk-[a-zA-Z0-9]{32,}['"]/,
        ];
        const foundSecret = secretPatterns.some((p) => p.test(content));
        if (foundSecret) {
          issues.push({ module: "secrets", file: file.path, message: "Potential hardcoded secret", severity: "error" });
        } else {
          passedChecks++;
        }

        // Security: eval / innerHTML / dangerouslySetInnerHTML
        totalChecks++;
        if (/\beval\s*\(/.test(content) || /\.innerHTML\s*=/.test(content)) {
          issues.push({ module: "security", file: file.path, message: "eval() or innerHTML usage detected", severity: "error" });
        } else {
          passedChecks++;
        }

        // TODO/FIXME/HACK
        totalChecks++;
        const todos = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
        if (todos) {
          issues.push({ module: "quality", file: file.path, message: `${todos.length} unresolved TODO/FIXME`, severity: "warning" });
        } else {
          passedChecks++;
        }

        // Accessibility: img without alt
        totalChecks++;
        if ((file.path.endsWith(".tsx") || file.path.endsWith(".jsx")) && /<img\s(?![^>]*\balt\b)/i.test(content)) {
          issues.push({ module: "accessibility", file: file.path, message: "<img> without alt text", severity: "error" });
        } else {
          passedChecks++;
        }

        // File length
        totalChecks++;
        if (lines.length > 300 && !isTest) {
          issues.push({ module: "quality", file: file.path, message: `File is ${lines.length} lines (max 300)`, severity: "warning" });
        } else {
          passedChecks++;
        }

        // Dead links in JSX/TSX
        totalChecks++;
        if (file.path.endsWith(".tsx") || file.path.endsWith(".jsx")) {
          const deadLinks = content.match(/href=["']#["']/g) || content.match(/href=["']javascript:void\(0\)["']/g);
          if (deadLinks) {
            issues.push({ module: "links", file: file.path, message: `${deadLinks.length} dead link(s) (href="#" or javascript:void)`, severity: "warning" });
          } else {
            passedChecks++;
          }
        } else {
          passedChecks++;
        }
      } catch {
        // File read failed, skip
      }
    }

    const duration = Date.now() - startTime;
    const passed = issues.filter((i) => i.severity === "error").length === 0;

    // Group by module
    const moduleMap = new Map<string, ScanIssue[]>();
    for (const issue of issues) {
      if (!moduleMap.has(issue.module)) moduleMap.set(issue.module, []);
      moduleMap.get(issue.module)!.push(issue);
    }

    const modules = Array.from(moduleMap.entries()).map(([name, moduleIssues]) => ({
      name,
      issues: moduleIssues.length,
      errors: moduleIssues.filter((i) => i.severity === "error").length,
      warnings: moduleIssues.filter((i) => i.severity === "warning").length,
    }));

    return NextResponse.json({
      repo: `${owner}/${repo}`,
      branch: ref,
      gateStatus: passed ? "PASSED" : "BLOCKED",
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        totalChecks,
        passed: passedChecks,
        failed: totalChecks - passedChecks,
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
      },
      modules,
      issues: issues.slice(0, 100), // Cap at 100 for response size
      filesScanned: sample.length,
      totalFiles: files.length,
    });
  } catch (err) {
    console.error("[GateTest] Scan error:", err);
    return NextResponse.json({ error: "Scan failed", details: String(err) }, { status: 500 });
  }
}
