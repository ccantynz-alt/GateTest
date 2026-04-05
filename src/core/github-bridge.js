/**
 * GateTest GitHub Bridge - Integration layer between GateTest and GitHub.
 * Merges GateCode authorization with GateTest quality gates.
 * Uses Node.js built-in https module — no external dependencies.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const GITHUB_API_HOST = 'api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'GateTest/1.0.0';

/**
 * Resolves the GitHub token from environment or config file.
 * Priority: env GATETEST_GITHUB_TOKEN > .gatetest/config.json > GITHUB_TOKEN env
 */
function resolveToken(projectRoot) {
  if (process.env.GATETEST_GITHUB_TOKEN) {
    return process.env.GATETEST_GITHUB_TOKEN;
  }

  const configPath = path.join(projectRoot || process.cwd(), '.gatetest', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (config.github && config.github.token) {
        return config.github.token;
      }
    } catch (_) {
      // Fall through to next resolution strategy.
    }
  }

  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  return null;
}

/**
 * Low-level HTTPS request against the GitHub REST API v3.
 * Returns a promise that resolves with { statusCode, headers, data }.
 */
function apiRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: GITHUB_API_HOST,
      port: 443,
      path: urlPath,
      method,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    let payload = null;
    if (body !== undefined && body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data = raw;
        try {
          data = JSON.parse(raw);
        } catch (_) {
          // Response may not be JSON (e.g. 204 No Content).
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });

    req.on('error', (err) => reject(new Error(`GitHub API request failed: ${err.message}`)));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error(`GitHub API request timed out: ${method} ${urlPath}`));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}


class GitHubBridge {
  /**
   * @param {object} options
   * @param {string} [options.token] - GitHub token (PAT or GitHub App installation token).
   * @param {string} [options.projectRoot] - Project root for config file resolution.
   */
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.token = options.token || resolveToken(this.projectRoot);
  }

  // ---------------------------------------------------------------------------
  // Authentication helpers
  // ---------------------------------------------------------------------------

  /**
   * Verify the current token is valid by calling /user (PAT) or /app (App token).
   * Returns the authenticated identity or throws on failure.
   */
  async verifyAuth() {
    if (!this.token) {
      throw new Error('[GateTest] No GitHub token configured. Set GATETEST_GITHUB_TOKEN or add github.token to .gatetest/config.json');
    }

    // Try /user first (works for PATs and OAuth tokens).
    const res = await this._api('GET', '/user');
    if (res.statusCode === 200) {
      return { type: 'user', login: res.data.login, id: res.data.id };
    }

    // Fall back to /app (works for GitHub App installation tokens).
    const appRes = await this._api('GET', '/app');
    if (appRes.statusCode === 200) {
      return { type: 'app', name: appRes.data.name, id: appRes.data.id };
    }

    throw new Error(`[GateTest] GitHub authentication failed (HTTP ${res.statusCode})`);
  }

  // ---------------------------------------------------------------------------
  // Repository operations
  // ---------------------------------------------------------------------------

  /**
   * Clone a repository into a local directory.
   * Uses git CLI to leverage credential helpers and SSH keys.
   */
  cloneRepo(owner, repo, destDir, options = {}) {
    const url = `https://github.com/${owner}/${repo}.git`;
    const args = ['clone'];

    if (options.depth) {
      args.push('--depth', String(options.depth));
    }
    if (options.branch) {
      args.push('--branch', options.branch);
    }

    args.push(url, destDir);

    return this._git(args, options.cwd || this.projectRoot);
  }

  /**
   * Pull latest changes for the current branch.
   */
  pull(repoDir, options = {}) {
    const args = ['pull'];
    if (options.rebase) {
      args.push('--rebase');
    }
    return this._git(args, repoDir);
  }

  /**
   * Push local commits to the remote.
   */
  push(repoDir, options = {}) {
    const args = ['push'];
    if (options.remote) {
      args.push(options.remote);
    }
    if (options.branch) {
      args.push(options.branch);
    }
    if (options.setUpstream) {
      args.splice(1, 0, '-u');
    }
    return this._git(args, repoDir);
  }

  /**
   * Create a new branch on the remote via the GitHub API.
   * Branches from the given base SHA.
   */
  async createBranch(owner, repo, branchName, baseSha) {
    const res = await this._api('POST', `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    if (res.statusCode !== 201) {
      throw this._apiError('createBranch', res);
    }
    return res.data;
  }

  /**
   * Get the default branch and its HEAD SHA for a repository.
   */
  async getDefaultBranch(owner, repo) {
    const res = await this._api('GET', `/repos/${owner}/${repo}`);
    if (res.statusCode !== 200) {
      throw this._apiError('getDefaultBranch', res);
    }
    const defaultBranch = res.data.default_branch;

    const refRes = await this._api('GET', `/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`);
    if (refRes.statusCode !== 200) {
      throw this._apiError('getDefaultBranch (ref)', refRes);
    }

    return {
      name: defaultBranch,
      sha: refRes.data.object.sha,
    };
  }

  // ---------------------------------------------------------------------------
  // Pull request operations
  // ---------------------------------------------------------------------------

  /**
   * Create a pull request.
   */
  async createPullRequest(owner, repo, options) {
    const body = {
      title: options.title,
      body: options.body || '',
      head: options.head,
      base: options.base,
    };
    if (options.draft !== undefined) {
      body.draft = options.draft;
    }

    const res = await this._api('POST', `/repos/${owner}/${repo}/pulls`, body);
    if (res.statusCode !== 201) {
      throw this._apiError('createPullRequest', res);
    }
    return res.data;
  }

  /**
   * Get a pull request by number.
   */
  async getPullRequest(owner, repo, prNumber) {
    const res = await this._api('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`);
    if (res.statusCode !== 200) {
      throw this._apiError('getPullRequest', res);
    }
    return res.data;
  }

  /**
   * Update a pull request (title, body, state, base).
   */
  async updatePullRequest(owner, repo, prNumber, updates) {
    const res = await this._api('PATCH', `/repos/${owner}/${repo}/pulls/${prNumber}`, updates);
    if (res.statusCode !== 200) {
      throw this._apiError('updatePullRequest', res);
    }
    return res.data;
  }

  /**
   * Add a comment to a pull request (or issue).
   */
  async addPrComment(owner, repo, prNumber, body) {
    const res = await this._api('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      body,
    });
    if (res.statusCode !== 201) {
      throw this._apiError('addPrComment', res);
    }
    return res.data;
  }

  /**
   * List comments on a pull request.
   */
  async listPrComments(owner, repo, prNumber, options = {}) {
    const perPage = options.perPage || 100;
    const page = options.page || 1;
    const res = await this._api(
      'GET',
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${perPage}&page=${page}`,
    );
    if (res.statusCode !== 200) {
      throw this._apiError('listPrComments', res);
    }
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Commit operations
  // ---------------------------------------------------------------------------

  /**
   * Create a commit via the Git Data API (tree + commit).
   * Useful for creating commits without a local clone.
   */
  async createCommit(owner, repo, options) {
    const commitBody = {
      message: options.message,
      tree: options.tree,
      parents: options.parents,
    };
    if (options.author) {
      commitBody.author = options.author;
    }

    const res = await this._api('POST', `/repos/${owner}/${repo}/git/commits`, commitBody);
    if (res.statusCode !== 201) {
      throw this._apiError('createCommit', res);
    }
    return res.data;
  }

  /**
   * Get a single commit by SHA.
   */
  async getCommit(owner, repo, sha) {
    const res = await this._api('GET', `/repos/${owner}/${repo}/commits/${sha}`);
    if (res.statusCode !== 200) {
      throw this._apiError('getCommit', res);
    }
    return res.data;
  }

  /**
   * List commits on a branch or path.
   */
  async listCommits(owner, repo, options = {}) {
    const params = new URLSearchParams();
    if (options.sha) params.set('sha', options.sha);
    if (options.path) params.set('path', options.path);
    if (options.since) params.set('since', options.since);
    if (options.until) params.set('until', options.until);
    params.set('per_page', String(options.perPage || 30));
    params.set('page', String(options.page || 1));

    const res = await this._api('GET', `/repos/${owner}/${repo}/commits?${params.toString()}`);
    if (res.statusCode !== 200) {
      throw this._apiError('listCommits', res);
    }
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Status checks
  // ---------------------------------------------------------------------------

  /**
   * Set a commit status (pending, success, failure, error).
   * This is the primary mechanism for reporting GateTest results back to GitHub.
   *
   * @param {string} owner - Repository owner.
   * @param {string} repo  - Repository name.
   * @param {string} sha   - Full commit SHA.
   * @param {'pending'|'success'|'failure'|'error'} state - Status state.
   * @param {string} description - Short description (max 140 chars).
   * @param {object} [options]
   * @param {string} [options.targetUrl] - URL to link from the status.
   * @param {string} [options.context]   - Status context name (default: 'gatetest').
   */
  async setCommitStatus(owner, repo, sha, state, description, options = {}) {
    const validStates = ['pending', 'success', 'failure', 'error'];
    if (!validStates.includes(state)) {
      throw new Error(`[GateTest] Invalid commit status state "${state}". Must be one of: ${validStates.join(', ')}`);
    }

    const body = {
      state,
      description: description.slice(0, 140),
      context: options.context || 'gatetest',
    };
    if (options.targetUrl) {
      body.target_url = options.targetUrl;
    }

    const res = await this._api('POST', `/repos/${owner}/${repo}/statuses/${sha}`, body);
    if (res.statusCode !== 201) {
      throw this._apiError('setCommitStatus', res);
    }
    return res.data;
  }

  /**
   * Get combined status for a ref (branch name, tag, or SHA).
   */
  async getCombinedStatus(owner, repo, ref) {
    const res = await this._api('GET', `/repos/${owner}/${repo}/commits/${ref}/status`);
    if (res.statusCode !== 200) {
      throw this._apiError('getCombinedStatus', res);
    }
    return res.data;
  }

  // ---------------------------------------------------------------------------
  // Webhook handling
  // ---------------------------------------------------------------------------

  /**
   * Create an HTTP server that listens for GitHub webhook events.
   * Returns the server instance (caller must call .listen()).
   *
   * @param {object} handlers - Map of event names to handler functions.
   *   e.g. { push: (payload) => {}, pull_request: (payload) => {} }
   * @param {object} [options]
   * @param {string} [options.secret] - Webhook secret for signature verification.
   */
  createWebhookServer(handlers, options = {}) {
    const http = require('http');
    const crypto = require('crypto');

    const server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks);
        const event = req.headers['x-github-event'];

        // Verify webhook signature if secret is configured.
        if (options.secret) {
          const signature = req.headers['x-hub-signature-256'];
          const expected = 'sha256=' + crypto
            .createHmac('sha256', options.secret)
            .update(rawBody)
            .digest('hex');

          if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Invalid signature');
            return;
          }
        }

        let payload;
        try {
          payload = JSON.parse(rawBody.toString('utf-8'));
        } catch (_) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid JSON');
          return;
        }

        const handler = handlers[event];
        if (handler) {
          // Fire-and-forget; handler errors are logged but don't break the webhook response.
          Promise.resolve(handler(payload, event)).catch((err) => {
            console.error(`[GateTest] Webhook handler error (${event}):`, err.message);
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, event }));
      });
    });

    return server;
  }

  // ---------------------------------------------------------------------------
  // Report posting
  // ---------------------------------------------------------------------------

  /**
   * Post a GateTest quality report as a formatted markdown comment on a PR.
   *
   * @param {string} owner     - Repository owner.
   * @param {string} repo      - Repository name.
   * @param {number} prNumber  - Pull request number.
   * @param {object} summary   - GateTest run summary.
   * @param {string}           summary.status       - 'passed' or 'failed'.
   * @param {number}           summary.totalChecks   - Total number of checks run.
   * @param {number}           summary.passed        - Number of checks that passed.
   * @param {number}           summary.failed        - Number of checks that failed.
   * @param {number}           summary.skipped       - Number of checks skipped.
   * @param {number}           summary.duration      - Total duration in ms.
   * @param {Array<object>}    summary.modules       - Per-module results.
   * @param {Array<object>}    [summary.failures]    - Detailed failure info.
   */
  async postGateResult(owner, repo, prNumber, summary) {
    const body = this._formatGateResultMarkdown(summary);
    return this.addPrComment(owner, repo, prNumber, body);
  }

  /**
   * Convenience method: set commit status AND post PR comment in one call.
   * Derives the commit status state from the summary.
   */
  async reportResults(owner, repo, prNumber, sha, summary) {
    const state = summary.status === 'passed' ? 'success' : 'failure';
    const description = summary.status === 'passed'
      ? `All ${summary.totalChecks} checks passed`
      : `${summary.failed} of ${summary.totalChecks} checks failed`;

    const [statusResult, commentResult] = await Promise.all([
      this.setCommitStatus(owner, repo, sha, state, description),
      this.postGateResult(owner, repo, prNumber, summary),
    ]);

    return { status: statusResult, comment: commentResult };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrapper around apiRequest that injects the instance token.
   */
  _api(method, urlPath, body) {
    return apiRequest(method, urlPath, this.token, body);
  }

  /**
   * Build a descriptive error from a failed API response.
   */
  _apiError(operation, res) {
    const msg = res.data && res.data.message ? res.data.message : JSON.stringify(res.data);
    return new Error(`[GateTest] ${operation} failed (HTTP ${res.statusCode}): ${msg}`);
  }

  /**
   * Run a git CLI command and return a promise with stdout.
   */
  _git(args, cwd) {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`[GateTest] git ${args[0]} failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  /**
   * Format a GateTest summary object into a markdown PR comment.
   */
  _formatGateResultMarkdown(summary) {
    const icon = summary.status === 'passed' ? ':white_check_mark:' : ':x:';
    const title = summary.status === 'passed'
      ? 'GateTest Quality Gate — PASSED'
      : 'GateTest Quality Gate — FAILED';

    const duration = summary.duration >= 1000
      ? `${(summary.duration / 1000).toFixed(1)}s`
      : `${summary.duration}ms`;

    const lines = [];
    lines.push(`## ${icon} ${title}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| **Total Checks** | ${summary.totalChecks} |`);
    lines.push(`| **Passed** | ${summary.passed} |`);
    lines.push(`| **Failed** | ${summary.failed} |`);
    lines.push(`| **Skipped** | ${summary.skipped} |`);
    lines.push(`| **Duration** | ${duration} |`);
    lines.push('');

    // Per-module breakdown.
    if (summary.modules && summary.modules.length > 0) {
      lines.push('### Module Results');
      lines.push('');
      lines.push('| Module | Status | Checks | Duration |');
      lines.push('|--------|--------|--------|----------|');
      for (const mod of summary.modules) {
        const modIcon = mod.status === 'passed' ? ':white_check_mark:'
          : mod.status === 'failed' ? ':x:'
          : ':fast_forward:';
        const modDuration = mod.duration >= 1000
          ? `${(mod.duration / 1000).toFixed(1)}s`
          : `${mod.duration}ms`;
        const checkCount = mod.checks !== undefined ? mod.checks : '-';
        lines.push(`| ${modIcon} ${mod.name} | ${mod.status} | ${checkCount} | ${modDuration} |`);
      }
      lines.push('');
    }

    // Failure details.
    if (summary.failures && summary.failures.length > 0) {
      lines.push('### Failures');
      lines.push('');
      for (const failure of summary.failures) {
        lines.push(`<details>`);
        lines.push(`<summary><b>${failure.module}</b>: ${failure.check}</summary>`);
        lines.push('');
        if (failure.expected !== undefined && failure.actual !== undefined) {
          lines.push(`- **Expected:** ${failure.expected}`);
          lines.push(`- **Actual:** ${failure.actual}`);
        }
        if (failure.file) {
          lines.push(`- **File:** \`${failure.file}\`${failure.line ? `:${failure.line}` : ''}`);
        }
        if (failure.message) {
          lines.push(`- **Details:** ${failure.message}`);
        }
        if (failure.suggestion) {
          lines.push(`- **Suggested fix:** ${failure.suggestion}`);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }

    lines.push('---');
    lines.push(`<sub>Generated by <b>GateTest v1.0.0</b> at ${new Date().toISOString()}</sub>`);

    return lines.join('\n');
  }
}

module.exports = { GitHubBridge, resolveToken, apiRequest };
