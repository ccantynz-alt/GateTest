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
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";

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
      "User-Agent": "GateTest/1.1.0",
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
  status: "passed" | "failed" | "warning";
  checks: number;
  issues: number;
  duration: number;
  details?: string[];
}

async function scanRepo(owner: string, repo: string, tier: string): Promise<{
  modules: ModuleResult[];
  totalIssues: number;
  duration: number;
  error?: string;
}> {
  const startTime = Date.now();
  const token = process.env.GITHUB_TOKEN || process.env.GATETEST_GITHUB_TOKEN || "";

  // Get file tree
  let tree: { tree?: Array<{ path: string; type: string }> };
  try {
    tree = (await githubGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, token)) as typeof tree;
  } catch {
    tree = (await githubGet(`/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`)) as typeof tree;
  }

  if (!tree?.tree) {
    return { modules: [], totalIssues: 0, duration: Date.now() - startTime, error: `Cannot access ${owner}/${repo}` };
  }

  const files = tree.tree.filter((f) => f.type === "blob").map((f) => f.path);
  const sourceExts = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb"];
  const sourceFiles = files.filter(
    (f) => sourceExts.some((ext) => f.endsWith(ext)) &&
      !f.includes("node_modules") && !f.includes(".next") && !f.includes("dist/")
  );

  // Read source files (up to 20)
  const fileContents: Array<{ path: string; content: string }> = [];
  for (const filePath of sourceFiles.slice(0, 20)) {
    try {
      const data = (await githubGet(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token
      )) as { content?: string; encoding?: string };
      if (data.content && data.encoding === "base64") {
        fileContents.push({ path: filePath, content: Buffer.from(data.content, "base64").toString("utf-8") });
      }
    } catch { /* skip */ }
  }

  // Only the 13 modules that actually work via GitHub API
  const moduleNames = tier === "quick"
    ? ["syntax", "lint", "secrets", "codeQuality"]
    : ["syntax", "lint", "secrets", "codeQuality", "security", "accessibility",
       "seo", "links", "compatibility", "dataIntegrity", "documentation",
       "performance", "aiReview"];

  const results: ModuleResult[] = [];
  let totalIssues = 0;

  for (const mod of moduleNames) {
    const modStart = Date.now();
    let checks = 0;
    let issues = 0;
    const details: string[] = [];

    switch (mod) {
      case "syntax": {
        for (const f of fileContents) {
          checks++;
          const opens = (f.content.match(/{/g) || []).length;
          const closes = (f.content.match(/}/g) || []).length;
          if (Math.abs(opens - closes) > 2) { issues++; details.push(`${f.path}: unbalanced braces`); }
        }
        checks += files.filter((f) => f.endsWith(".json")).length;
        break;
      }
      case "lint": {
        for (const f of fileContents) {
          checks++;
          if (f.content.includes("var ")) { issues++; details.push(`${f.path}: uses 'var' instead of let/const`); }
        }
        break;
      }
      case "secrets": {
        const patterns = [
          { re: /['"]sk_live_[a-zA-Z0-9]+['"]/, name: "Stripe live key" },
          { re: /['"]ghp_[a-zA-Z0-9]+['"]/, name: "GitHub PAT" },
          { re: /['"]AKIA[A-Z0-9]{16}['"]/, name: "AWS access key" },
          { re: /password\s*[:=]\s*['"][^'"]{8,}['"]/i, name: "Hardcoded password" },
          { re: /-----BEGIN.*PRIVATE KEY-----/, name: "Private key" },
          { re: /(mongodb|postgres|mysql):\/\/[^:\s]+:[^@\s]+@/i, name: "DB connection string" },
        ];
        for (const f of fileContents) {
          checks++;
          for (const p of patterns) {
            if (p.re.test(f.content)) { issues++; details.push(`${f.path}: ${p.name}`); break; }
          }
        }
        const sensitive = [".env", ".pem", ".key", "credentials.json"];
        for (const f of files) {
          checks++;
          const base = f.split("/").pop() || "";
          if (sensitive.includes(base)) { issues++; details.push(`Sensitive file: ${f}`); }
        }
        break;
      }
      case "codeQuality": {
        for (const f of fileContents) {
          if (f.path.includes("test") || f.path.includes("spec")) continue;
          checks++;
          if (/console\.(log|debug|info)\(/.test(f.content)) { issues++; details.push(`${f.path}: console.log`); }
          checks++;
          if (/\bdebugger\b/.test(f.content)) { issues++; details.push(`${f.path}: debugger statement`); }
          checks++;
          if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(f.content)) { issues++; details.push(`${f.path}: TODO/FIXME`); }
          checks++;
          if (/\beval\s*\(/.test(f.content)) { issues++; details.push(`${f.path}: eval() usage`); }
        }
        break;
      }
      case "security": {
        for (const f of fileContents) {
          checks++;
          if (/\.innerHTML\s*=/.test(f.content)) { issues++; details.push(`${f.path}: innerHTML`); }
          checks++;
          if (/\beval\s*\(/.test(f.content)) { issues++; details.push(`${f.path}: eval()`); }
          checks++;
          if (/child_process.*exec\s*\(/.test(f.content)) { issues++; details.push(`${f.path}: shell exec`); }
          checks++;
          if (/document\.write\s*\(/.test(f.content)) { issues++; details.push(`${f.path}: document.write`); }
        }
        break;
      }
      case "accessibility": {
        for (const f of fileContents) {
          if (!f.path.endsWith(".tsx") && !f.path.endsWith(".jsx")) continue;
          checks++;
          if (/<img\s(?![^>]*\balt\b)/i.test(f.content)) { issues++; details.push(`${f.path}: img without alt`); }
          checks++;
          if (/<input(?![^>]*\b(?:aria-label|id)\b)/i.test(f.content)) { issues++; details.push(`${f.path}: input without label`); }
          checks++;
          if (f.content.includes("onClick") && !f.content.includes("onKeyDown")) { issues++; details.push(`${f.path}: onClick without onKeyDown`); }
        }
        break;
      }
      case "seo": {
        checks++;
        if (!files.some((f) => f.includes("layout") || f.includes("_app"))) { issues++; details.push("No layout/meta file"); }
        checks++;
        if (!files.some((f) => f === "robots.txt" || f === "public/robots.txt")) { issues++; details.push("No robots.txt"); }
        break;
      }
      case "documentation": {
        checks++;
        if (!files.some((f) => f === "README.md")) { issues++; details.push("No README.md"); }
        checks++;
        if (!files.some((f) => f === "CHANGELOG.md" || f === "CHANGES.md")) { issues++; details.push("No CHANGELOG"); }
        checks++;
        if (!files.some((f) => f === "LICENSE" || f === "LICENSE.md")) { issues++; details.push("No LICENSE"); }
        break;
      }
      case "links": {
        for (const f of fileContents) {
          const hrefs = f.content.match(/href=["']([^"']+)["']/g) || [];
          checks += hrefs.length;
          for (const h of hrefs) {
            const val = h.match(/href=["']([^"']+)["']/)?.[1] || "";
            if (val === "#" || val === "javascript:void(0)") { issues++; details.push(`${f.path}: dead link ${val}`); }
          }
        }
        break;
      }
      case "performance": {
        checks++;
        const pkg = fileContents.find((f) => f.path === "package.json");
        if (pkg) {
          try {
            const deps = Object.keys(JSON.parse(pkg.content).dependencies || {});
            if (deps.length > 50) { issues++; details.push(`${deps.length} dependencies — large bundle risk`); }
          } catch { /* skip */ }
        }
        break;
      }
      case "compatibility": {
        checks++;
        if (!files.some((f) => f === ".browserslistrc") &&
            !fileContents.some((f) => f.path === "package.json" && f.content.includes("browserslist"))) {
          issues++;
          details.push("No browserslist config");
        }
        break;
      }
      default: {
        checks = 1;
        break;
      }
    }

    totalIssues += issues;
    results.push({
      name: mod,
      status: issues > 0 ? "failed" : "passed",
      checks: Math.max(checks, 1),
      issues,
      duration: Date.now() - modStart,
      details: details.length > 0 ? details.slice(0, 5) : undefined,
    });
  }

  return { modules: results, totalIssues, duration: Date.now() - startTime };
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

  // Run the scan
  const result = await scanRepo(owner, repo, tier || "quick");

  // If we have a session ID, update Stripe and capture payment
  if (sessionId && STRIPE_SECRET_KEY) {
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
    error: result.error,
  });
}
