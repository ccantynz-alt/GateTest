/**
 * Auto-Fix Agent — Claude reads scan issues, generates fixes, creates a PR.
 *
 * POST /api/scan/fix
 * Body: { repoUrl, issues: [{ file, issue, module }] }
 *
 * Flow:
 * 1. Reads each file from GitHub API
 * 2. Sends file + issue to Claude with "fix this" prompt
 * 3. Gets back corrected code
 * 4. Creates a new branch on the repo
 * 5. Commits all fixed files
 * 6. Opens a pull request
 * 7. Returns the PR URL
 *
 * Requires: ANTHROPIC_API_KEY, GitHub token (GATETEST_PRIVATE_KEY for app, or GITHUB_TOKEN)
 */

import { NextRequest, NextResponse } from "next/server";
import https from "https";
import crypto from "crypto";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GATETEST_GITHUB_TOKEN || "";
const GATETEST_APP_ID = process.env.GATETEST_APP_ID || "";

function httpsRequest(
  options: https.RequestOptions,
  body?: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch {
          resolve({ status: res.statusCode || 0, data: { raw: Buffer.concat(chunks).toString() } });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Request timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

async function githubApi(method: string, path: string, token: string, body?: Record<string, unknown>) {
  const payload = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    "User-Agent": "GateTest/1.2.0",
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
  };
  if (payload) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  return httpsRequest({ hostname: "api.github.com", port: 443, path, method, headers }, payload);
}

async function askClaude(fileContent: string, filePath: string, issues: string[]): Promise<string> {
  const prompt = `You are an expert code fixer. Fix the following issues in this file.

FILE: ${filePath}
ISSUES TO FIX:
${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

CURRENT CODE:
\`\`\`
${fileContent}
\`\`\`

Return ONLY the complete fixed file content. No explanations. No markdown code fences. Just the corrected code. Every issue listed above must be fixed.`;

  const body = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const res = await httpsRequest({
    hostname: "api.anthropic.com",
    port: 443,
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": ANTHROPIC_API_KEY,
      "Content-Length": String(Buffer.byteLength(body)),
    },
  }, body);

  if (res.status !== 200) {
    throw new Error(`Claude API error: ${res.status}`);
  }

  const content = res.data.content as Array<{ type: string; text: string }>;
  let fixedCode = content?.[0]?.text || "";

  // Strip markdown code fences if Claude added them despite instructions
  fixedCode = fixedCode.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");

  return fixedCode;
}

interface IssueInput {
  file: string;
  issue: string;
  module: string;
}

export async function POST(req: NextRequest) {
  let input: { repoUrl?: string; issues?: IssueInput[] };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { repoUrl, issues } = input;

  if (!repoUrl || !issues || issues.length === 0) {
    return NextResponse.json({ error: "Missing repoUrl or issues" }, { status: 400 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured (ANTHROPIC_API_KEY)" }, { status: 503 });
  }

  const token = GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GitHub access not configured" }, { status: 503 });
  }

  const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!repoMatch) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }

  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");

  // Group issues by file
  const issuesByFile = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.file) continue;
    const existing = issuesByFile.get(issue.file) || [];
    existing.push(issue.issue);
    issuesByFile.set(issue.file, existing);
  }

  if (issuesByFile.size === 0) {
    return NextResponse.json({ error: "No fixable issues (issues must have file paths)" }, { status: 400 });
  }

  const fixes: Array<{ file: string; original: string; fixed: string; issues: string[] }> = [];
  const errors: string[] = [];

  // For each file with issues, read it, send to Claude, get fix
  for (const [filePath, fileIssues] of issuesByFile) {
    try {
      // Read file from GitHub
      const fileRes = await githubApi("GET", `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, token);

      if (fileRes.status !== 200 || !fileRes.data.content) {
        errors.push(`Could not read ${filePath}`);
        continue;
      }

      const originalContent = Buffer.from(fileRes.data.content as string, "base64").toString("utf-8");

      // Send to Claude for fixing
      const fixedContent = await askClaude(originalContent, filePath, fileIssues);

      if (fixedContent && fixedContent !== originalContent) {
        fixes.push({
          file: filePath,
          original: originalContent,
          fixed: fixedContent,
          issues: fileIssues,
        });
      }
    } catch (err) {
      errors.push(`Failed to fix ${filePath}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  if (fixes.length === 0) {
    return NextResponse.json({
      status: "no_fixes",
      message: "No fixes could be generated",
      errors,
    });
  }

  // Create a branch, commit fixes, open PR
  try {
    // Get default branch SHA
    const repoRes = await githubApi("GET", `/repos/${owner}/${repo}`, token);
    const defaultBranch = (repoRes.data.default_branch as string) || "main";

    const refRes = await githubApi("GET", `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, token);
    const baseSha = (refRes.data.object as Record<string, string>)?.sha;

    if (!baseSha) {
      return NextResponse.json({ error: "Could not get base branch SHA" }, { status: 500 });
    }

    // Create branch
    const branchName = `gatetest/auto-fix-${Date.now()}`;
    const branchRes = await githubApi("POST", `/repos/${owner}/${repo}/git/refs`, token, {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    if (branchRes.status !== 201) {
      return NextResponse.json({
        error: "Could not create branch — check GitHub token permissions",
        details: branchRes.data,
      }, { status: 500 });
    }

    // Commit each fixed file
    for (const fix of fixes) {
      await githubApi("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(fix.file)}`, token, {
        message: `fix: ${fix.issues[0]}${fix.issues.length > 1 ? ` (+${fix.issues.length - 1} more)` : ""}`,
        content: Buffer.from(fix.fixed).toString("base64"),
        branch: branchName,
        sha: await getFileSha(owner, repo, fix.file, branchName, token),
      });
    }

    // Open PR
    const prBody = `## GateTest Auto-Fix

This PR was automatically generated by [GateTest](https://gatetest.io).

### Issues Fixed (${fixes.length} files)

${fixes.map((f) => `**${f.file}**\n${f.issues.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}

${errors.length > 0 ? `\n### Could Not Fix\n${errors.map((e) => `- ${e}`).join("\n")}` : ""}

---
*Scanned and fixed by [GateTest](https://gatetest.io) — AI-powered QA*`;

    const prRes = await githubApi("POST", `/repos/${owner}/${repo}/pulls`, token, {
      title: `GateTest: Fix ${fixes.reduce((sum, f) => sum + f.issues.length, 0)} issues across ${fixes.length} files`,
      body: prBody,
      head: branchName,
      base: defaultBranch,
    });

    if (prRes.status !== 201) {
      return NextResponse.json({
        status: "fixes_committed",
        message: `Fixes committed to branch ${branchName} but PR creation failed`,
        branch: branchName,
        filesFixed: fixes.length,
        issuesFixed: fixes.reduce((sum, f) => sum + f.issues.length, 0),
        errors: [...errors, `PR creation failed: ${JSON.stringify(prRes.data)}`],
      });
    }

    return NextResponse.json({
      status: "pr_created",
      prUrl: (prRes.data.html_url as string) || "",
      prNumber: prRes.data.number,
      branch: branchName,
      filesFixed: fixes.length,
      issuesFixed: fixes.reduce((sum, f) => sum + f.issues.length, 0),
      fixes: fixes.map((f) => ({ file: f.file, issues: f.issues })),
      errors,
    });
  } catch (err) {
    return NextResponse.json({
      status: "error",
      error: err instanceof Error ? err.message : "Failed to create PR",
      fixesGenerated: fixes.length,
      errors,
    }, { status: 500 });
  }
}

async function getFileSha(owner: string, repo: string, path: string, branch: string, token: string): Promise<string> {
  const res = await githubApi("GET", `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`, token);
  return (res.data.sha as string) || "";
}
