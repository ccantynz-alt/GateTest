// ============================================================================
// scan_queue schema-drift guard.
//
// Why this exists: /api/db/init carried its OWN copy of the scan_queue DDL,
// separate from ensureScanQueueTable() in scan-queue-store.js. The two
// diverged — the store gained a `host` column for dual-host support (GitHub
// App webhook + Gluecron Signal Bus) and the route's copy never did.
//
// Because CREATE TABLE IF NOT EXISTS silently does nothing when the table
// already exists, production ended up with a scan_queue that had no `host`
// column while the worker's claim query selected `q.host`. Every tick died
// with:
//
//     {"ok":false,"reclaimed":0,"error":"column q.host does not exist"}
//
// so the queue never drained: pushes were enqueued by /api/webhook and never
// scanned, and no commit status was ever posted. Verified live on
// gatetest.ai 2026-07-26.
//
// The fix was to delete the duplicate and have the route delegate to
// ensureScanQueueTable(). These tests keep it that way.
// ============================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INIT_ROUTE = path.join(ROOT, 'website/app/api/db/init/route.ts');
const STORE = path.join(ROOT, 'website/app/lib/scan-queue-store.js');

describe('scan_queue schema — single source of truth', () => {
  it('/api/db/init does NOT carry its own scan_queue CREATE TABLE', () => {
    const src = fs.readFileSync(INIT_ROUTE, 'utf8');
    const ownDdl = /CREATE TABLE IF NOT EXISTS\s+scan_queue/i.test(src);
    assert.equal(
      ownDdl,
      false,
      'db/init must delegate to ensureScanQueueTable() instead of duplicating the ' +
        'scan_queue DDL — a second copy is exactly how the `host` column went missing ' +
        'in production and killed every worker tick',
    );
  });

  it('/api/db/init delegates to ensureScanQueueTable', () => {
    const src = fs.readFileSync(INIT_ROUTE, 'utf8');
    assert.match(src, /ensureScanQueueTable\s*\(/, 'db/init should call ensureScanQueueTable(sql)');
  });

  it('the store owns a host column AND an idempotent migration for existing tables', () => {
    const src = fs.readFileSync(STORE, 'utf8');
    // Fresh databases get it from CREATE TABLE...
    assert.match(src, /host\s+TEXT\s+NOT NULL\s+DEFAULT/i, 'CREATE TABLE must define host');
    // ...and already-created ones from the ALTER. Without this, calling
    // db/init against an existing production DB is a silent no-op.
    assert.match(
      src,
      /ALTER TABLE\s+scan_queue\s+ADD COLUMN IF NOT EXISTS\s+host/i,
      'an existing scan_queue is only repaired by an idempotent ADD COLUMN',
    );
  });

  it('every column the worker SELECTs is defined by the store schema', () => {
    const src = fs.readFileSync(STORE, 'utf8');
    // Columns referenced as q.<name> in the claim/reclaim queries.
    const selected = new Set([...src.matchAll(/\bq\.([a-z_]+)/g)].map((m) => m[1]));
    assert.ok(selected.size > 0, 'expected the store to alias the queue table as q');
    for (const col of selected) {
      assert.ok(
        new RegExp(`^\\s*${col}\\b`, 'im').test(src) || new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i').test(src),
        `worker selects q.${col} but no scan_queue column named "${col}" is declared — ` +
          'this is the "column q.host does not exist" failure mode',
      );
    }
  });
});
