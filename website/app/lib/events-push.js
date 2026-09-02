/**
 * Pure helpers for the Signal Bus E1 inbound endpoint at
 * `website/app/api/events/push/route.ts`.
 *
 * The route's HMAC verification, body parsing, shape validation, and
 * enqueue flow live here so they can be unit-tested from
 * `tests/events-push.test.js` with `node --test`. Nothing in here
 * performs network I/O. `processPushEvent` accepts injected `sql`
 * (Neon tagged-template) and `fetchImpl` seams so tests mock at the
 * right boundary.
 *
 * Wire contract — DO NOT import from Gluecron; each repo keeps its own
 * copy per the HTTP-only coupling rule. Source: Gluecron.com/GATETEST_HOOK.md.
 *
 * POST /api/events/push
 * Auth — ONE secret, GLUECRON_EMITTER_SECRET, accepted two ways:
 *   X-Signal-Signature: sha256=<hmac(GLUECRON_EMITTER_SECRET, rawBody)>
 *   Authorization: Bearer <GLUECRON_EMITTER_SECRET>
 * Body (JSON) — Signal Bus shape:
 *   { eventId, eventType:'push.received', repository, sha, ref,
 *     pullRequestNumber, baseSha?, emittedAt }
 * — or the shape Gluecron's src/lib/gate.ts notifyGateTestOfPush has emitted
 *   since before the Signal Bus existed (verified by vapron-4f 2026-09-02 on
 *   gluecron.com main @167ecb8 and gluecron.vapron.ai @07773a0):
 *   { repository, ref, sha, baseSha?, source:'gluecron', mode:'async'|... }
 *   It is normalised into the Signal Bus shape (see normaliseLegacyPayload)
 *   with a DETERMINISTIC eventId, so a retry still hits the duplicate path.
 *   Both shapes land on one intake so Craig mints one secret and no Gluecron
 *   deploy is needed for the first push to queue.
 *
 * Responses:
 *   202 { queued: true, eventId }       — new event enqueued
 *   200 { duplicate: true, eventId }    — idempotency hit
 *   400 { error: 'malformed' }          — body / shape invalid
 *   401 { error: 'invalid signature' }  — HMAC mismatch
 *   429 { error: 'queue full' }         — depth >= 500, Retry-After: 30
 *   503 { error: 'secret not set' }     — env misconfigured
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto');

// Backpressure threshold. Above this queue depth we 429.
const QUEUE_FULL_THRESHOLD = 500;
const RETRY_AFTER_SECONDS = 30;

/**
 * Timing-safe compare of two equal-length strings. Returns false on
 * length mismatch or missing inputs — never throws.
 */
function safeEqual(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Verify the X-Signal-Signature header against the raw body using
 * HMAC-SHA256 keyed on the emitter secret. Returns boolean.
 *
 * @param {string} rawBody
 * @param {string|null} headerValue  e.g. 'sha256=abcdef...'
 * @param {string} secret
 */
function verifySignalSignature(rawBody, headerValue, secret) {
  if (!secret) return false;
  if (!headerValue || typeof headerValue !== 'string') return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, headerValue);
}

/**
 * Verify `Authorization: Bearer <secret>` against the emitter secret.
 * Timing-safe; false on anything missing.
 */
function verifyBearer(headerValue, secret) {
  if (!secret || !headerValue || typeof headerValue !== 'string') return false;
  const m = headerValue.match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return false;
  return safeEqual(m[1], secret);
}

/**
 * Deterministic eventId for a body that did not carry one: a UUID-shaped
 * digest over what identifies the event, so a retried notify dedupes as
 * 200-duplicate instead of queueing a second scan. Same inputs and order
 * as Gluecron's own scheme (gluecron-com-78, PR #5624): the version tag,
 * repository, ref, sha, baseSha-or-empty, mode — joined with a newline.
 */
function deriveEventId({ repository, ref, sha, baseSha, mode }) {
  const h = crypto.createHash('sha256')
    .update(['gluecron-gatetest-v1', repository, ref || '', sha, baseSha || '', mode || 'async'].join('\n'))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Gluecron's gate.ts emitter sends { repository, ref, sha, baseSha?, source,
 * mode } — no eventId, eventType or emittedAt. Rebuild the Signal Bus shape
 * from it. Anything already carrying eventId + eventType is returned as-is,
 * so an emitter that has moved to the Signal Bus shape is never touched.
 */
function normaliseLegacyPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (parsed.eventId || parsed.eventType) return parsed;
  if (typeof parsed.sha !== 'string' || typeof parsed.repository !== 'string') return parsed;
  const sha = parsed.sha.toLowerCase();
  const baseSha = typeof parsed.baseSha === 'string' ? parsed.baseSha.toLowerCase() : parsed.baseSha;
  return {
    eventId: deriveEventId({ repository: parsed.repository, ref: parsed.ref, sha, baseSha, mode: parsed.mode }),
    eventType: 'push.received',
    repository: parsed.repository,
    sha,
    ref: parsed.ref,
    pullRequestNumber: parsed.pullRequestNumber === undefined ? null : parsed.pullRequestNumber,
    baseSha: baseSha === undefined ? null : baseSha,
    emittedAt: parsed.emittedAt || new Date().toISOString(),
    legacyShape: true,
  };
}

/**
 * Validate the parsed JSON body against the Signal Bus E1 contract.
 * Returns `{ ok: true, payload }` or `{ ok: false, error }`.
 *
 * @param {unknown} parsed
 */
function validatePushPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const p = /** @type {Record<string, unknown>} */ (parsed);

  if (typeof p.eventId !== 'string' || !p.eventId) {
    return { ok: false, error: 'eventId is required' };
  }
  if (p.eventType !== 'push.received') {
    return { ok: false, error: "eventType must be 'push.received'" };
  }
  if (typeof p.repository !== 'string' || !/^[^/]+\/[^/]+$/.test(p.repository)) {
    return { ok: false, error: "repository must be 'owner/name'" };
  }
  if (typeof p.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(p.sha)) {
    return { ok: false, error: 'sha must be a 40-hex string' };
  }
  if (typeof p.ref !== 'string' || !p.ref) {
    return { ok: false, error: 'ref is required' };
  }
  if (typeof p.emittedAt !== 'string' || !p.emittedAt) {
    return { ok: false, error: 'emittedAt is required' };
  }

  let prNum = null;
  if (p.pullRequestNumber !== null && p.pullRequestNumber !== undefined) {
    const n = Number(p.pullRequestNumber);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, error: 'pullRequestNumber must be an integer or null' };
    }
    prNum = n;
  }

  // baseSha (optional): the commit this push is compared against —
  // post-receive's oldSha, or the merge-base for a merge-gate scan. Gluecron
  // omits it on branch creation. Without it every push is whole-repo
  // enforced (gate-verdict.js), which is the loud mode; with it only code
  // this push touched can fail. Anything that isn't a 40-hex sha is
  // rejected rather than silently dropped — a malformed base that vanished
  // would look exactly like Gluecron never sending one.
  let baseSha = null;
  if (p.baseSha !== null && p.baseSha !== undefined) {
    if (typeof p.baseSha !== 'string' || !/^[0-9a-f]{40}$/i.test(p.baseSha)) {
      return { ok: false, error: 'baseSha must be a 40-hex string when present' };
    }
    if (/^0{40}$/.test(p.baseSha)) {
      return { ok: false, error: 'baseSha must be omitted on branch creation, not all-zero' };
    }
    baseSha = p.baseSha.toLowerCase();
  }

  return {
    ok: true,
    payload: {
      eventId: p.eventId,
      eventType: p.eventType,
      repository: p.repository,
      sha: p.sha,
      ref: p.ref,
      pullRequestNumber: prNum,
      baseSha,
      emittedAt: p.emittedAt,
    },
  };
}

/**
 * End-to-end handler for a POST /api/events/push request. Returns a
 * plain `{ status, body, headers? }` object so the route can translate
 * to a NextResponse without knowing the orchestration details.
 *
 * @param {object} args
 * @param {string} args.rawBody
 * @param {string|null} args.signatureHeader
 * @param {Record<string, string | undefined>} args.env
 * @param {Function} args.sql                                 Neon tagged template
 * @param {Object} args.queueStore                            scan-queue-store module (or test double)
 * @param {(url:string, init:object)=>Promise<unknown>} [args.fetchImpl]  for the async kick
 * @param {string} [args.baseUrl]                             for the async kick URL
 */
async function processPushEvent({
  rawBody,
  signatureHeader,
  authorizationHeader,
  env,
  sql,
  queueStore,
  fetchImpl,
  baseUrl,
}) {
  const secret = env.GLUECRON_EMITTER_SECRET;
  if (!secret) {
    return {
      status: 503,
      body: { error: 'GLUECRON_EMITTER_SECRET is not set' },
    };
  }

  // HMAC when the header is present; bearer otherwise. A body that carries
  // a signature is judged on the signature alone — a valid bearer must not
  // rescue a bad signature.
  const authed = signatureHeader
    ? verifySignalSignature(rawBody, signatureHeader, secret)
    : verifyBearer(authorizationHeader, secret);
  if (!authed) {
    return { status: 401, body: { error: 'invalid signature' } };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'malformed: invalid JSON' } };
  }

  const validation = validatePushPayload(normaliseLegacyPayload(parsed));
  if (!validation.ok) {
    return { status: 400, body: { error: `malformed: ${validation.error}` } };
  }
  const payload = validation.payload;

  // Backpressure — don't let the queue balloon past THRESHOLD.
  let depth = 0;
  try {
    depth = await queueStore.getQueueDepth(sql);
  } catch (err) { // error-ok — queue depth check fails open; still enqueue rather than drop the event
    console.error('[events-push] getQueueDepth failed:', err && err.message ? err.message : err);
    // Fail open — if we can't read depth, still try to enqueue.
  }
  if (depth >= QUEUE_FULL_THRESHOLD) {
    return {
      status: 429,
      body: { error: 'queue full', depth },
      headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) },
    };
  }

  let enq;
  try {
    enq = await queueStore.enqueueScan({
      eventId: payload.eventId,
      repository: payload.repository,
      sha: payload.sha,
      ref: payload.ref,
      pullRequestNumber: payload.pullRequestNumber,
      baseSha: payload.baseSha || null,
      host: 'gluecron',
      sql,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : 'enqueue failed';
    console.error('[events-push] enqueueScan failed:', msg);
    return { status: 500, body: { error: msg } };
  }

  // Fire-and-forget kick to the worker so a push during a cron gap still
  // runs promptly. No await — caller gets a fast 202. Failure is logged
  // and discarded; the 1-minute cron will pick the row up anyway.
  if (!enq.duplicate && fetchImpl && baseUrl) {
    try {
      const url = `${baseUrl}/api/scan/worker/tick`;
      const p = fetchImpl(url, {
        method: 'POST',
        headers: {
          'X-Vercel-Cron-Secret': env.CRON_SECRET || '',
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (p && typeof p.catch === 'function') {
        p.catch((err) => {
          console.error(
            '[events-push] worker kick failed:',
            err && err.message ? err.message : err
          );
        });
      }
    } catch (err) {
      console.error(
        '[events-push] worker kick threw:',
        err && err.message ? err.message : err
      );
    }
  }

  if (enq.duplicate) {
    return {
      status: 200,
      body: { duplicate: true, eventId: payload.eventId },
    };
  }
  return {
    status: 202,
    body: { queued: true, eventId: payload.eventId },
  };
}

module.exports = {
  verifyBearer,
  deriveEventId,
  normaliseLegacyPayload,
  QUEUE_FULL_THRESHOLD,
  RETRY_AFTER_SECONDS,
  verifySignalSignature,
  validatePushPayload,
  processPushEvent,
};
