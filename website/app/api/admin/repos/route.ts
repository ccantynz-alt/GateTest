/**
 * GET /api/admin/repos
 *
 * Fetches all GitHub repos accessible to the configured token, then
 * enriches each with its latest workflow run status. Returns a unified
 * list so the admin Watchdog panel can show which repos are red and queue
 * GateTest scans on them.
 *
 * Auth: same two-method check as all other /api/admin/* routes.
 * Token: GATETEST_GITHUB_TOKEN or GITHUB_TOKEN (read:repo + workflow scope).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import {
  getAdminConfig,
  getAdminUser,
  SESSION_COOKIE_NAME,
} from "@/app/lib/admin-session";
import { ADMIN_COOKIE_NAME } from "@/app/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function isAuthenticatedAdmin(): Promise<boolean> {
  const store = await cookies();
  const adminStatus = getAdminConfig();
  if (adminStatus.ok && adminStatus.config) {
    const sessionCookie = store.get(SESSION_COOKIE_NAME)?.value;
    if (getAdminUser(sessionCookie, adminStatus.config)) return true;
  }
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
    )
      return true;
  }
  return false;
}

function githubToken(): string {
  return (
    process.env.GATETEST_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ""
  );
}

async function githubFetch(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GateTest-Admin/1.0",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

interface WorkflowRun {
  conclusion: string | null;
  status: string;
  created_at: string;
  html_url: string;
  head_branch: string;
  name: string;
}

interface RepoInfo {
  id: number;
  full_name: string;
  name: string;
  html_url: string;
  private: boolean;
  pushed_at: string;
  default_branch: string;
  latestRun: WorkflowRun | null;
  ciStatus: "passing" | "failing" | "pending" | "none";
}

export async function GET() {
  if (!(await isAuthenticatedAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = githubToken();
  if (!token) {
    return NextResponse.json(
      { error: "No GitHub token configured. Set GATETEST_GITHUB_TOKEN or GITHUB_TOKEN in Vercel env vars." },
      { status: 503 }
    );
  }

  // Fetch repos accessible to the token. Try user repos first, then org.
  let repos: Array<{ id: number; full_name: string; name: string; html_url: string; private: boolean; pushed_at: string; default_branch: string }> = [];

  const userRepos = await githubFetch("/user/repos?type=owner&sort=pushed&per_page=100", token);
  if (Array.isArray(userRepos)) repos = userRepos;

  // Also pull org repos if the token owner belongs to orgs
  const orgs = await githubFetch("/user/orgs", token);
  if (Array.isArray(orgs)) {
    const orgRepoFetches = await Promise.all(
      orgs.slice(0, 5).map((o: { login: string }) =>
        githubFetch(`/orgs/${o.login}/repos?sort=pushed&per_page=50`, token)
      )
    );
    for (const batch of orgRepoFetches) {
      if (Array.isArray(batch)) repos.push(...batch);
    }
  }

  // Deduplicate by id
  const seen = new Set<number>();
  repos = repos.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // Sort by most recently pushed
  repos.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());

  // Enrich with latest workflow run (parallel, capped at 30 repos to avoid rate-limit)
  const enriched: RepoInfo[] = await Promise.all(
    repos.slice(0, 50).map(async (repo) => {
      const runs = await githubFetch(
        `/repos/${repo.full_name}/actions/runs?per_page=1&exclude_pull_requests=false`,
        token
      );
      const latestRun: WorkflowRun | null =
        Array.isArray(runs?.workflow_runs) && runs.workflow_runs.length > 0
          ? runs.workflow_runs[0]
          : null;

      let ciStatus: RepoInfo["ciStatus"] = "none";
      if (latestRun) {
        if (latestRun.status === "in_progress" || latestRun.status === "queued") {
          ciStatus = "pending";
        } else if (latestRun.conclusion === "success") {
          ciStatus = "passing";
        } else if (
          latestRun.conclusion === "failure" ||
          latestRun.conclusion === "timed_out" ||
          latestRun.conclusion === "action_required"
        ) {
          ciStatus = "failing";
        }
      }

      return {
        id: repo.id,
        full_name: repo.full_name,
        name: repo.name,
        html_url: repo.html_url,
        private: repo.private,
        pushed_at: repo.pushed_at,
        default_branch: repo.default_branch,
        latestRun,
        ciStatus,
      };
    })
  );

  const failing = enriched.filter((r) => r.ciStatus === "failing").length;
  const passing = enriched.filter((r) => r.ciStatus === "passing").length;

  return NextResponse.json({
    repos: enriched,
    total: enriched.length,
    failing,
    passing,
    generated_at: new Date().toISOString(),
  });
}
