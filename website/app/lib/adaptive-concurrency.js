/**
 * Adaptive-concurrency worker pool with mid-run throttle support.
 *
 * Extracted from website/app/api/scan/fix/route.ts for independent testability
 * (pure JS, no Next.js/TS transform required).
 *
 * Why this exists: Anthropic API can fail in correlated bursts (SSL alerts,
 * rate-limit waves). When that happens, parallel requests poison each other —
 * the fix is to drop concurrency from N → 1 mid-run and let backoff do the
 * work. The pool watches `state.activeConcurrency` on every loop iteration
 * and shrinks the live worker set to honour the new cap.
 *
 * Race-condition fix (HIGH-severity): the previous implementation let any
 * worker that observed `activeWorkers > activeConcurrency` exit. Two workers
 * could observe this simultaneously and both exit, stalling the cursor with
 * items still queued.
 *
 * Strategy (Option A — atomic check-and-decrement): when a worker observes
 * over-capacity it MUST atomically decrement before returning. Combined with
 * the "last-worker-stays" rule (`activeWorkers > 1` before the decrement),
 * this prevents the dual-exit race: even if two workers see `activeWorkers > cap`
 * simultaneously, the second one's check will see the first's already-applied
 * decrement and stay alive. The last worker stays regardless of the cap —
 * `activeConcurrency` is a CEILING, not a floor.
 *
 * Invariant: `activeWorkers >= 0` at every transition. Asserted inline.
 *
 * Note: JavaScript's single-threaded event loop means increments/decrements
 * are atomic with respect to each other; the race is purely between the
 * `await fn(...)` resumption points where multiple microtasks resolve in
 * sequence. The atomic check-and-decrement here means once a worker has
 * decided to exit and adjusted the count, no other worker observes the
 * stale pre-decrement value.
 */

'use strict';

function assertNonNegative(value, label) {
  if (value < 0) {
    throw new Error(
      `adaptive-concurrency invariant violated: ${label} went negative (${value})`,
    );
  }
}

/**
 * Run `fn` over `items` with up to `initialLimit` workers. The shared `state`
 * object is passed to every `fn` call so the user's worker can mutate
 * `state.activeConcurrency` (throttle down) or `state.haltRun` (abort) and the
 * pool will react on the next loop iteration.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} initialLimit
 * @param {(item: T, state: object) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithAdaptiveConcurrency(items, initialLimit, fn) {
  const results = new Array(items.length);
  const state = {
    consecutiveNetworkErrors: 0,
    activeConcurrency: initialLimit,
    haltRun: false,
  };
  let cursor = 0;
  let activeWorkers = 0;

  async function worker() {
    activeWorkers++;
    assertNonNegative(activeWorkers, 'activeWorkers (post-increment)');
    let exitedEarly = false;
    try {
      while (cursor < items.length && !state.haltRun) {
        // Honour dynamic throttling, but only if there's at least one OTHER
        // worker still alive. The last worker stays — `activeConcurrency` is
        // a ceiling, not a floor. Without this guard, two workers can race
        // on the over-cap check and both exit, stalling the cursor.
        //
        // ATOMIC: in the same JS turn (no `await` between check and the
        // decrement) we both verify over-capacity AND drop the count. The
        // next worker that resumes from its `await` will observe the new
        // count and re-evaluate — guaranteeing at most ONE worker exits
        // per over-cap event.
        if (activeWorkers > state.activeConcurrency && activeWorkers > 1) {
          activeWorkers--;
          assertNonNegative(activeWorkers, 'activeWorkers (early-exit decrement)');
          exitedEarly = true;
          return;
        }
        const idx = cursor++;
        results[idx] = await fn(items[idx], state);
      }
    } finally {
      if (!exitedEarly) {
        activeWorkers--;
        assertNonNegative(activeWorkers, 'activeWorkers (post-decrement)');
      }
    }
  }

  const startCount = Math.min(initialLimit, items.length);
  const workers = Array.from({ length: startCount }, () => worker());
  await Promise.all(workers);
  return results;
}

module.exports = { mapWithAdaptiveConcurrency };
