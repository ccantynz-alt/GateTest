/**
 * Fleet Scan — scan all repos in a GitHub org at once.
 *
 * POST /api/scan/fleet
 * Body: { org: string, tier?: string }
 *
 * Fetches all repos from the org, runs a quick scan on each,
 * returns a fleet-wide health report with grades and comparison.
 */

import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

interface RepoHealth {
  name: string;
  fullName: string;
  url: string;
  score: number | null;
  grade: string;
  issues: number;
  status: "scanned" | "failed" | "skipped";
  error?: string;
  duration: number;
}

function scoreToGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "A-";
  if (score >= 80) return "B+";
  if (score >= 75) return "B";
  if (score >= 70) return "B-";
  if (score >= 65) return "C+";
  if (score >= 60) return "C";
  if (score >= 55) return "C-";
  if (score >= 50) return "D+";
  if (score >= 40) return "D";
  if (score >= 30) return "D-";
  return "F";
}

export async function POST(req: NextRequest) {
  let body: { org?: string; tier?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const org = (body.org || "").trim();
  const tier = body.tier || "quick";
  if (!org) return NextResponse.json({ error: "org required" }, { status: 400 });

  const token = process.env.GITHUB_TOKEN || process.env.GATETEST_GITHUB_TOKEN || "";

  // Fetch org repos
  let repos: Array<{ name: string; full_name: string; html_url: string; archived: boolean; fork: boolean }>;
  try {
    const headers: Record<string, string> = {
      "User-Agent": "GateTest/Fleet",
      "Accept": "application/vnd.github.v3+json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/users/${org}/repos?per_page=100&sort=updated`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API error: ${res.status}` }, { status: 502 });
    }
    repos = await res.json() as typeof repos;
  } catch (err) {
    return NextResponse.json({ error: `Failed to fetch repos: ${(err as Error).message}` }, { status: 502 });
  }

  // Filter out archived and forked repos
  const activeRepos = repos.filter((r) => !r.archived && !r.fork).slice(0, 20); // Cap at 20

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://gatetest.ai";

  // Scan each repo (sequential to avoid overwhelming the API)
  const results: RepoHealth[] = [];
  for (const repo of activeRepos) {
    const start = Date.now();
    try {
      const scanRes = await fetch(`${baseUrl}/api/scan/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repo.html_url, tier }),
      });
      const data = await scanRes.json();
      const totalIssues = Number(data.totalIssues || 0);
      const modules = (data.modules as Array<{ issues: number; status: string; details?: string[] }>) || [];
      let score = 100;
      for (const m of modules) {
        if (m.status === "failed") score -= m.issues * 3;
      }
      score = Math.max(0, Math.min(100, score));

      results.push({
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        score,
        grade: scoreToGrade(score),
        issues: totalIssues,
        status: "scanned",
        duration: Date.now() - start,
      });
    } catch (err) {
      results.push({
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        score: null,
        grade: "?",
        issues: 0,
        status: "failed",
        error: (err as Error).message,
        duration: Date.now() - start,
      });
    }
  }

  // Sort by score (lowest first — worst repos at top)
  results.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));

  const avgScore = results.filter((r) => r.score !== null).reduce((s, r) => s + (r.score || 0), 0) / Math.max(1, results.filter((r) => r.score !== null).length);
  const totalIssues = results.reduce((s, r) => s + r.issues, 0);

  return NextResponse.json({
    org,
    reposScanned: results.length,
    totalRepos: repos.length,
    averageScore: Math.round(avgScore),
    averageGrade: scoreToGrade(Math.round(avgScore)),
    totalIssues,
    repos: results,
  });
}
