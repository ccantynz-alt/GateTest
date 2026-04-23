/**
 * Signal Bus E1 — scan_queue persistence helper.
 *
 * The queue table backs the async push-event pipeline from Gluecron.
 * Rows are INSERTed by /api/events/push (inbound HMAC'd webhook) and
 * claimed by the cron-driven consumer at /api/scan/worker/tick.
 * event_id is the caller-supplied idempotency key.
 *
 * Storage: the existing Neon Postgres database (no new service dependency).
 * Serverless rules: no in-memory state, function-scoped only. Every helper
 * receives the sql tagged-template so the caller (route handler or test)
 * decides where the connection comes from. Mirrors the design of
 * installation-store.js.
 *
 * Status lifecycle:
 *   queued   → claimed by claimNextJob (→ running, started_at stamped)
 *   running  → markDone / markFailed / reclaimStuck
 *   done     → terminal (result_json retained for debugging / audit)
 *   failed   → terminal-but-retryable if attempts < 5
 *   dead     → terminal; exceeded retry budget, error callback sent
 */

const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_SECONDS = [30, 120, 300, 900, 1800]; // 30s, 2m, 5m, 15m, 30m

/**
 * Ensure the `scan_queue` table exists. Idempotent. Mirrors the schema in
 * /api/db/init/route.ts — keep in sync.
 *
 * @param {Function} sql - tagged-template SQL function
 */
async function ensureScanQueueTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS scan_queue (
    id BIGSERIAL PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    repository TEXT NOT NULL,
    sha TEXT NOT NULL,
    ref TEXT,
    pull_request_number INT,
    host TEXT NOT NULL DEFAULT 'gluecron',
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE scan_queue ADD COLUMN IF NOT EXISTS host TEXT NOT NULL DEFAULT 'gluecron'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_queue_ready
    ON scan_queue (status, next_run_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scan_queue_repo_sha
    ON scan_queue (repository, sha)`;
}

/**
 * Enqueue a scan job. INSERT ... ON CONFLICT (event_id) DO NOTHING — the
 * caller-supplied eventId is the idempotency key, so a retried POST from
 * Gluecron never double-queues.
 *
 * Returns `{ duplicate: boolean, id: number | null }`. `duplicate: true`
 * means the insert was a no-op because an event with that id already
 * exists. `id` is the primary key of the inserted (or existing) row when
 * available; null if the database did not return a RETURNING row.
 *
 * @param {Object} opts
 * @param {string} opts.eventId
 * @param {string} opts.repository        "owner/name"
 * @param {string} opts.sha
 * @param {string|null} [opts.ref]
 * @param {number|null} [opts.pullRequestNumber]
 * @param {'github'|'gluecron'} [opts.host]  source host; default 'gluecron'
 * @param {Function} opts.sql
 * @returns {Promise<{duplicate: boolean, id: number|null}>}
 */
async function enqueueScan({
  eventId,
  repository,
  sha,
  ref = null,
  pullRequestNumber = null,
  host = 'gluecron',
  sql,
}) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('enqueueScan: sql tagged-template is required');
  }
  if (!eventId) throw new Error('enqueueScan: eventId is required');
  if (!repository) throw new Error('enqueueScan: repository is required');
  if (!sha) throw new Error('enqueueScan: sha is required');

  const prNum =
    pullRequestNumber === null || pullRequestNumber === undefined
      ? null
      : Number(pullRequestNumber);

  const safeHost = host === 'github' ? 'github' : 'gluecron';

  const rows = await sql`
    INSERT INTO scan_queue
      (event_id, repository, sha, ref, pull_request_number, host, status, attempts, next_run_at)
    VALUES
      (${eventId}, ${repository}, ${sha}, ${ref}, ${prNum}, ${safeHost}, 'queued', 0, NOW())
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id
  `;

  if (Array.isArray(rows) && rows.length > 0) {
    return { duplicate: false, id: rows[0].id ?? null };
  }
  // ON CONFLICT fired — no row returned, the event was already queued.
  return { duplicate: true, id: null };
}

/**
 * Atomically claim the next ready job. Uses SELECT ... FOR UPDATE SKIP
 * LOCKED so concurrent worker ticks can't claim the same row. Bumps the
 * row to status='running', increments attempts, stamps started_at.
 *
 * Returns the claimed job or null when the queue is idle.
 *
 * @param {Function} sql
 * @returns {Promise<null | {id:number, event_id:string, repository:string, sha:string, ref:string|null, pull_request_number:number|null, attempts:number}>}
 */
async function claimNextJob(sql) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('claimNextJob: sql tagged-template is required');
  }

  // Single-statement CTE: pick the oldest ready row with SKIP LOCKED, then
  // update it in place, returning the claimed row. This avoids a round-trip
  // and keeps the FOR UPDATE lock scoped to one transaction.
  const rows = await sql`
    WITH next AS (
      SELECT id FROM scan_queue
      WHERE status = 'queued' AND next_run_at <= NOW()
      ORDER BY next_run_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE scan_queue q
    SET status = 'running',
        attempts = q.attempts + 1,
        started_at = NOW()
    FROM next
    WHERE q.id = next.id
    RETURNING q.id, q.event_id, q.repository, q.sha, q.ref,
              q.pull_request_number, q.host, q.attempts
  `;

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

/**
 * Mark a job as successfully done. Stores the result JSON payload and
 * stamps completed_at.
 *
 * @param {number} id
 * @param {object} resultJson
 * @param {Function} sql
 */
async function markDone(id, resultJson, sql) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('markDone: sql tagged-template is required');
  }
  if (id === null || id === undefined) {
    throw new Error('markDone: id is required');
  }
  const json = JSON.stringify(resultJson || {});
  await sql`
    UPDATE scan_queue
    SET status = 'done',
        result_json = ${json}::jsonb,
        completed_at = NOW(),
        last_error = NULL
    WHERE id = ${id}
  `;
}

/**
 * Mark a job as failed. If willRetry is true, the row is requeued with an
 * exponential backoff `next_run_at`. Otherwise the row is dead-lettered.
 *
 * @param {number} id
 * @param {string|Error} error
 * @param {boolean} willRetry
 * @param {Function} sql
 */
async function markFailed(id, error, willRetry, sql) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('markFailed: sql tagged-template is required');
  }
  if (id === null || id === undefined) {
    throw new Error('markFailed: id is required');
  }
  const errText = String(
    error && error.message ? error.message : error || 'unknown error'
  ).slice(0, 1000);

  if (willRetry) {
    // Load current attempts to compute backoff. Fall back to the last entry
    // of the backoff table for any attempts value past the end.
    const rows = await sql`SELECT attempts FROM scan_queue WHERE id = ${id}`;
    const attempts =
      Array.isArray(rows) && rows.length > 0 && typeof rows[0].attempts === 'number'
        ? rows[0].attempts
        : 1;
    const backoffIdx = Math.min(attempts - 1, RETRY_BACKOFF_SECONDS.length - 1);
    const backoffSec = RETRY_BACKOFF_SECONDS[Math.max(0, backoffIdx)];
    await sql`
      UPDATE scan_queue
      SET status = 'queued',
          last_error = ${errText},
          next_run_at = NOW() + (${backoffSec} || ' seconds')::interval
      WHERE id = ${id}
    `;
  } else {
    await sql`
      UPDATE scan_queue
      SET status = 'dead',
          last_error = ${errText},
          completed_at = NOW()
      WHERE id = ${id}
    `;
  }
}

/**
 * Force-dead a job. Used when we've decided not to retry (attempts >= MAX).
 *
 * @param {number} id
 * @param {string|Error} error
 * @param {Function} sql
 */
async function deadLetter(id, error, sql) {
  return markFailed(id, error, false, sql);
}

/**
 * Count of rows in status='queued'. Used by /api/events/push for
 * backpressure (429 when queue is full).
 *
 * @param {Function} sql
 * @returns {Promise<number>}
 */
async function getQueueDepth(sql) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('getQueueDepth: sql tagged-template is required');
  }
  const rows = await sql`SELECT COUNT(*)::int AS depth FROM scan_queue WHERE status = 'queued'`;
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const depth = rows[0].depth;
  return typeof depth === 'number' ? depth : 0;
}

/**
 * Reclaim jobs that have been in status='running' for longer than the
 * stuck threshold (5 minutes). Vercel kills functions at 60s, but retries,
 * network blips, or a crashed tick can leave a row orphaned.
 *
 * @param {Function} sql
 * @returns {Promise<number>} number of rows reclaimed
 */
async function reclaimStuck(sql) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('reclaimStuck: sql tagged-template is required');
  }
  const rows = await sql`
    UPDATE scan_queue
    SET status = 'queued',
        last_error = COALESCE(last_error, 'reclaimed from stuck running state')
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '5 minutes'
    RETURNING id
  `;
  return Array.isArray(rows) ? rows.length : 0;
}

module.exports = {
  ensureScanQueueTable,
  enqueueScan,
  claimNextJob,
  markDone,
  markFailed,
  deadLetter,
  getQueueDepth,
  reclaimStuck,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
};
