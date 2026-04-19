// ============================================================================
// EVENTS-PUSH TEST — Coverage for website/app/lib/events-push.js
// ============================================================================
// Verifies the pure helpers behind /api/events/push. Mirrors the wire contract
// at Gluecron.com/GATETEST_HOOK.md (kept here as GateTest's OWN copy — HTTP-
// only coupling, no import-level dependency).
//
// Covered paths:
//   - Valid signature + valid payload + empty queue → 202 { queued: true }
//   - Valid signature + duplicate eventId → 200 { duplicate: true }
//   - Invalid signature → 401
//   - Malformed JSON / missing required field → 400
//   - Queue depth >= 500 → 429 with Retry-After: 30
//   - GLUECRON_EMITTER_SECRET missing → 503
//   - Inline kick fired on queued, skipped on duplicate
//
// Uses node:test + node:assert. No new deps. The sql client and the
// worker-kick fetch are both injected via the fetchImpl / queueStore
// double pattern.
// ============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const {
  verifySignalSignature,
  validatePushPayload,
  processPushEvent,
  QUEUE_FULL_THRESHOLD,
} = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'events-push.js'));

const SECRET = 'test-emitter-secret-0123456789abcdef';

function hmacHeader(body, secret = SECRET) {
  return (
    'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
  );
}

function validPayload(overrides = {}) {
  return {
    eventId: '11111111-2222-3333-4444-555555555555',
    eventType: 'push.received',
    repository: 'alice/webapp',
    sha: 'a'.repeat(40),
    ref: 'refs/heads/main',
    pullRequestNumber: null,
    emittedAt: '2026-04-15T12:00:00Z',
    ...overrides,
  };
}

/**
 * Build a queueStore double whose methods record calls and return canned
 * values. Each helper can be overridden per test.
 */
function makeQueueStore({
  depth = 0,
  enqueueResult = { duplicate: false, id: 42 },
  enqueueThrows = null,
} = {}) {
  const calls = { getQueueDepth: 0, enqueueScan: [] };
  return {
    calls,
    getQueueDepth: async () => {
      calls.getQueueDepth++;
      return depth;
    },
    enqueueScan: async (args) => {
      calls.enqueueScan.push(args);
      if (enqueueThrows) throw enqueueThrows;
      return enqueueResult;
    },
  };
}

function makeFetchImpl() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200 };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ---------------------------------------------------------------------------
// verifySignalSignature
// ---------------------------------------------------------------------------

describe('verifySignalSignature', () => {
  it('returns true when header matches sha256=<hmac(secret, body)>', () => {
    const body = '{"hello":"world"}';
    const header = hmacHeader(body);
    assert.strictEqual(verifySignalSignature(body, header, SECRET), true);
  });

  it('returns false on wrong signature', () => {
    const body = '{"hello":"world"}';
    const header =
      'sha256=' + crypto.createHmac('sha256', 'wrong').update(body).digest('hex');
    assert.strictEqual(verifySignalSignature(body, header, SECRET), false);
  });

  it('returns false when header is missing or malformed', () => {
    assert.strictEqual(verifySignalSignature('{}', null, SECRET), false);
    assert.strictEqual(verifySignalSignature('{}', '', SECRET), false);
    assert.strictEqual(verifySignalSignature('{}', 'not-sha256', SECRET), false);
  });

  it('returns false when secret is unset', () => {
    assert.strictEqual(verifySignalSignature('{}', hmacHeader('{}'), ''), false);
  });
});

// ---------------------------------------------------------------------------
// validatePushPayload
// ---------------------------------------------------------------------------

describe('validatePushPayload', () => {
  it('accepts a well-formed payload', () => {
    const result = validatePushPayload(validPayload());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.payload.eventId, '11111111-2222-3333-4444-555555555555');
    assert.strictEqual(result.payload.pullRequestNumber, null);
  });

  it('rejects missing eventId', () => {
    const result = validatePushPayload(validPayload({ eventId: undefined }));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /eventId/);
  });

  it('rejects wrong eventType', () => {
    const result = validatePushPayload(validPayload({ eventType: 'something.else' }));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /eventType/);
  });

  it('rejects bad repository shape', () => {
    const result = validatePushPayload(validPayload({ repository: 'no-slash' }));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /repository/);
  });

  it('rejects non-40-hex sha', () => {
    const result = validatePushPayload(validPayload({ sha: 'too-short' }));
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /sha/);
  });

  it('accepts an integer pullRequestNumber and coerces null / undefined', () => {
    assert.strictEqual(
      validatePushPayload(validPayload({ pullRequestNumber: 42 })).payload
        .pullRequestNumber,
      42
    );
    assert.strictEqual(
      validatePushPayload(validPayload({ pullRequestNumber: null })).payload
        .pullRequestNumber,
      null
    );
  });

  it('rejects a non-integer pullRequestNumber', () => {
    const result = validatePushPayload(validPayload({ pullRequestNumber: 'abc' }));
    assert.strictEqual(result.ok, false);
  });

  it('rejects a non-object body', () => {
    assert.strictEqual(validatePushPayload(null).ok, false);
    assert.strictEqual(validatePushPayload('string').ok, false);
    assert.strictEqual(validatePushPayload(42).ok, false);
  });
});

// ---------------------------------------------------------------------------
// processPushEvent — end-to-end orchestrator
// ---------------------------------------------------------------------------

describe('processPushEvent', () => {
  const SQL = () => []; // we never call real sql; queueStore is doubled

  it('returns 503 when GLUECRON_EMITTER_SECRET is not set', async () => {
    const body = JSON.stringify(validPayload());
    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: {},
      sql: SQL,
      queueStore: makeQueueStore(),
    });
    assert.strictEqual(result.status, 503);
    assert.match(result.body.error, /GLUECRON_EMITTER_SECRET/);
  });

  it('returns 401 on invalid signature', async () => {
    const body = JSON.stringify(validPayload());
    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: 'sha256=deadbeef',
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore: makeQueueStore(),
    });
    assert.strictEqual(result.status, 401);
    assert.match(result.body.error, /invalid signature/);
  });

  it('returns 400 on malformed JSON', async () => {
    const body = 'not-json';
    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore: makeQueueStore(),
    });
    assert.strictEqual(result.status, 400);
    assert.match(result.body.error, /malformed/);
  });

  it('returns 400 when payload shape is wrong', async () => {
    const body = JSON.stringify(validPayload({ sha: 'short' }));
    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore: makeQueueStore(),
    });
    assert.strictEqual(result.status, 400);
    assert.match(result.body.error, /malformed/);
  });

  it('returns 202 on valid, newly-queued event and fires the worker kick', async () => {
    const body = JSON.stringify(validPayload());
    const queueStore = makeQueueStore({
      enqueueResult: { duplicate: false, id: 42 },
    });
    const fetchImpl = makeFetchImpl();

    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET, CRON_SECRET: 'cron-abc' },
      sql: SQL,
      queueStore,
      fetchImpl,
      baseUrl: 'https://gatetest.io',
    });

    assert.strictEqual(result.status, 202);
    assert.strictEqual(result.body.queued, true);
    assert.strictEqual(
      result.body.eventId,
      '11111111-2222-3333-4444-555555555555'
    );
    assert.strictEqual(queueStore.calls.enqueueScan.length, 1);
    // Yield a microtask so the fire-and-forget kick has a chance to land.
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(fetchImpl.calls.length, 1);
    assert.strictEqual(
      fetchImpl.calls[0].url,
      'https://gatetest.io/api/scan/worker/tick'
    );
    assert.strictEqual(
      fetchImpl.calls[0].init.headers['X-Vercel-Cron-Secret'],
      'cron-abc'
    );
  });

  it('returns 200 duplicate on ON CONFLICT hit and skips the worker kick', async () => {
    const body = JSON.stringify(validPayload());
    const queueStore = makeQueueStore({
      enqueueResult: { duplicate: true, id: null },
    });
    const fetchImpl = makeFetchImpl();

    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore,
      fetchImpl,
      baseUrl: 'https://gatetest.io',
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.duplicate, true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(
      fetchImpl.calls.length,
      0,
      'no kick needed — the row was already queued'
    );
  });

  it('returns 429 with Retry-After: 30 when queue depth >= threshold', async () => {
    const body = JSON.stringify(validPayload());
    const queueStore = makeQueueStore({
      depth: QUEUE_FULL_THRESHOLD,
      enqueueResult: { duplicate: false, id: 1 },
    });
    const result = await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore,
    });
    assert.strictEqual(result.status, 429);
    assert.match(result.body.error, /queue full/);
    assert.strictEqual(result.headers['Retry-After'], '30');
    assert.strictEqual(
      queueStore.calls.enqueueScan.length,
      0,
      'must not enqueue when queue is full'
    );
  });

  it('passes the parsed payload fields verbatim to enqueueScan', async () => {
    const payload = validPayload({
      pullRequestNumber: 17,
      ref: 'refs/pull/17/merge',
    });
    const body = JSON.stringify(payload);
    const queueStore = makeQueueStore();
    await processPushEvent({
      rawBody: body,
      signatureHeader: hmacHeader(body),
      env: { GLUECRON_EMITTER_SECRET: SECRET },
      sql: SQL,
      queueStore,
    });
    assert.deepStrictEqual(
      {
        eventId: queueStore.calls.enqueueScan[0].eventId,
        repository: queueStore.calls.enqueueScan[0].repository,
        sha: queueStore.calls.enqueueScan[0].sha,
        ref: queueStore.calls.enqueueScan[0].ref,
        pullRequestNumber: queueStore.calls.enqueueScan[0].pullRequestNumber,
      },
      {
        eventId: payload.eventId,
        repository: payload.repository,
        sha: payload.sha,
        ref: payload.ref,
        pullRequestNumber: 17,
      }
    );
  });
});
