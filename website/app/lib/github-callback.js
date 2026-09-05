/**
 * GitHub scan-result callback helper — dual-host Phase 2.
 *
 * After a scan triggered by a GitHub App webhook completes, this module
 * posts the result back to GitHub as:
 *   1. A commit status check (visible in the PR checks tab and branch
 *      protection rules).
 *   2. A PR comment with a formatted summary (only when the job came from
 *      a pull_request event, i.e. pull_request_number is set).
 *
 * Equivalent of gluecron-callback.js for the GitHub host path.
 *
 * Auth: GATETEST_GITHUB_TOKEN (preferred PAT) → GITHUB_TOKEN (fallback).
 * Requires `repo` scope to post statuses and PR comments on private repos;
 * public repos only need `public_repo`.
 *
 * Design rules (serverless):
 *   - Never throws. All errors are caught, logged, and returned as
 *     { sent: false, reason } so callers can log-and-move-on.
 *   - Uses global `fetch` (available in Next.js 13+ server routes).
 *   - `fetchImpl` override allows unit testing without real HTTP calls.
 */

const { siteUrl, resolveSiteUrl, SUPPORT_EMAIL } = require('./site-url');
const { computeGateVerdict } = require('./gate-verdict');

const GITHUB_API = 'https://api.github.com';
const STATUS_CONTEXT = 'gatetest / scan';
const USER_AGENT = 'GateTest/1.0';

// Per-fetch timeout (2026-08-18 audit advancement #11). A GitHub API call
// that hangs holds the worker tick hostage — 10s is generous for a status
// POST. Guarded so injected test fetchImpls without AbortSignal still work.
const FETCH_TIMEOUT_MS = 10_000;
function fetchTimeoutSignal() {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
      : undefined;
  } catch { return undefined; }
}

/**
 * Pick the best available GitHub token from env.
 * @param {Record<string, string|undefined>} env
 * @returns {string|null}
 */
function resolveGitHubToken(env) {
  return env.GATETEST_GITHUB_TOKEN || env.GITHUB_TOKEN || null;
}

/**
 * Map a scan result to a GitHub commit-status state.
 *
 * Mode handling (Option A — advisory by default, opt-in to strict):
 *   - 'advisory' (default): findings DO NOT turn the check red. Customer
 *     sees the count + advisory note. Their gate stays green so a mature
 *     codebase can install GateTest without spamming every PR red on
 *     install day. This matches the workflow's `--report-only` default.
 *     Customer flips `.gatetest.json` `mode` to `strict` when ready.
 *   - 'strict': any error-severity finding → failure check, branch
 *     protection rules block the merge. The traditional gate behaviour.
 *
 * Scan-execution failures (scan errored, never completed, etc.) always
 * return 'error' regardless of mode — that's a GateTest problem, not a
 * customer-code finding, and the customer needs to know about it.
 *
 * The decision itself lives in gate-verdict.js (shared with the Gluecron
 * callback): only CONFIDENT errors fail, and only ones IN THIS CHANGE when
 * the base commit was known. The previous body of this function read
 * `module.checks` as an array; the engine emits a number, so strict mode
 * could never go red (measured 2026-09-02).
 *
 * @param {object} scanResult
 * @param {'advisory'|'strict'|'admin'} [mode='advisory']
 * @returns {'success'|'failure'|'error'}
 */
function toCommitState(scanResult, mode = 'advisory') {
  return computeGateVerdict(scanResult, mode).state;
}

/**
 * Build the short status description (max 140 chars).
 * @param {object} scanResult
 * @param {'advisory'|'strict'} [mode='advisory']
 * @returns {string}
 */
function buildDescription(scanResult, mode = 'advisory') {
  if (!scanResult || scanResult.error) {
    return String(scanResult && scanResult.error ? scanResult.error : 'Scan failed').slice(0, 140);
  }
  const totalIssues = typeof scanResult.totalIssues === 'number' ? scanResult.totalIssues : 0;
  const modules = Array.isArray(scanResult.modules) ? scanResult.modules : [];
  const moduleCount = modules.length;
  const suffix = (mode === 'strict' || mode === 'admin') ? '' : ' · advisory mode';
  if (totalIssues === 0) {
    return `All ${moduleCount} module${moduleCount === 1 ? '' : 's'} passed — 0 issues found${suffix}`.slice(0, 140);
  }
  // A red check names what made it red; a green one with findings names
  // what was held back. "N issues found" on its own explains neither.
  const v = computeGateVerdict(scanResult, mode);
  if (v.state === 'failure') {
    const scope = v.attributed ? ' in this change' : '';
    const held = v.blockingPreExisting > 0 ? ` · ${v.blockingPreExisting} pre-existing not enforced` : '';
    return `${v.blockingInChange} blocking finding${v.blockingInChange === 1 ? '' : 's'}${scope} (${totalIssues} total)${held}`.slice(0, 140);
  }
  if (v.enforced && v.blocking > 0) {
    return `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found — ${v.blocking} blocking, all pre-existing, not enforced on this change`.slice(0, 140);
  }
  return `${totalIssues} issue${totalIssues === 1 ? '' : 's'} found across ${moduleCount} module${moduleCount === 1 ? '' : 's'}${suffix}`.slice(0, 140);
}

/**
 * Fetch `.gatetest.json` from the repo's default branch to read the
 * customer-configured mode. Fail-open: missing file, parse error, or
 * API error all return 'advisory' (the soft-landing default).
 *
 * Admin detection (three signals, any one is sufficient — mirrors the
 * pre-push hook logic in integrations/husky/pre-push):
 *   1. GATETEST_ADMIN_ORGS env var — comma-separated list of GitHub
 *      org/user names that own Craig's platforms (e.g. "vapron-ai,
 *      Gate-Test,ccantynz-alt"). Checked before any API call.
 *   2. .gatetest.json has "admin": true
 *   3. .gatetest.json has "owner": "crclabs-hq"
 *
 * Admin repos get 'admin' mode: the gate runs strict (errors → failure)
 * but without any advisory-mode messaging or upgrade prompts.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 * @param {typeof fetch} [fetchImpl]
 * @param {Record<string, string|undefined>} [env]
 * @returns {Promise<'advisory'|'strict'|'admin'>}
 */
async function fetchRepoMode(owner, repo, token, fetchImpl = fetch, env = process.env) {
  // Signal 1: env-var allowlist — no API call needed for known admin orgs.
  const adminOrgs = String((env && env.GATETEST_ADMIN_ORGS) || '').split(',').map(s => s.trim()).filter(Boolean);
  if (adminOrgs.includes(owner)) return 'admin';

  try {
    const res = await fetchImpl(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.gatetest.json`,
      {
        signal: fetchTimeoutSignal(),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': USER_AGENT,
        },
      },
    );
    if (!res.ok) return 'advisory';
    const payload = await res.json();
    if (!payload || typeof payload.content !== 'string') return 'advisory';
    const raw = Buffer.from(payload.content, payload.encoding || 'base64').toString('utf-8');
    const cfg = JSON.parse(raw);
    if (!cfg) return 'advisory';
    // Signals 2 & 3: .gatetest.json admin fields (mirrors pre-push hook)
    if (cfg.admin === true || cfg.owner === 'crclabs-hq') return 'admin';
    return cfg.mode === 'strict' ? 'strict' : 'advisory';
  } catch {
    return 'advisory';
  }
}

/**
 * Linkify "path/to/file.ext:42" patterns in a detail string so each
 * finding is one click from the offending line in the GitHub UI.
 *
 * Matches the longest leading `relpath:line` token (no spaces, has a
 * known source extension or path separator), turns it into
 *   [`relpath:line`](https://github.com/owner/repo/blob/sha/relpath#L42)
 * and leaves the rest of the detail string as-is.
 *
 * @param {string} detail
 * @param {string} owner
 * @param {string} repo
 * @param {string} sha
 * @returns {string} markdown
 */
function linkifyFinding(detail, owner, repo, sha) {
  // Pattern: optional leading whitespace, then a path-like token
  // (letters/digits/underscores/dots/slashes/hyphens) ending in .ext,
  // followed by :line[:col]. Captures: path, line.
  const m = String(detail).match(
    /(^|[\s(])([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?\b/,
  );
  if (!m || !owner || !repo || !sha) return detail;
  const [matchedStr, lead, filePath, lineNum] = m;
  const url = `https://github.com/${owner}/${repo}/blob/${sha}/${filePath}#L${lineNum}`;
  const link = `[\`${filePath}:${lineNum}\`](${url})`;
  return detail.replace(matchedStr, `${lead}${link}`);
}

/**
 * Build a markdown PR comment body from a scan result.
 * @param {string} repository  "owner/name"
 * @param {string} sha
 * @param {object} scanResult
 * @param {string|null} [targetUrl]
 * @returns {string}
 */
/** Hard budget for the ranked "What matters" list — 5 inline items, never a wall. */
const PR_COMMENT_TOP_FINDINGS = 5;

function buildMarkdownComment(repository, sha, scanResult, targetUrl, mode = 'advisory') {
  const ownerRepoParts = String(repository || '').split('/');
  const owner = ownerRepoParts[0] || '';
  const repoName = ownerRepoParts[1] || '';
  const verdict = computeGateVerdict(scanResult, mode);
  const state = verdict.state;
  const totalIssues = typeof (scanResult && scanResult.totalIssues) === 'number' ? scanResult.totalIssues : 0;
  // Advisory mode with findings: surface them in the comment body, but
  // ICON stays neutral and headline calls it out as advisory.
  const advisoryWithFindings = mode === 'advisory' && totalIssues > 0 && state === 'success';
  // Enforcing mode, findings present, but none of them blocking in THIS
  // change — the tick is green and the headline must say why, or the
  // reader assumes the scanner missed what it actually held back.
  const heldBack = verdict.enforced && state === 'success' && totalIssues > 0;
  const icon = state === 'error' ? '⚠️' : advisoryWithFindings ? '🟡' : state === 'failure' ? '❌' : '✅';
  const headline = state === 'error'
    ? 'Scan error'
    : advisoryWithFindings
      ? `${totalIssues} finding${totalIssues === 1 ? '' : 's'} (advisory)`
      : state === 'failure'
        ? `${verdict.blockingInChange} blocking finding${verdict.blockingInChange === 1 ? '' : 's'}${verdict.attributed ? ' in this change' : ''}`
        : heldBack
          ? `Passed — ${totalIssues} finding${totalIssues === 1 ? '' : 's'}, none blocking${verdict.attributed ? ' in this change' : ''}`
          : 'All checks passed';
  const shortSha = sha ? sha.slice(0, 7) : '???????';

  const lines = [
    `## ${icon} GateTest — ${headline}`,
    '',
    `**Commit:** \`${shortSha}\` · **Repo:** \`${repository}\``,
    '',
  ];

  if (scanResult && scanResult.error) {
    lines.push(`**Error:** ${String(scanResult.error).slice(0, 300)}`);
  } else {
    const modules = Array.isArray(scanResult && scanResult.modules) ? scanResult.modules : [];
    const totalIssues = typeof (scanResult && scanResult.totalIssues) === 'number' ? scanResult.totalIssues : 0;
    const durationSec = typeof (scanResult && scanResult.duration) === 'number'
      ? (scanResult.duration / 1000).toFixed(1)
      : '?';

    lines.push(`**${modules.length} modules** scanned in **${durationSec}s** — **${totalIssues} issue${totalIssues === 1 ? '' : 's'}** found`);
    lines.push('');

    // Modules with issues first, then passed modules (collapsed).
    const failed = modules.filter((m) => m.issues > 0 || m.status === 'failed');
    const passed = modules.filter((m) => m.issues === 0 && m.status !== 'failed');

    // "What matters" — the ranked, cross-module-deduped registry view when
    // the engine produced one. A hard BUDGET of PR_COMMENT_TOP_FINDINGS
    // findings, blocking first, then severity, then confidence; everything
    // else lives in the collapsed per-module section. This is the direct
    // answer to the loudest complaint about every review bot: walls of
    // noise with the one thing that matters buried in the middle.
    let ranked = Array.isArray(scanResult.findings) ? scanResult.findings.filter((f) => f && !f.duplicateOf) : [];
    const fsum = scanResult.findingSummary || null;
    // Attribution: when the scan knew the base commit, findings carry
    // `inDiff` (on a line this change inserted or modified) and
    // `inChangedFile` (the file moved, the line did not). Findings on lines
    // THIS change touched come first (that is what a reviewer is here for),
    // then old findings in touched files, then the rest; pre-existing ones
    // are counted, not hidden — old code counted as new is the SonarQube
    // complaint that has been open since 2023, and the answer is to say
    // which is which.
    const attributed = typeof scanResult.changedFiles === 'number' && ranked.some((f) => typeof f.inDiff === 'boolean');
    let preExisting = 0;
    if (attributed) {
      preExisting = ranked.filter((f) => !f.inDiff).length;
      const rank = (f) => (f.inDiff ? 0 : f.inChangedFile ? 1 : 2);
      ranked = ranked.map((f, i) => [f, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([f]) => f);
    }
    if (ranked.length > 0) {
      const top = ranked.slice(0, PR_COMMENT_TOP_FINDINGS);
      const inDiffCount = attributed ? ranked.length - preExisting : null;
      lines.push(attributed
        ? `### What matters — ${inDiffCount} in this change, ${preExisting} pre-existing (${Math.min(top.length, ranked.length)} of ${ranked.length} shown, ranked)`
        : `### What matters (${Math.min(top.length, ranked.length)} of ${ranked.length}, ranked)`);
      lines.push('');
      for (const f of top) {
        const sev = f.blocking ? '🔴' : f.severity === 'error' ? '🟠' : f.severity === 'warning' ? '🟡' : '🔵';
        const where = f.file ? linkifyFinding(`${f.file}${f.line ? `:${f.line}` : ''}`, owner, repoName, sha) : '';
        const conf = typeof f.confidence === 'number' && f.confidence < 1 ? ` · confidence ${Math.round(f.confidence * 100)}%` : '';
        const tag = attributed
          ? (f.inDiff ? ' `in this change`' : f.inChangedFile ? ' `pre-existing, in a changed file`' : ' `pre-existing`')
          : '';
        lines.push(`- ${sev} **${f.rule || f.module}**${tag} ${where ? `${where} — ` : ''}${String(f.message || '').slice(0, 200)}${conf}`);
        // Evidence-attached (advancement #5): the verified quote, so an
        // AI finding is never taken on faith. One line, hard-truncated.
        if (f.evidence) {
          const quote = String(f.evidence).replace(/\s+/g, ' ').trim().slice(0, 120);
          lines.push(`  <sub>evidence: \`${quote.replace(/`/g, "'")}\`</sub>`);
        }
      }
      if (ranked.length > top.length) {
        lines.push(`- *…${ranked.length - top.length} more, by module below*`);
      }
      const notes = [];
      if (fsum && fsum.duplicatesCollapsed > 0) notes.push(`${fsum.duplicatesCollapsed} duplicate report${fsum.duplicatesCollapsed === 1 ? '' : 's'} folded (the same line flagged by more than one module counts once)`);
      if (fsum && fsum.hiddenLowConfidence > 0) notes.push(`${fsum.hiddenLowConfidence} low-confidence error${fsum.hiddenLowConfidence === 1 ? '' : 's'} held back from blocking (shown, not enforced)`);
      if (verdict.blockingPreExisting > 0) notes.push(`${verdict.blockingPreExisting} blocking finding${verdict.blockingPreExisting === 1 ? '' : 's'} pre-date this change and ${verdict.blockingPreExisting === 1 ? 'is' : 'are'} not enforced on it — only code this change touched can fail the check`);
      if (verdict.source === 'registry' && !verdict.attributed && verdict.blocking > 0) notes.push('base commit unknown, so the whole repository was enforced rather than just this change');
      // Suppression in place (advancement #13): the dismissal affordance
      // lives where the reviewer already is.
      notes.push('disagree with a finding? reply `@gatetest ignore <module:rule>` — it lands in `.gatetestignore` on this branch and tunes GateTest\'s precision');
      if (notes.length) { lines.push(''); lines.push(`<sub>${notes.join(' · ')}</sub>`); }
      lines.push('');
    }

    if (failed.length > 0 && ranked.length > 0) {
      lines.push('<details><summary>All findings by module</summary>');
      lines.push('');
    }
    if (failed.length > 0) {
      lines.push('### Issues by module');
      lines.push('');
      for (const mod of failed.slice(0, 15)) {
        const modIssues = typeof mod.issues === 'number' ? mod.issues : '?';
        lines.push(`**\`${mod.name}\`** — ${modIssues} issue${modIssues === 1 ? '' : 's'}`);
        const details = Array.isArray(mod.details) ? mod.details : [];
        for (const d of details.slice(0, 3)) {
          // Linkify any leading "path:line" so the reader can click
          // straight to the offending line in the GitHub diff view.
          const linkified = linkifyFinding(String(d).slice(0, 240), owner, repoName, sha);
          lines.push(`  - ${linkified}`);
        }
        if (details.length > 3) {
          lines.push(`  - *…and ${details.length - 3} more*`);
        }
      }
      if (failed.length > 15) {
        lines.push('');
        lines.push(`*…and ${failed.length - 15} more modules with issues*`);
      }
      if (ranked.length > 0) {
        lines.push('');
        lines.push('</details>');
      }
    }

    if (passed.length > 0) {
      lines.push('');
      lines.push(`<details><summary>✅ ${passed.length} module${passed.length === 1 ? '' : 's'} passed</summary>`);
      lines.push('');
      lines.push(passed.map((m) => `\`${m.name}\``).join(', '));
      lines.push('');
      lines.push('</details>');
    }
  }

  if (targetUrl) {
    lines.push('');
    lines.push(`[View full report](${targetUrl})`);
  }

  // Auto-fix CTA — only on gate failure, only when scanResult doesn't
  // report a fix PR was already opened. Tells the customer how to flip
  // auto-repair on without leaving the PR. Composite-action customers
  // who already set ANTHROPIC_API_KEY have nothing to do — their auto-fix
  // job runs server-side and posts its own annotation; the website-side
  // callback can't see that state, so we keep the CTA short and honest.
  if (mode === 'advisory' && totalIssues > 0) {
    lines.push('');
    lines.push('<details><summary>Why is this not red?</summary>');
    lines.push('');
    lines.push('GateTest is in **advisory mode** for this repo (the soft-landing default for fresh installs). Findings are reported but the check stays green so a mature codebase can adopt the gate without spamming every PR on day one.');
    lines.push('');
    lines.push('When you\'re ready for the gate to block on error-severity findings, edit `.gatetest.json`:');
    lines.push('');
    lines.push('```json');
    lines.push('{ "mode": "strict" }');
    lines.push('```');
    lines.push('');
    lines.push('</details>');
  }

  if (toCommitState(scanResult, mode) === 'failure' && !scanResult?.autoFixPrUrl) {
    lines.push('');
    lines.push('<details><summary>Want these fixed automatically?</summary>');
    lines.push('');
    lines.push('Add `ANTHROPIC_API_KEY` as a repository or organisation secret. GateTest will diagnose every finding with Claude, write the fix, generate a regression test, and open a follow-up PR — all before you next refresh.');
    lines.push('');
    lines.push('1. Repo Settings → Secrets and variables → Actions → New repository secret');
    lines.push('2. Name: `ANTHROPIC_API_KEY` (get one at https://console.anthropic.com)');
    lines.push('3. Push again. The auto-fix PR opens within the same CI run.');
    lines.push('');
    lines.push('</details>');
  } else if (scanResult?.autoFixPrUrl) {
    lines.push('');
    lines.push(`🤖 **Auto-fix PR opened:** ${scanResult.autoFixPrUrl}`);
  }

  lines.push('');
  lines.push('---');
  // Feedback affordance (launch checklist §4): the earliest users tell us
  // what is wrong exactly here, in the PR, or not at all. One line, two
  // channels — the in-thread suppression command for "this finding is
  // noise", email for everything else.
  lines.push(`*Posted by [GateTest](${siteUrl()}) — unified code quality · wrong or unhelpful result? reply \`@gatetest ignore <module:rule>\` or tell us: ${SUPPORT_EMAIL}*`);
  // Idempotency marker — postPrComment looks for this string to find a
  // prior bot comment and PATCH it in place instead of stacking duplicates
  // on every push (Known Issue #23). Hidden HTML comment, customer-invisible.
  lines.push('');
  lines.push(GATETEST_PR_COMMENT_MARKER);

  return lines.join('\n');
}

/**
 * POST a commit status to GitHub.
 * @returns {Promise<{ok: boolean, status?: number, reason?: string}>}
 */
async function postCommitStatus({ owner, repo, sha, state, description, targetUrl, token, fetchImpl }) {
  const body = JSON.stringify({
    state,
    description: description.slice(0, 140),
    context: STATUS_CONTEXT,
    ...(targetUrl ? { target_url: targetUrl } : {}),
  });

  try {
    const res = await fetchImpl(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
      signal: fetchTimeoutSignal(),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body,
    });
    if (res.status !== 201) {
      console.error(`[github-callback] setCommitStatus non-201: ${res.status} for ${owner}/${repo}@${sha.slice(0, 7)}`);
      return { ok: false, status: res.status, reason: 'non-201' };
    }
    return { ok: true, status: 201 };
  } catch (err) {
    console.error('[github-callback] setCommitStatus fetch error:', err && err.message ? err.message : err);
    return { ok: false, reason: 'fetch-error' };
  }
}

// Signature marker placed in every GateTest PR comment. Used to find a
// prior comment via list-then-PATCH so busy PRs don't accumulate
// duplicate bot comments on every push (Known Issue #23). Mirrors
// src/core/host-bridge.js GATETEST_PR_COMMENT_MARKER — duplicated here
// because the website worker doesn't import src/* (lives in a different
// runtime). Keep in sync if either side changes.
const GATETEST_PR_COMMENT_MARKER = '<!-- gatetest-bot:gate-summary:v1 -->';

/**
 * POST a PR comment to GitHub.
 *
 * Idempotency (Manifest #20 / Known Issue #23): if `idempotencyTag` is
 * supplied, the function first lists existing PR comments and looks for
 * a marker `<!-- gatetest-tag:<tag> -->` in the body. If found, that
 * comment is PATCHed in place instead of a new comment being POSTed.
 * Without the tag, falls back to the original POST-only behaviour for
 * backward compat with callers that haven't opted in yet.
 *
 * Why: HN users repeatedly cite "noisy PRs full of identical bot
 * comments" as the #1 reason they uninstall a GitHub App. One comment
 * per scan-shape per PR — the customer always sees the latest result.
 *
 * @returns {Promise<{ok: boolean, status?: number, reason?: string, mode?: 'created'|'updated'}>}
 */
async function postPrComment({ owner, repo, prNumber, body, token, fetchImpl, idempotencyTag }) {
  // Two ways to trigger idempotent find-then-PATCH-or-POST:
  //   1. Pass `idempotencyTag` — function appends `<!-- gatetest-tag:<tag> -->`
  //      to the body and uses that as the search marker. Legacy path.
  //   2. Pass a body that already contains GATETEST_PR_COMMENT_MARKER —
  //      function uses the literal marker as the search key. Canonical
  //      path; buildMarkdownComment embeds the marker automatically.
  // Look-up failure NEVER blocks — we log and POST so the customer still
  // gets a comment.
  const tagMarker = idempotencyTag ? `<!-- gatetest-tag:${idempotencyTag} -->` : null;
  const taggedBody = idempotencyTag ? `${body}\n\n${tagMarker}\n` : body;
  const searchMarker = tagMarker
    || (typeof body === 'string' && body.includes(GATETEST_PR_COMMENT_MARKER) ? GATETEST_PR_COMMENT_MARKER : null);
  const isIdempotent = searchMarker !== null;
  const sendBody = idempotencyTag ? taggedBody : body;

  if (isIdempotent) {
    try {
      const existing = await findExistingComment({
        owner, repo, prNumber, token, fetchImpl, marker: searchMarker,
      });
      if (existing) {
        const updateRes = await fetchImpl(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${existing.id}`,
          {
            signal: fetchTimeoutSignal(),
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json',
              'User-Agent': USER_AGENT,
            },
            body: JSON.stringify({ body: sendBody }),
          },
        );
        if (updateRes.status !== 200) {
          console.error(`[github-callback] patchPrComment non-200: ${updateRes.status} for ${owner}/${repo}#${prNumber}`);
          return { ok: false, status: updateRes.status, reason: 'patch-non-200' };
        }
        return { ok: true, status: 200, action: 'updated' };
      }
    } catch (err) { // error-ok — log-and-continue is intentional; failure here must not block the caller
      // Look-up failure should NOT block the new-comment fallback — log
      // and fall through to POST so the customer still sees something.
      console.warn('[github-callback] idempotency lookup failed, falling back to POST:', err && err.message);
    }
  }

  try {
    const res = await fetchImpl(`${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      signal: fetchTimeoutSignal(),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ body: sendBody }),
    });
    if (res.status !== 201) {
      console.error(`[github-callback] addPrComment non-201: ${res.status} for ${owner}/${repo}#${prNumber}`);
      return { ok: false, status: res.status, reason: 'non-201' };
    }
    return { ok: true, status: 201, action: 'created' };
  } catch (err) {
    console.error('[github-callback] addPrComment fetch error:', err && err.message ? err.message : err);
    return { ok: false, reason: 'fetch-error' };
  }
}

/**
 * Find a previous bot comment with our marker. Walks paginated comments
 * (`per_page=100`) until it finds the tag or exhausts the list.
 *
 * @returns {Promise<{id: number, body: string} | null>}
 */
async function findExistingComment({ owner, repo, prNumber, token, fetchImpl, marker, tag }) {
  // `marker` is the literal HTML-comment marker to search for. Callers
  // that pass `tag` (legacy) get the marker built for them.
  const searchMarker = marker || `<!-- gatetest-tag:${tag} -->`;
  let page = 1;
  while (page <= 10) { // cap at 1000 comments to avoid runaway walking
    const res = await fetchImpl(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      {
        signal: fetchTimeoutSignal(),
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': USER_AGENT,
        },
      },
    );
    if (res.status !== 200) return null;
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) return null;
    for (const c of batch) {
      if (c && typeof c.body === 'string' && c.body.includes(searchMarker)) {
        return { id: c.id, body: c.body };
      }
    }
    if (batch.length < 100) return null;
    page += 1;
  }
  return null;
}

/**
 * Fire-and-forget GitHub feedback after a scan completes.
 * Posts a commit status and (when triggered by a PR) a formatted PR comment.
 * Never throws.
 *
 * @param {object} opts
 * @param {string} opts.repository         "owner/name"
 * @param {string} opts.sha                full 40-char commit SHA
 * @param {number|null} [opts.pullRequestNumber]
 * @param {object} opts.scanResult
 * @param {string} [opts.token]            explicit GitHub token (App installation
 *                                         token minted per-repo by the caller);
 *                                         takes precedence over env PATs
 * @param {string[]} [opts.dbAdminOrgs]    admin orgs pre-fetched from the platform registry DB
 * @param {typeof fetch} [opts.fetchImpl]  override for testing
 * @param {Record<string, string|undefined>} [opts.env]
 * @returns {Promise<{statusSent: boolean, commentSent: boolean, reason?: string}>}
 */
async function sendGithubCallback(opts) {
  const env = opts.env || process.env;

  // Merge DB-sourced admin orgs with env-var list so fetchRepoMode can see all of them.
  const dbOrgs = Array.isArray(opts.dbAdminOrgs) ? opts.dbAdminOrgs : [];
  const envOrgs = String(env.GATETEST_ADMIN_ORGS || '').split(',').map(s => s.trim()).filter(Boolean);
  const allAdminOrgs = [...new Set([...envOrgs, ...dbOrgs])];
  const mergedEnv = allAdminOrgs.length > 0
    ? { ...env, GATETEST_ADMIN_ORGS: allAdminOrgs.join(',') }
    : env;
  // Token precedence: an explicit token from the caller (a GitHub App
  // INSTALLATION token, minted per-repo in the TS layer that can reach
  // github-app.ts) wins over an env PAT. Without this, a customer who
  // installed the App but set no PAT got NO commit status at all — the
  // free-tier's core promise silently failed, and a Marketplace reviewer
  // installing on their own repo would see nothing post. (KI #29.)
  const token = opts.token || resolveGitHubToken(env);

  if (!token) {
    console.warn('[github-callback] no GitHub token configured (no App installation token and no PAT) — skipping feedback');
    return { statusSent: false, commentSent: false, reason: 'no-token' };
  }

  const { repository, sha, pullRequestNumber, scanResult } = opts;

  if (!repository || !sha) {
    return { statusSent: false, commentSent: false, reason: 'missing-repo-or-sha' };
  }

  const parts = repository.split('/');
  if (parts.length !== 2) {
    return { statusSent: false, commentSent: false, reason: 'invalid-repository' };
  }
  const [owner, repo] = parts;

  const doFetch = opts.fetchImpl || fetch;
  const baseUrl = resolveSiteUrl(env);
  const targetUrl = `${baseUrl}/scan/status`;

  // Read repo's gate mode. Fresh installs default to 'advisory' so a
  // mature codebase isn't spammed red on install day. Customer opts in
  // to 'strict' via .gatetest.json when ready.
  const mode = await fetchRepoMode(owner, repo, token, doFetch, mergedEnv);

  const state = toCommitState(scanResult, mode);
  const description = buildDescription(scanResult, mode);

  const statusResult = await postCommitStatus({
    owner, repo, sha, state, description, targetUrl, token, fetchImpl: doFetch,
  });

  let commentResult = { ok: false, reason: 'no-pr' };
  if (pullRequestNumber && typeof pullRequestNumber === 'number') {
    // buildMarkdownComment now also passes the mode through so the body
    // displays advisory headline/upgrade-note when appropriate. The body
    // includes GATETEST_PR_COMMENT_MARKER at the bottom which postPrComment
    // auto-detects to PATCH a prior bot comment instead of stacking.
    const body = buildMarkdownComment(repository, sha, scanResult, targetUrl, mode);
    commentResult = await postPrComment({
      owner, repo, prNumber: pullRequestNumber, body, token, fetchImpl: doFetch,
    });
  }

  return {
    statusSent: statusResult.ok,
    commentSent: commentResult.ok,
    ...(statusResult.reason ? { statusReason: statusResult.reason } : {}),
    ...(commentResult.reason ? { commentReason: commentResult.reason } : {}),
  };
}

module.exports = {
  resolveGitHubToken,
  toCommitState,
  buildDescription,
  buildMarkdownComment,
  linkifyFinding,
  fetchRepoMode,
  sendGithubCallback,
  // exposed for tests of the idempotent comment path
  postPrComment,
  findExistingComment,
  GATETEST_PR_COMMENT_MARKER,
  // exposed for the enqueue-time pending status (advancement #11)
  postCommitStatus,
};
