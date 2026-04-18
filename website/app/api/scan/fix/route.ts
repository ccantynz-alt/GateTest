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
 * Requires: ANTHROPIC_API_KEY, GitHub auth (either GITHUB_TOKEN PAT, or
 *           GATETEST_APP_ID + GATETEST_PRIVATE_KEY GitHub App — App is preferred
 *           because it's already what the webhook uses for commit statuses.)
 */

import { NextRequest, NextResponse } from "next/server";
import { githubApi, httpsJsonRequest, resolveGithubToken } from "../../../lib/github-app";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

async function askClaude(fileContent: string, filePath: string, issues: string[]): Promise<string> {
  const prompt = `You are an expert code fixer for GateTest, an AI-powered QA platform with 67 scanning modules.

Fix ALL of the following issues in this file. Every fix must pass GateTest's re-scan.

FILE: ${filePath}
ISSUES TO FIX:
${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

CURRENT CODE:
\`\`\`
${fileContent}
\`\`\`

CRITICAL RULES — violations will cause re-scan failure:
- Return ONLY the complete fixed file content. No explanations. No markdown code fences.
- Fix the ROOT CAUSE, not the symptom. Never patch over an issue.
- NEVER introduce these patterns (GateTest scans for them):
  * console.log / console.debug / console.info in library code
  * debugger statements
  * TODO / FIXME / HACK / XXX comments
  * eval() or Function() calls
  * Hardcoded secrets, API keys, tokens, passwords
  * var declarations (use const/let)
  * Empty catch blocks
  * Unused imports or variables
- Preserve every non-issue line exactly — do not rewrite or reformat unrelated code.
- Never remove functionality to "fix" a warning.
- If a fix would require context you don't have, output the UNCHANGED original file verbatim.
- The fixed code will be automatically re-scanned. If it fails, the fix is rejected.`;

  const body = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  // Retry up to 3x on 429/5xx with exponential backoff
  let lastStatus = 0;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
    const res = await httpsJsonRequest({
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

    lastStatus = res.status;
    if (res.status === 200) {
      const content = res.data.content as Array<{ type: string; text: string }>;
      let fixedCode = content?.[0]?.text || "";
      // Strip markdown code fences if Claude added them despite instructions
      fixedCode = fixedCode.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
      return fixedCode;
    }
    if (res.status !== 429 && res.status < 500) {
      // Non-retryable client error (400/401/403)
      lastErr = JSON.stringify(res.data).slice(0, 200);
      break;
    }
  }
  throw new Error(`Claude API error ${lastStatus}${lastErr ? `: ${lastErr}` : ""}`);
}

/**
 * Validate Claude's fix output before we commit it.
 * Catches truncation (max_tokens hit), refusals, and obvious garbage.
 */
function validateFix(original: string, fixed: string): { ok: boolean; reason?: string } {
  if (!fixed || fixed.trim().length === 0) {
    return { ok: false, reason: "empty output" };
  }
  if (fixed === original) {
    return { ok: false, reason: "no changes produced" };
  }
  if (original.length > 500 && fixed.length < original.length * 0.4) {
    return { ok: false, reason: `likely truncation (${fixed.length}/${original.length} chars)` };
  }
  const refusalMarkers = ["I cannot", "I can't", "I'm unable to", "I won't", "As an AI"];
  const firstLine = fixed.split("\n", 1)[0] || "";
  if (refusalMarkers.some((m) => firstLine.startsWith(m))) {
    return { ok: false, reason: "Claude refused" };
  }
  return { ok: true };
}

/**
 * Verify that fixed code doesn't introduce NEW issues that GateTest would catch.
 * Runs the same pattern checks our scan modules use.
 */
function verifyFixQuality(fixed: string, filePath: string): { clean: boolean; newIssues: string[] } {
  const issues: string[] = [];
  const lines = fixed.split("\n");
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const isSource = ["js", "ts", "jsx", "tsx", "mjs", "cjs"].includes(ext);

  if (!isSource) return { clean: true, newIssues: [] };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and strings for some checks
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    // console.log/debug/info in non-test files
    if (!filePath.includes(".test.") && !filePath.includes(".spec.") && !filePath.includes("__test")) {
      if (/\bconsole\.(log|debug|info)\s*\(/.test(line)) {
        issues.push(`Line ${i + 1}: console.log/debug/info introduced`);
      }
    }

    // debugger statements
    if (/^\s*debugger\s*;?\s*$/.test(line)) {
      issues.push(`Line ${i + 1}: debugger statement introduced`);
    }

    // TODO/FIXME/HACK/XXX
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
      issues.push(`Line ${i + 1}: TODO/FIXME comment introduced`);
    }

    // eval()
    if (/\beval\s*\(/.test(line) && !trimmed.startsWith("//")) {
      issues.push(`Line ${i + 1}: eval() introduced`);
    }

    // var declarations
    if (/^\s*var\s+\w/.test(line)) {
      issues.push(`Line ${i + 1}: var declaration introduced (use const/let)`);
    }

    // Empty catch blocks
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      issues.push(`Line ${i + 1}: empty catch block introduced`);
    }
  }

  return { clean: issues.length === 0, newIssues: issues };
}

// Concurrency cap for parallel file fixing — balances Vercel time budget vs API rate.
const FIX_CONCURRENCY = 4;
// Max file size we'll send to Claude (bigger risks output truncation at 8192 tokens).
const MAX_FILE_BYTES = 200 * 1024;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

  const repoMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  if (!repoMatch) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }

  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");

  // Resolve GitHub token — prefer PAT, fall back to GitHub App installation token
  const auth = await resolveGithubToken(owner, repo);
  if (!auth.token) {
    return NextResponse.json(
      {
        error: auth.error ||
          "GitHub access not configured — set GITHUB_TOKEN, or install the GateTest GitHub App on this repo",
        hint: "Install the GitHub App at https://github.com/apps/gatetesthq/installations/new",
      },
      { status: 503 }
    );
  }
  const token = auth.token;
  const authSource = auth.source;

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

  type Fix = { file: string; original: string; fixed: string; issues: string[] };
  const fixes: Fix[] = [];
  const errors: string[] = [];

  // Process files in parallel (capped concurrency) — major UX win over sequential
  const fileEntries = Array.from(issuesByFile.entries());
  await mapWithConcurrency(fileEntries, FIX_CONCURRENCY, async ([filePath, fileIssues]) => {
    try {
      const fileRes = await githubApi(
        "GET",
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
        token
      );
      if (fileRes.status !== 200 || !fileRes.data.content) {
        errors.push(`Could not read ${filePath}`);
        return;
      }
      const originalContent = Buffer.from(fileRes.data.content as string, "base64").toString("utf-8");

      if (originalContent.length > MAX_FILE_BYTES) {
        errors.push(`Skipped ${filePath}: file too large (${originalContent.length} bytes, limit ${MAX_FILE_BYTES})`);
        return;
      }

      // First pass: generate fix
      let fixedContent = await askClaude(originalContent, filePath, fileIssues);
      let validation = validateFix(originalContent, fixedContent);
      if (!validation.ok) {
        errors.push(`Skipped ${filePath}: ${validation.reason}`);
        return;
      }

      // Verify fix doesn't introduce new issues
      let verify = verifyFixQuality(fixedContent, filePath);
      if (!verify.clean) {
        // Second pass: tell Claude to fix its own mistakes
        const retryIssues = [
          ...fileIssues,
          ...verify.newIssues.map((i) => `YOUR FIX INTRODUCED: ${i} — fix this too`),
        ];
        fixedContent = await askClaude(originalContent, filePath, retryIssues);
        validation = validateFix(originalContent, fixedContent);
        if (!validation.ok) {
          errors.push(`Skipped ${filePath} after retry: ${validation.reason}`);
          return;
        }
        verify = verifyFixQuality(fixedContent, filePath);
        if (!verify.clean) {
          errors.push(`Skipped ${filePath}: fix still introduces issues after retry: ${verify.newIssues.join("; ")}`);
          return;
        }
      }

      fixes.push({ file: filePath, original: originalContent, fixed: fixedContent, issues: fileIssues });
    } catch (err) {
      errors.push(`Failed to fix ${filePath}: ${err instanceof Error ? err.message : "unknown"}`);
    }
  });

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

    // Commit each fixed file (parallel, capped)
    await mapWithConcurrency(fixes, FIX_CONCURRENCY, async (fix) => {
      const sha = await getFileSha(owner, repo, fix.file, branchName, token);
      await githubApi("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(fix.file)}`, token, {
        message: `fix: ${fix.issues[0]}${fix.issues.length > 1 ? ` (+${fix.issues.length - 1} more)` : ""}`,
        content: Buffer.from(fix.fixed).toString("base64"),
        branch: branchName,
        sha,
      });
    });

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
      authSource,
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
