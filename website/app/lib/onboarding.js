'use strict';

/**
 * Onboarding — turn a GitHub App install into value immediately.
 *
 * THE PROBLEM THIS SOLVES. Before this, installing the App persisted an
 * `installation_id` and redirected to a page that upsold auto-fixes. That
 * was the entire onboarding. Nothing scanned. The customer had to leave,
 * write code, push it, and wait for CI before GateTest did anything at all
 * — so the one moment they were paying attention produced no evidence the
 * product works.
 *
 * Now the install itself enqueues a scan of their most active repositories,
 * so results are already waiting when they land on the confirmation page.
 *
 * DESIGN RULES, each learned from something that went wrong here before:
 *
 *   1. NEVER BLOCK THE REDIRECT. Onboarding must not hang or fail because
 *      GitHub is slow or the queue is down. Everything here is best-effort
 *      and returns a reason instead of throwing.
 *   2. CAP THE FAN-OUT. An org-wide install can carry hundreds of repos.
 *      The goal is "results waiting", not "scan the estate" — that would
 *      bury the queue and the customer's first impression is a spinner.
 *      Most-recently-pushed first, because that is what they are working on.
 *   3. IDEMPOTENT. `enqueueScan` is `ON CONFLICT (event_id) DO NOTHING`, so
 *      the eventId is derived deterministically from installation + repo +
 *      sha. Re-installing, or GitHub retrying the callback, cannot double
 *      the queue.
 *   4. SKIP EMPTY REPOS. A repo with no commits has no SHA to scan; asking
 *      GitHub for one 409s. Those are silently skipped, not failed.
 *
 * Pure module — no I/O at import, every dependency injected, so the whole
 * flow is testable without GitHub or a database.
 */

/** How many repos a single install may enqueue. See design rule 2. */
const MAX_FIRST_SCANS = 3;

/**
 * Pick the repositories worth scanning first.
 *
 * Most-recently-pushed wins: that is the code they are actually working on,
 * and it is the scan whose result they will recognise. Archived and empty
 * repos are dropped — a finding on an archive is noise at the worst
 * possible moment.
 *
 * @param {Array<object>} repos — GitHub `installation/repositories` shape
 * @param {number} [limit]
 * @returns {Array<object>}
 */
function selectFirstScanRepos(repos, limit = MAX_FIRST_SCANS) {
  if (!Array.isArray(repos)) return [];
  return repos
    .filter((r) => r && r.full_name && !r.archived && !r.disabled)
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.pushed_at || a.updated_at || 0) || 0;
      const bt = Date.parse(b.pushed_at || b.updated_at || 0) || 0;
      return bt - at;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Deterministic, so a retried callback cannot double-queue.
 * @returns {string}
 */
function firstScanEventId(installationId, fullName, sha) {
  return `install-${installationId}-${fullName}-${String(sha).slice(0, 12)}`;
}

/**
 * Enqueue a first scan for the most active repos on a fresh installation.
 *
 * Never throws. Returns a structured summary so the caller can log what
 * happened without having to interpret an exception.
 *
 * @param {object} opts
 * @param {string|number} opts.installationId
 * @param {object} opts.deps
 * @param {Function} opts.deps.getInstallationToken — (id) => Promise<token>
 * @param {Function} opts.deps.listRepos            — (token) => Promise<repos[]>
 * @param {Function} opts.deps.getDefaultBranchSha  — (token, fullName) => Promise<{sha, ref}|null>
 * @param {Function} opts.deps.enqueueScan
 * @param {Function} opts.deps.sql
 * @param {number}  [opts.limit]
 * @returns {Promise<{ok: boolean, queued: Array, skipped: Array, reason?: string}>}
 */
async function enqueueFirstScans({ installationId, deps = {}, limit = MAX_FIRST_SCANS } = {}) {
  const queued = [];
  const skipped = [];

  if (!installationId) return { ok: false, queued, skipped, reason: 'no-installation-id' };
  const { getInstallationToken, listRepos, getDefaultBranchSha, enqueueScan, sql } = deps;
  if (!getInstallationToken || !listRepos || !getDefaultBranchSha || !enqueueScan || !sql) {
    return { ok: false, queued, skipped, reason: 'deps-missing' };
  }

  let token;
  try {
    token = await getInstallationToken(installationId);
  } catch (err) {
    // The App key is usually the culprit. Say so rather than "failed".
    return { ok: false, queued, skipped, reason: `token: ${(err && err.message) || 'failed'}` };
  }
  if (!token) return { ok: false, queued, skipped, reason: 'no-token' };

  let repos;
  try {
    repos = await listRepos(token);
  } catch (err) {
    return { ok: false, queued, skipped, reason: `list-repos: ${(err && err.message) || 'failed'}` };
  }

  const chosen = selectFirstScanRepos(repos, limit);
  if (chosen.length === 0) return { ok: true, queued, skipped, reason: 'no-eligible-repos' };

  for (const repo of chosen) {
    const fullName = repo.full_name;
    let head;
    try {
      head = await getDefaultBranchSha(token, fullName);
    } catch (err) {
      skipped.push({ repository: fullName, reason: `head: ${(err && err.message) || 'failed'}` });
      continue;
    }
    // An empty repo has no commit to scan. Not a failure — just nothing yet.
    if (!head || !head.sha) {
      skipped.push({ repository: fullName, reason: 'empty-repo' });
      continue;
    }

    try {
      const res = await enqueueScan({
        eventId: firstScanEventId(installationId, fullName, head.sha),
        repository: fullName,
        sha: head.sha,
        ref: head.ref || null,
        host: 'github',
        sql,
      });
      queued.push({ repository: fullName, sha: head.sha, duplicate: Boolean(res && res.duplicate) });
    } catch (err) {
      skipped.push({ repository: fullName, reason: `enqueue: ${(err && err.message) || 'failed'}` });
    }
  }

  return { ok: true, queued, skipped };
}

module.exports = {
  MAX_FIRST_SCANS,
  selectFirstScanRepos,
  firstScanEventId,
  enqueueFirstScans,
};
