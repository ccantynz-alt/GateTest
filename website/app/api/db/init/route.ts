/**
 * DB Init API — Executes schema to create tables.
 *
 * POST /api/db/init
 *
 * Idempotent: all statements use IF NOT EXISTS.
 * Admin-only: requires valid admin session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdminConfig, getAdminUser, SESSION_COOKIE_NAME } from "../../../lib/admin-session";
import { getDb } from "../../../lib/db";

export async function POST(req: NextRequest) {
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

  // Suppress unused variable warning — req is required by the route handler signature
  void req;

  try {
    const sql = getDb();

    // Execute each statement separately — Neon tagged template doesn't support multi-statement
    await sql`CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      payment_intent_id TEXT,
      customer_email TEXT,
      repo_url TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      results JSONB,
      summary TEXT,
      score INTEGER,
      ai_cost_usd NUMERIC(10,4),
      tier_price_usd NUMERIC(10,2),
      modules_run TEXT[],
      duration_ms INTEGER
    )`;

    await sql`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      github_login TEXT,
      stripe_customer_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      total_scans INTEGER DEFAULT 0,
      total_spent_usd NUMERIC(10,2) DEFAULT 0
    )`;

    await sql`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      customer_email TEXT,
      tier_allowed TEXT NOT NULL DEFAULT 'quick',
      rate_limit_per_hour INTEGER NOT NULL DEFAULT 60,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      total_calls INTEGER DEFAULT 0
    )`;

    await sql`CREATE TABLE IF NOT EXISTS api_calls (
      id BIGSERIAL PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      repo_url TEXT,
      tier TEXT,
      status_code INTEGER,
      issues_found INTEGER,
      duration_ms INTEGER,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    await sql`CREATE INDEX IF NOT EXISTS idx_scans_session ON scans(session_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_scans_email ON scans(customer_email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_customers_github ON customers(github_login)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_calls_key ON api_calls(api_key_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_calls_created ON api_calls(created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_api_calls_idem ON api_calls(idempotency_key)`;

    return NextResponse.json({
      ok: true,
      tables: ["scans", "customers", "api_keys", "api_calls"],
      indexes: 10,
      message: "Schema initialized (idempotent — safe to run multiple times)",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
