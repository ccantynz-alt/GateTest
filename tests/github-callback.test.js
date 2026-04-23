// =============================================================================
// GITHUB-CALLBACK TEST — website/app/lib/github-callback.js
// =============================================================================
// Covers: token resolution, commit-state mapping, description building,
// markdown formatting, postCommitStatus/postPrComment HTTP calls, and the
// full sendGithubCallback orchestration — all without real HTTP calls.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  resolveGitHubToken,
  toCommitState,
  buildDescription,
  buildMarkdownComment,
  sendGithubCallback,
} = require(path.resolve(__dirname, '..', 'website', 'app', 'lib', 'github-callback.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanResult(overrides = {}) {
  return {
    status: 'complete',
    totalIssues: 0,
    duration: 3200,
    modules: [
      { name: 'lint', status: 'passed', issues: 0, checks: [{ severity: 'info' }], details: [] },
      { name: 'secrets', status: 'passed', issues: 0, checks: [], details: [] },
    ],
    ...overrides,
  };
}

function makeFetch(statusCode = 201, body = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status: statusCode, ok: statusCode >= 200 && statusCode < 300, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

// ---------------------------------------------------------------------------
// resolveGitHubToken
// ---------------------------------------------------------------------------

describe('resolveGitHubToken', () => {
  it('prefers GATETEST_GITHUB_TOKEN over GITHUB_TOKEN', () => {
    const token = resolveGitHubToken({
      GATETEST_GITHUB_TOKEN: 'gat_primary',
      GITHUB_TOKEN: 'gh_fallback',
    });
    assert.strictEqual(token, 'gat_primary');
  });

  it('falls back to GITHUB_TOKEN when primary absent', () => {
    const token = resolveGitHubToken({ GITHUB_TOKEN: 'gh_fallback' });
    assert.strictEqual(token, 'gh_fallback');
  });

  it('returns null when neither token is set', () => {
    assert.strictEqual(resolveGitHubToken({}), null);
  });
});

// ---------------------------------------------------------------------------
// toCommitState
// ---------------------------------------------------------------------------

describe('toCommitState', () => {
  it('returns success for a clean scan', () => {
    assert.strictEqual(toCommitState(makeScanResult()), 'success');
  });

  it('returns failure when a module has error-severity checks', () => {
    const result = makeScanResult({
      totalIssues: 2,
      modules: [
        { name: 'lint', status: 'failed', issues: 2, checks: [{ severity: 'error' }], details: [] },
      ],
    });
    assert.strictEqual(toCommitState(result), 'failure');
  });

  it('returns success when issues are warnings only', () => {
    const result = makeScanResult({
      totalIssues: 1,
      modules: [
        { name: 'lint', status: 'passed', issues: 1, checks: [{ severity: 'warning' }], details: [] },
      ],
    });
    assert.strictEqual(toCommitState(result), 'success');
  });

  it('returns error for a crashed scan', () => {
    assert.strictEqual(toCommitState({ status: 'failed', error: 'timeout' }), 'error');
  });

  it('returns error for null', () => {
    assert.strictEqual(toCommitState(null), 'error');
  });
});

// ---------------------------------------------------------------------------
// buildDescription
// ---------------------------------------------------------------------------

describe('buildDescription', () => {
  it('produces a passing description for zero issues', () => {
    const desc = buildDescription(makeScanResult());
    assert.ok(desc.includes('passed'), `expected "passed" in: ${desc}`);
    assert.ok(desc.includes('0 issues'), `expected "0 issues" in: ${desc}`);
  });

  it('produces an issue-count description for failing scans', () => {
    const desc = buildDescription(makeScanResult({ totalIssues: 5, modules: Array(3).fill({ name: 'x', issues: 1, checks: [], details: [], status: 'failed' }) }));
    assert.ok(desc.includes('5 issues'), `expected "5 issues" in: ${desc}`);
    assert.ok(desc.includes('3 modules'), `expected "3 modules" in: ${desc}`);
  });

  it('never exceeds 140 chars', () => {
    const longError = 'E'.repeat(500);
    const desc = buildDescription({ status: 'failed', error: longError });
    assert.ok(desc.length <= 140, `description too long: ${desc.length}`);
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownComment
// ---------------------------------------------------------------------------

describe('buildMarkdownComment', () => {
  it('contains the short SHA and repo', () => {
    const md = buildMarkdownComment('owner/repo', 'abc1234def56789', makeScanResult(), null);
    assert.ok(md.includes('abc1234'), `expected short SHA in: ${md.slice(0, 200)}`);
    assert.ok(md.includes('owner/repo'), `expected repo in: ${md.slice(0, 200)}`);
  });

  it('shows passed modules in a collapsible section', () => {
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), makeScanResult(), null);
    assert.ok(md.includes('<details>'), `expected details tag in markdown`);
    assert.ok(md.includes('passed'), `expected "passed" in markdown`);
  });

  it('shows failing module details', () => {
    const result = makeScanResult({
      totalIssues: 1,
      modules: [{
        name: 'secrets',
        status: 'failed',
        issues: 1,
        checks: [{ severity: 'error' }],
        details: ['Found hardcoded API key at line 42'],
      }],
    });
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), result, null);
    assert.ok(md.includes('secrets'), `expected module name`);
    assert.ok(md.includes('line 42'), `expected detail text`);
  });

  it('includes a full-report link when targetUrl is provided', () => {
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), makeScanResult(), 'https://gatetest.ai/scan/status');
    assert.ok(md.includes('https://gatetest.ai/scan/status'), `expected targetUrl`);
  });

  it('shows error message for crashed scan', () => {
    const md = buildMarkdownComment('o/r', 'a'.repeat(40), { status: 'failed', error: 'scan timeout' }, null);
    assert.ok(md.includes('scan timeout'), `expected error message`);
  });
});

// ---------------------------------------------------------------------------
// sendGithubCallback
// ---------------------------------------------------------------------------

describe('sendGithubCallback — no token', () => {
  it('returns no-token reason when env has no GitHub token', async () => {
    const result = await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'a'.repeat(40),
      scanResult: makeScanResult(),
      env: {},
    });
    assert.strictEqual(result.statusSent, false);
    assert.strictEqual(result.reason, 'no-token');
  });
});

describe('sendGithubCallback — happy path (no PR)', () => {
  it('posts commit status and skips PR comment when no pullRequestNumber', async () => {
    const doFetch = makeFetch(201);
    const result = await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'a'.repeat(40),
      pullRequestNumber: null,
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    assert.strictEqual(result.statusSent, true);
    assert.strictEqual(result.commentSent, false);
    assert.strictEqual(doFetch.calls.length, 1, 'expected exactly one fetch call (status only)');
    assert.ok(doFetch.calls[0].url.includes('/statuses/'), `expected status URL, got ${doFetch.calls[0].url}`);
  });
});

describe('sendGithubCallback — happy path with PR', () => {
  it('posts commit status AND PR comment when pullRequestNumber is set', async () => {
    const doFetch = makeFetch(201);
    const result = await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'b'.repeat(40),
      pullRequestNumber: 42,
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    assert.strictEqual(result.statusSent, true);
    assert.strictEqual(result.commentSent, true);
    assert.strictEqual(doFetch.calls.length, 2, 'expected two fetch calls (status + comment)');
    assert.ok(doFetch.calls[0].url.includes('/statuses/'), `first call should be status`);
    assert.ok(doFetch.calls[1].url.includes('/issues/42/comments'), `second call should be comment`);
  });

  it('uses Authorization Bearer header with the resolved token', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'c'.repeat(40),
      pullRequestNumber: 7,
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_mytoken' },
      fetchImpl: doFetch,
    });
    for (const call of doFetch.calls) {
      const auth = call.init && call.init.headers && call.init.headers['Authorization'];
      assert.strictEqual(auth, 'Bearer ghp_mytoken', `expected Bearer token in ${call.url}`);
    }
  });
});

describe('sendGithubCallback — failure cases', () => {
  it('handles non-201 status response gracefully', async () => {
    const doFetch = makeFetch(422);
    const result = await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'd'.repeat(40),
      pullRequestNumber: null,
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    assert.strictEqual(result.statusSent, false);
    assert.strictEqual(result.commentSent, false);
  });

  it('handles fetch throwing without throwing itself', async () => {
    const doFetch = async () => { throw new Error('network error'); };
    const result = await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'e'.repeat(40),
      pullRequestNumber: null,
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    assert.strictEqual(result.statusSent, false);
  });

  it('handles invalid repository format gracefully', async () => {
    const result = await sendGithubCallback({
      repository: 'not-valid-no-slash',
      sha: 'f'.repeat(40),
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
    });
    assert.strictEqual(result.statusSent, false);
    assert.strictEqual(result.reason, 'invalid-repository');
  });

  it('maps scan error to "error" commit state', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'g'.repeat(40),
      scanResult: { status: 'failed', error: 'timeout' },
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    const body = JSON.parse(doFetch.calls[0].init.body);
    assert.strictEqual(body.state, 'error');
  });

  it('maps clean scan to "success" commit state', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'h'.repeat(40),
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    const body = JSON.parse(doFetch.calls[0].init.body);
    assert.strictEqual(body.state, 'success');
  });

  it('maps scan with error-severity issues to "failure" commit state', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'i'.repeat(40),
      scanResult: makeScanResult({
        totalIssues: 3,
        modules: [{ name: 'lint', status: 'failed', issues: 3, checks: [{ severity: 'error' }], details: [] }],
      }),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    const body = JSON.parse(doFetch.calls[0].init.body);
    assert.strictEqual(body.state, 'failure');
  });
});

describe('sendGithubCallback — commit status payload', () => {
  it('uses the correct status context name', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'j'.repeat(40),
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test' },
      fetchImpl: doFetch,
    });
    const body = JSON.parse(doFetch.calls[0].init.body);
    assert.strictEqual(body.context, 'gatetest / scan');
  });

  it('includes target_url in status payload', async () => {
    const doFetch = makeFetch(201);
    await sendGithubCallback({
      repository: 'owner/repo',
      sha: 'k'.repeat(40),
      scanResult: makeScanResult(),
      env: { GATETEST_GITHUB_TOKEN: 'ghp_test', NEXT_PUBLIC_BASE_URL: 'https://gatetest.ai' },
      fetchImpl: doFetch,
    });
    const body = JSON.parse(doFetch.calls[0].init.body);
    assert.ok(body.target_url, 'expected target_url in payload');
    assert.ok(body.target_url.startsWith('https://gatetest.ai'), `unexpected target_url: ${body.target_url}`);
  });
});
