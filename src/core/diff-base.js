'use strict';
/**
 * The base a change is judged against — one definition (Doctrine §4).
 *
 * prSize, fakeFixDetector and the runner's `--diff` each resolved this on
 * their own, and each got a different answer on the same checkout: the runner
 * asked for a LOCAL `main` first (stale on most machines, absent on CI, where
 * a PR checkout has only `origin/main`), prSize walked to that stale `main`
 * whenever `origin/main` gave an empty diff, fakeFixDetector read `HEAD~1`
 * (the last commit of a multi-commit PR). None of them knew a merge queue:
 * a `merge_group` event names its base in the event payload, not in
 * GITHUB_BASE_REF (the Fifty, move 27).
 *
 * Order, first candidate that exists and shares history with HEAD wins:
 *   1. an explicit ref (config `baseBranch`, `against`)
 *   2. `--since` / `--pr` (incrementalSince)
 *   3. a merge-queue base: GITHUB_EVENT_NAME=merge_group → the payload's
 *      merge_group.base_sha (then origin/<base_ref>)
 *   4. GITHUB_BASE_REF → origin/<ref>
 *   5. origin/main, origin/master
 *   6. a LOCAL main / master — only when no origin/* exists at all
 * An unfetched ref is skipped, never fatal. Nothing resolves → null, and the
 * caller decides what a change with no base means (usually: the working
 * tree, then the last commit).
 */

const fs = require('fs');
const { execFileSync } = require('child_process');

function git(projectRoot, args) {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
  } catch { return null; } // error-ok — a missing ref or no repo is an answer, not a crash
}

function refExists(projectRoot, ref) {
  return git(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
}

/**
 * The merge-queue base from the Actions event payload, or null. Reads the
 * file GitHub writes (GITHUB_EVENT_PATH); never trusts a partially-shaped
 * payload.
 */
function mergeGroupBase(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'merge_group' || !env.GITHUB_EVENT_PATH) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const mg = payload && payload.merge_group;
    if (!mg) return null;
    const out = [];
    if (typeof mg.base_sha === 'string' && /^[0-9a-f]{7,40}$/i.test(mg.base_sha)) out.push(mg.base_sha);
    if (typeof mg.base_ref === 'string' && mg.base_ref) out.push(`origin/${mg.base_ref.replace(/^refs\/heads\//, '')}`);
    return out.length ? out : null;
  } catch { return null; } // error-ok — an unreadable payload means "not a merge group we can use"
}

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} [opts.explicit]           config baseBranch / against
 * @param {string} [opts.incrementalSince]   --since / --pr
 * @param {object} [opts.env]
 * @returns {{ref:string, mergeBase:string, source:string}|null}
 */
function resolveDiffBase({ projectRoot, explicit, incrementalSince, env = process.env } = {}) {
  const root = projectRoot || process.cwd();
  const candidates = [];
  if (explicit) candidates.push({ ref: explicit, source: 'explicit' });
  if (incrementalSince) candidates.push({ ref: incrementalSince, source: 'since' });
  for (const ref of mergeGroupBase(env) || []) candidates.push({ ref, source: 'merge-group' });
  if (env.GITHUB_BASE_REF) candidates.push({ ref: `origin/${env.GITHUB_BASE_REF}`, source: 'github-base-ref' });
  // `origin/HEAD` first: it is the remote's DEFAULT branch, whatever it is
  // called. axios develops on `v1.x`; against `origin/main` a pinned v1.x
  // commit diffed as the entire branch (#418's corpus run, 2026-09-02).
  candidates.push({ ref: 'origin/HEAD', source: 'origin' }, { ref: 'origin/main', source: 'origin' }, { ref: 'origin/master', source: 'origin' });
  if (!refExists(root, 'origin/main') && !refExists(root, 'origin/master')) {
    candidates.push({ ref: 'main', source: 'local' }, { ref: 'master', source: 'local' });
  }
  for (const c of candidates) {
    if (!refExists(root, c.ref)) continue;
    const mergeBase = git(root, ['merge-base', 'HEAD', c.ref]);
    if (!mergeBase) continue;
    return { ref: c.ref, mergeBase, source: c.source };
  }
  return null;
}

module.exports = { resolveDiffBase, mergeGroupBase };
