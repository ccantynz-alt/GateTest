/**
 * GET /api/telemetry/noise?days=90
 *
 * The rule-noise leaderboard (the Fifty, move 07): per rule, how many scans
 * it appeared in over the window and how often teams had silenced it. Built
 * from the anonymized per-rule counts the CLI/MCP flush to
 * POST /api/telemetry/scan — rule ids and integers only, never code, paths,
 * or repositories.
 *
 *   200 { ok: true, windowDays, scans, minScans, rules: [...] }
 *   503 { ok: false, reason }   — persistence unavailable (no DATABASE_URL)
 */

import { NextRequest, NextResponse } from "next/server";
import { readRuleNoiseRows } from "@/app/lib/scan-telemetry-store";
const { aggregateRuleNoise } = require("@/app/lib/rule-noise") as {
  aggregateRuleNoise: (rows: unknown[]) => { scans: number; minScans: number; rules: unknown[] };
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 3600;

// auth-public — aggregate counts over anonymized telemetry; nothing per-user.
export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") || 90);
  const read = await readRuleNoiseRows({ days: Number.isFinite(days) ? days : 90 });
  if (!read.ok) {
    return NextResponse.json({ ok: false, reason: read.reason, windowDays: read.windowDays }, { status: 503 });
  }
  const agg = aggregateRuleNoise(read.rows);
  return NextResponse.json(
    { ok: true, windowDays: read.windowDays, scans: agg.scans, minScans: agg.minScans, rules: agg.rules, generated_at: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200" } },
  );
}
