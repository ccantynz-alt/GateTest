// =============================================================================
// GLUECRON RECEIVER — baseSha must reach scan_queue.base_sha
// =============================================================================
// gluecron-com-78 asked on 2026-09-02: "the payload field is `baseSha`
// (camelCase, sibling of `sha`) — confirm it lands in scan_queue.base_sha."
//
// It did not. The GitHub path (github-events.js) forwarded baseSha; the
// Gluecron receiver's validator rebuilt the payload from a fixed field list
// that never included it, and enqueueScan was called without it. Every
// Gluecron push was whole-repo enforced regardless of what the emitter sent.
//
// The existing "passes the parsed payload fields verbatim" test could not see
// this: it compared the fields IT chose, and it never chose baseSha. So this
// test goes through the REAL enqueueScan into a captured INSERT and asserts
// the value by column position — the column list is read from the SQL text,
// not assumed.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const { processPushEvent, validatePushPayload } = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'events-push.js'));
const queueStore = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'scan-queue-store.js'));

const SECRET = 'test-emitter-secret-0123456789abcdef';
const sign = (body) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');

function payload(over = {}) {
  return {
    eventId: 'evt-' + Math.random().toString(16).slice(2),
    eventType: 'push.received',
    repository: 'ccantynz-alt/Gluecron.com',
    sha: 'a'.repeat(40),
    ref: 'refs/heads/main',
    pullRequestNumber: null,
    emittedAt: '2026-09-02T00:00:00Z',
    ...over,
  };
}

/** A sql tag that records INSERT text + values and answers the queue-depth query. */
function captureSql() {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('$');
    calls.push({ text, values });
    if (/SELECT COUNT/i.test(text)) return [{ count: 0, n: 0 }];
    if (/INSERT INTO\s+scan_queue/i.test(text)) return [{ id: 1 }];
    return [];
  };
  sql.calls = calls;
  return sql;
}

/** Read the value that landed in a named column of the captured INSERT. */
function insertedColumn(sql, column) {
  const ins = sql.calls.find((c) => /INSERT INTO\s+scan_queue/i.test(c.text));
  assert.ok(ins, 'no INSERT INTO scan_queue was issued');
  const cols = ins.text.match(/INSERT INTO\s+scan_queue\s*\(([^)]*)\)/i)[1].split(',').map((s) => s.trim());
  const idx = cols.indexOf(column);
  assert.ok(idx >= 0, `column ${column} not in INSERT: ${cols.join(', ')}`);
  return ins.values[idx];
}

async function receive(body, sql) {
  return processPushEvent({
    rawBody: body,
    signatureHeader: sign(body),
    env: { GLUECRON_EMITTER_SECRET: SECRET },
    sql,
    queueStore, // the REAL store — the point is the column, not the call
    fetchImpl: async () => ({ ok: true, status: 200 }),
  });
}

describe('Gluecron receiver — baseSha lands in scan_queue.base_sha', () => {
  it('a 40-hex baseSha sibling of sha is written to base_sha', async () => {
    const base = 'b'.repeat(40);
    const sql = captureSql();
    const res = await receive(JSON.stringify(payload({ baseSha: base })), sql);
    assert.strictEqual(res.status, 202, JSON.stringify(res.body));
    assert.strictEqual(insertedColumn(sql, 'base_sha'), base);
    assert.strictEqual(insertedColumn(sql, 'sha'), 'a'.repeat(40), 'sha and base_sha must not be swapped');
  });

  it('uppercase hex is normalised, so it matches the clone', async () => {
    const sql = captureSql();
    await receive(JSON.stringify(payload({ baseSha: 'ABCDEF'.repeat(6) + 'ABCD' })), sql);
    assert.strictEqual(insertedColumn(sql, 'base_sha'), 'abcdef'.repeat(6) + 'abcd');
  });

  it('omitted (branch creation) and null both land as NULL — whole-repo enforcement', async () => {
    for (const over of [{}, { baseSha: null }]) {
      const sql = captureSql();
      const res = await receive(JSON.stringify(payload(over)), sql);
      assert.strictEqual(res.status, 202);
      assert.strictEqual(insertedColumn(sql, 'base_sha'), null);
    }
  });

  it('a malformed baseSha is rejected with 400, never silently dropped', async () => {
    // A base that vanished would be indistinguishable from Gluecron never
    // sending one. Loud beats quiet here.
    for (const bad of ['abc', 'g'.repeat(40), 42, 'a'.repeat(39)]) {
      const sql = captureSql();
      const res = await receive(JSON.stringify(payload({ baseSha: bad })), sql);
      assert.strictEqual(res.status, 400, `baseSha=${JSON.stringify(bad)} → ${res.status}`);
      assert.match(res.body.error, /baseSha/);
      assert.ok(!sql.calls.some((c) => /INSERT/i.test(c.text)), 'must not enqueue on a malformed base');
    }
  });

  it('the all-zero sha git uses for "no previous commit" is rejected, not queued as a base', () => {
    const v = validatePushPayload(payload({ baseSha: '0'.repeat(40) }));
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /branch creation/);
  });
});
