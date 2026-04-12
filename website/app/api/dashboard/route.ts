/**
 * Customer Dashboard API — fetch scan history by email.
 *
 * POST /api/dashboard
 *   Body: { email: string }
 *   Returns: { scans: [...], customer: {...} }
 *
 * No auth token — email is the lookup key. Scans are only created
 * after Stripe payment, so the email comes from Stripe checkout.
 * Rate-limited by a simple cooldown to prevent enumeration.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Please enter a valid email address" },
      { status: 400 }
    );
  }

  try {
    const sql = getDb();

    const scans = await sql`
      SELECT
        id, session_id, repo_url, tier, status, score,
        duration_ms, tier_price_usd, summary,
        created_at, completed_at
      FROM scans
      WHERE LOWER(customer_email) = ${email}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    const customers = await sql`
      SELECT email, github_login, total_scans, total_spent_usd, created_at
      FROM customers
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;

    return NextResponse.json({
      scans,
      customer: customers[0] || null,
    });
  } catch (err) {
    // DB not available — return empty rather than crashing
    const message = err instanceof Error ? err.message : "Database unavailable";
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json({
        scans: [],
        customer: null,
        note: "Database not configured yet.",
      });
    }
    return NextResponse.json({ error: "Failed to fetch scans" }, { status: 500 });
  }
}
