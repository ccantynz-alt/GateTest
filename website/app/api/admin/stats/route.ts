/**
 * Admin Stats API — Returns scan and customer data from the database.
 *
 * GET /api/admin/stats
 *
 * Admin-only: requires valid admin session cookie.
 * Returns recent scans, customer list, and aggregate stats.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAdminConfig,
  getAdminUser,
  SESSION_COOKIE_NAME,
} from "../../../lib/admin-session";
import { getDb } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  // Admin auth check
  const status = getAdminConfig();
  if (!status.ok || !status.config) {
    return NextResponse.json({ error: "Admin not configured" }, { status: 503 });
  }

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const adminLogin = getAdminUser(sessionCookie, status.config);

  if (!adminLogin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sql = getDb();

    // Recent scans (last 50)
    const recentScans = await sql`
      SELECT id, session_id, customer_email, repo_url, tier, status, score,
             duration_ms, tier_price_usd, created_at, completed_at
      FROM scans ORDER BY created_at DESC LIMIT 50`;

    // All customers
    const customers = await sql`
      SELECT id, email, github_login, stripe_customer_id, total_scans,
             total_spent_usd, created_at
      FROM customers ORDER BY created_at DESC LIMIT 100`;

    // Aggregate stats
    const statsResult = await sql`
      SELECT
        COUNT(*)::int AS total_scans,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_scans,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_scans,
        COALESCE(SUM(tier_price_usd), 0)::numeric AS total_revenue,
        COALESCE(AVG(score), 0)::int AS avg_score,
        COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms
      FROM scans`;

    const stats = statsResult[0] || {
      total_scans: 0,
      completed_scans: 0,
      failed_scans: 0,
      total_revenue: 0,
      avg_score: 0,
      avg_duration_ms: 0,
    };

    const customerCount = await sql`
      SELECT COUNT(*)::int AS total FROM customers`;

    return NextResponse.json({
      scans: recentScans,
      customers,
      stats: {
        ...stats,
        total_customers: customerCount[0]?.total || 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // If tables don't exist yet, return empty state rather than crashing
    if (message.includes("does not exist") || message.includes("relation")) {
      return NextResponse.json({
        scans: [],
        customers: [],
        stats: {
          total_scans: 0,
          completed_scans: 0,
          failed_scans: 0,
          total_revenue: 0,
          avg_score: 0,
          avg_duration_ms: 0,
          total_customers: 0,
        },
        note: "Database tables not initialized. Run POST /api/db/init first.",
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
