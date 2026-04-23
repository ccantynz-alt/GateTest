// ============================================================================
// SCAN-QUEUE-STORE TEST
// ============================================================================
// Verifies the Signal Bus E1 queue helper used by /api/events/push (enqueue)
// and /api/scan/worker/tick (claim → mark done / failed / dead). Ensures:
//   - ensureScanQueueTable issues CREATE TABLE + indexes (idempotent)
//   - enqueueScan uses INSERT ... ON CONFLICT (event_id) DO NOTHING so a
//     retried Gluecron POST with the same eventId is a no-op
//   - claimNextJob atomically moves a queued row to running via FOR UPDATE
//     SKIP LOCKED
//   - markDone / markFailed / deadLetter update the right columns
//   - getQueueDepth returns the count of queued rows
//   - reclaimStuck requeues rows that have been running > 5 minutes
//   - Contract guards: missing sql, missing required fields throw
// ============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  ensureScanQueueTable,
  enqueueScan,
  claimNextJob,
  markDone,
  markFailed,
  deadLetter,
  getQueueDepth,
  reclaimStuck,
  MAX_ATTEMPTS,
} = require(path.resolve(
  __dirname,
  '..',
  'website',
  'app',
  'lib',
  'scan-queue-store.js'
));

/**
 * Build a fake tagged-template SQL function that records every call and
 * replays canned responses in FIFO order. Reproduces the Neon tagged-
 * template signature exactly.
 */
function makeFakeSql(responses = []) {
  const calls = [];
  const queue = [...responses];
  const fakeSql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    const next = queue.length > 0 ? queue.shift() : [];
    return Promise.resolve(next);
  };
  fakeSql.calls = calls;
  return fakeSql;
}

describe('ensureScanQueueTable', () => {
  it('issues CREATE TABLE IF NOT EXISTS plus both indexes', async () => {
    const sql = makeFakeSql();
    await ensureScanQueueTable(sql);

    const joined = sql.calls.map((c) => c.text).join('\n');
    assert.match(joined, /CREATE TABLE IF NOT EXISTS scan_queue/);
    assert.match(joined, /event_id TEXT UNIQUE NOT NULL/);
    assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_scan_queue_ready/);
    assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_scan_queue_repo_sha/);
  });
});

describe('enqueueScan', () => {
  it('INSERTs with ON CONFLICT (event_id) DO NOTHING and returns id on first insert', async () => {
    const sql = makeFakeSql([[{ id: 42 }]]);
    const result = await enqueueScan({
      eventId: 'evt-abc-1',
      repository: 'alice/webapp',
      sha: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
      ref: 'refs/heads/main',
      pullRequestNumber: 7,
      sql,
    });

    assert.strictEqual(result.duplicate, false);
    assert.strictEqual(result.id, 42);

    assert.strictEqual(sql.calls.length, 1);
    const call = sql.calls[0];
    assert.match(call.text, /INSERT INTO\s+scan_queue/i);
    assert.match(call.text, /ON CONFLICT \(event_id\) DO NOTHING/i);
    assert.match(call.text, /RETURNING id/i);
    assert.deepStrictEqual(call.values, [
      'evt-abc-1',
      'alice/webapp',
      '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
      'refs/heads/main',
      7,
      'gluecron',
    ]);
  });

  it('reports duplicate when ON CONFLICT fires and no row is returned', async () => {
    const sql = makeFakeSql([[]]); // empty result set → conflict
    const result = await enqueueScan({
      eventId: 'evt-abc-1',
      repository: 'alice/webapp',
      sha: 'a'.repeat(40),
      sql,
    });
    assert.strictEqual(result.duplicate, true);
    assert.strictEqual(result.id, null);
  });

  it('normalises null pullRequestNumber and ref', async () => {
    const sql = makeFakeSql([[{ id: 1 }]]);
    await enqueueScan({
      eventId: 'evt-x',
      repository: 'alice/webapp',
      sha: 'b'.repeat(40),
      sql,
    });
    assert.deepStrictEqual(sql.calls[0].values, [
      'evt-x',
      'alice/webapp',
      'b'.repeat(40),
      null,
      null,
      'gluecron',
    ]);
  });

  it('passes host: github when explicitly set', async () => {
    const sql = makeFakeSql([[{ id: 5 }]]);
    await enqueueScan({
      eventId: 'evt-gh',
      repository: 'alice/webapp',
      sha: 'c'.repeat(40),
      host: 'github',
      sql,
    });
    const values = sql.calls[0].values;
    assert.strictEqual(values[5], 'github', `expected host='github', got ${values[5]}`);
  });

  it('throws when eventId / repository / sha / sql are missing', async () => {
    const sql = makeFakeSql();
    await assert.rejects(
      () => enqueueScan({ repository: 'a/b', sha: 'x', sql }),
      /eventId is required/
    );
    await assert.rejects(
      () => enqueueScan({ eventId: 'e', sha: 'x', sql }),
      /repository is required/
    );
    await assert.rejects(
      () => enqueueScan({ eventId: 'e', repository: 'a/b', sql }),
      /sha is required/
    );
    await assert.rejects(
      () => enqueueScan({ eventId: 'e', repository: 'a/b', sha: 'x' }),
      /sql tagged-template is required/
    );
  });
});

describe('claimNextJob', () => {
  it('runs a CTE with FOR UPDATE SKIP LOCKED and returns the claimed row', async () => {
    const claimed = {
      id: 1,
      event_id: 'evt-1',
      repository: 'alice/webapp',
      sha: 'c'.repeat(40),
      ref: 'refs/heads/main',
      pull_request_number: null,
      attempts: 1,
    };
    const sql = makeFakeSql([[claimed]]);
    const job = await claimNextJob(sql);
    assert.deepStrictEqual(job, claimed);

    const call = sql.calls[0];
    assert.match(call.text, /FOR UPDATE SKIP LOCKED/i);
    assert.match(call.text, /UPDATE scan_queue/i);
    assert.match(call.text, /status = 'running'/);
    assert.match(call.text, /attempts = q\.attempts \+ 1/);
  });

  it('returns null when the queue is empty', async () => {
    const sql = makeFakeSql([[]]);
    const job = await claimNextJob(sql);
    assert.strictEqual(job, null);
  });
});

describe('markDone / markFailed / deadLetter', () => {
  it('markDone sets status=done, stamps completed_at, stores result_json', async () => {
    const sql = makeFakeSql([[]]);
    await markDone(7, { modules: [], totalIssues: 0 }, sql);
    const call = sql.calls[0];
    assert.match(call.text, /SET status = 'done'/);
    assert.match(call.text, /completed_at = NOW\(\)/);
    assert.match(call.text, /result_json = /);
    // The serialised JSON must be passed as a parameter, not interpolated.
    const jsonParam = call.values.find(
      (v) => typeof v === 'string' && v.includes('"totalIssues"')
    );
    assert.ok(jsonParam, 'result JSON is passed as a parameter');
    assert.strictEqual(call.values[call.values.length - 1], 7);
  });

  it('markFailed with willRetry=true requeues with backoff next_run_at', async () => {
    // First call: SELECT attempts (returns 2 → backoff index 1 → 120s).
    // Second call: the UPDATE.
    const sql = makeFakeSql([[{ attempts: 2 }], []]);
    await markFailed(9, new Error('boom'), true, sql);
    assert.strictEqual(sql.calls.length, 2);
    const update = sql.calls[1];
    assert.match(update.text, /SET status = 'queued'/);
    assert.match(update.text, /last_error = /);
    assert.match(update.text, /next_run_at = NOW\(\) \+ /);
    // The error text and backoff value should be in the values array.
    assert.ok(update.values.includes('boom'));
    assert.ok(update.values.some((v) => typeof v === 'number' && v > 0));
  });

  it('markFailed with willRetry=false marks status=dead', async () => {
    const sql = makeFakeSql([[]]);
    await markFailed(10, 'hard failure', false, sql);
    const call = sql.calls[0];
    assert.match(call.text, /SET status = 'dead'/);
    assert.match(call.text, /last_error = /);
    assert.ok(call.values.includes('hard failure'));
  });

  it('deadLetter is an alias for markFailed(willRetry=false)', async () => {
    const sql = makeFakeSql([[]]);
    await deadLetter(11, 'gave up', sql);
    assert.match(sql.calls[0].text, /SET status = 'dead'/);
  });
});

describe('getQueueDepth', () => {
  it('returns the count of status=queued rows', async () => {
    const sql = makeFakeSql([[{ depth: 17 }]]);
    const depth = await getQueueDepth(sql);
    assert.strictEqual(depth, 17);
    assert.match(sql.calls[0].text, /COUNT\(\*\)/);
    assert.match(sql.calls[0].text, /status = 'queued'/);
  });

  it('returns 0 when the query returns no rows', async () => {
    const sql = makeFakeSql([[]]);
    const depth = await getQueueDepth(sql);
    assert.strictEqual(depth, 0);
  });
});

describe('reclaimStuck', () => {
  it('requeues rows stuck in running > 5 minutes and returns the count', async () => {
    const sql = makeFakeSql([[{ id: 1 }, { id: 2 }]]);
    const n = await reclaimStuck(sql);
    assert.strictEqual(n, 2);
    const call = sql.calls[0];
    assert.match(call.text, /UPDATE scan_queue/i);
    assert.match(call.text, /SET status = 'queued'/);
    assert.match(call.text, /status = 'running'/);
    assert.match(call.text, /started_at < NOW\(\) - INTERVAL '5 minutes'/);
  });

  it('returns 0 when nothing was reclaimed', async () => {
    const sql = makeFakeSql([[]]);
    const n = await reclaimStuck(sql);
    assert.strictEqual(n, 0);
  });
});

describe('contract guards', () => {
  it('exports MAX_ATTEMPTS for retry-budget decisions', () => {
    assert.strictEqual(typeof MAX_ATTEMPTS, 'number');
    assert.ok(MAX_ATTEMPTS >= 3);
  });

  it('every helper rejects when sql tagged-template is missing', async () => {
    await assert.rejects(() => claimNextJob(), /sql tagged-template is required/);
    await assert.rejects(
      () => markDone(1, {}),
      /sql tagged-template is required/
    );
    await assert.rejects(
      () => markFailed(1, 'x', true),
      /sql tagged-template is required/
    );
    await assert.rejects(() => getQueueDepth(), /sql tagged-template is required/);
    await assert.rejects(() => reclaimStuck(), /sql tagged-template is required/);
  });
});
