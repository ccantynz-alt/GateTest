/**
 * Database client — Neon serverless Postgres.
 *
 * Uses @neondatabase/serverless which is proven on Vercel (connection pooling
 * over WebSockets). Each call to getDb() returns a tagged-template SQL function
 * bound to DATABASE_URL. Stateless — safe for serverless.
 */

import { neon } from "@neondatabase/serverless";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your environment variables."
    );
  }
  const sql = neon(url);
  return sql;
}
