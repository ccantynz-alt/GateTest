/**
 * GateTest GitHub App — Core Authentication & Access Layer
 *
 * This is the engine that gives GateTest persistent access to repos (including private).
 * Once a user installs the GitHub App on their account/org, GateTest can:
 *   - Clone and read any installed repo
 *   - Set commit statuses (pass/fail)
 *   - Comment on PRs with scan results
 *   - React to push/PR webhooks automatically
 *
 * How GitHub Apps work (for context):
 *   1. App is registered once on github.com/settings/apps
 *   2. Users "install" the app on their account or org
 *   3. App authenticates with a private key (JWT → installation token)
 *   4. Installation tokens grant access to all repos the user approved
 *   5. Tokens auto-refresh — no manual re-auth ever needed
 *
 * This module handles:
 *   - App manifest generation (one-click app creation)
 *   - JWT creation for app-level auth
 *   - Installation token management (with caching)
 *   - Repo access (list repos, clone, read files via API)
 *   - Installation tracking (which users/orgs installed the app)
 *
 * Env vars:
 *   GATETEST_APP_ID            — GitHub App ID
 *   GATETEST_PRIVATE_KEY       — PEM file contents
 *   GATETEST_WEBHOOK_SECRET    — Webhook signing secret
 *   GATETEST_APP_SLUG          — App URL slug (e.g. "gatetest-qa")
 *   GATETEST_APP_URL           — Public URL (e.g. https://gatetest.io)
 *   GITHUB_CLIENT_ID           — OAuth client ID (from GitHub App settings)
 *   GITHUB_CLIENT_SECRET       — OAuth client secret
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── App Manifest ──────────────────────────────────────────
// GitHub's "App Manifest" flow lets you create a GitHub App
// programmatically. User clicks one link → GitHub creates the
// app with all the right permissions → redirects back with creds.

function generateAppManifest(options = {}) {
  const appUrl = options.appUrl || process.env.GATETEST_APP_URL || 'https://gatetest.io';

  return {
    name: options.name || 'GateTest',
    url: appUrl,
    hook_attributes: {
      url: `${appUrl}/api/webhook`,
      active: true,
    },
    redirect_url: `${appUrl}/api/github/callback`,
    setup_url: `${appUrl}/api/github/setup`,
    callback_urls: [`${appUrl}/api/github/callback`],
    setup_on_update: true,
    public: true,
    default_permissions: {
      contents: 'read',
      metadata: 'read',
      commit_statuses: 'write',
      pull_requests: 'write',
      issues: 'write',
      checks: 'write',
    },
    default_events: [
      'push',
      'pull_request',
      'installation',
      'installation_repositories',
      'check_suite',
    ],
  };
}

// ─── JWT Authentication ────────────────────────────────────

function base64url(data) {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createAppJWT(appId, privateKey) {
  const id = appId || process.env.GATETEST_APP_ID;
  const key = privateKey || getPrivateKey();

  if (!id) throw new Error('GATETEST_APP_ID not set');
  if (!key) throw new Error('GATETEST_PRIVATE_KEY not set');

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iat: now - 60,
    exp: now + (10 * 60),
    iss: id,
  }));

  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${base64url(signature)}`;
}

function getPrivateKey() {
  const key = process.env.GATETEST_PRIVATE_KEY || '';
  if (key.includes('BEGIN')) return key;
  // Handle escaped newlines (common in Vercel/Railway env vars)
  if (key.includes('\\n')) return key.replace(/\\n/g, '\n');
  return key || null;
}

// ─── Installation Token Manager ────────────────────────────
// Installation tokens expire after 1 hour. We cache them and
// refresh 5 minutes before expiry.

class TokenCache {
  constructor() {
    this.tokens = new Map(); // installationId → { token, expiresAt }
  }

  get(installationId) {
    const entry = this.tokens.get(installationId);
    if (!entry) return null;
    // Refresh 5 minutes before expiry
    if (Date.now() > entry.expiresAt - 300000) return null;
    return entry.token;
  }

  set(installationId, token, expiresAt) {
    this.tokens.set(installationId, {
      token,
      expiresAt: new Date(expiresAt).getTime(),
    });
  }
}

const tokenCache = new TokenCache();

async function getInstallationToken(installationId) {
  // Check cache first
  const cached = tokenCache.get(installationId);
  if (cached) return cached;

  const jwt = createAppJWT();
  const result = await githubApiRequest(
    'POST',
    `/app/installations/${installationId}/access_tokens`,
    jwt
  );

  if (!result.token) {
    throw new Error(`Failed to get installation token: ${JSON.stringify(result)}`);
  }

  tokenCache.set(installationId, result.token, result.expires_at);
  return result.token;
}

// ─── GitHub API ────────────────────────────────────────────

function githubApiRequest(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'User-Agent': 'GateTest-App/1.0.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try {
          const data = JSON.parse(raw);
          data._statusCode = res.statusCode;
          resolve(data);
        } catch {
          resolve({ raw, _statusCode: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('GitHub API timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── OAuth Flow ────────────────────────────────────────────
// After user installs the app, GitHub redirects with a code.
// We exchange it for user identity info.

async function exchangeCodeForToken(code) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set');
  }

  const result = await new Promise((resolve, reject) => {
    const body = JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    });

    const req = https.request({
      hostname: 'github.com',
      path: '/login/oauth/access_token',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'GateTest-App/1.0.0',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('OAuth token exchange failed')); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return result;
}

async function getAuthenticatedUser(accessToken) {
  return githubApiRequest('GET', '/user', accessToken);
}

// ─── Repo Access ───────────────────────────────────────────

/**
 * List all installations of this app (admin view).
 */
async function listInstallations() {
  const jwt = createAppJWT();
  return githubApiRequest('GET', '/app/installations?per_page=100', jwt);
}

/**
 * List repos accessible to a specific installation.
 */
async function listInstallationRepos(installationId) {
  const token = await getInstallationToken(installationId);
  return githubApiRequest('GET', '/installation/repositories?per_page=100', token);
}

/**
 * Read a file from a repo via the API (no clone needed).
 */
async function readRepoFile(installationId, owner, repo, filePath, ref) {
  const token = await getInstallationToken(installationId);
  const encodedPath = encodeURIComponent(filePath).replace(/%2F/g, '/');
  const url = `/repos/${owner}/${repo}/contents/${encodedPath}${ref ? `?ref=${ref}` : ''}`;
  const result = await githubApiRequest('GET', url, token);

  if (result.content && result.encoding === 'base64') {
    return {
      content: Buffer.from(result.content, 'base64').toString('utf-8'),
      sha: result.sha,
      size: result.size,
      path: result.path,
    };
  }

  return result;
}

/**
 * Get the repo file tree (for scanning without cloning).
 */
async function getRepoTree(installationId, owner, repo, ref) {
  const token = await getInstallationToken(installationId);
  const branch = ref || 'HEAD';
  return githubApiRequest('GET', `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
}

/**
 * Set a commit status on a repo.
 */
async function setCommitStatus(installationId, owner, repo, sha, state, description) {
  const token = await getInstallationToken(installationId);
  return githubApiRequest('POST', `/repos/${owner}/${repo}/statuses/${sha}`, token, {
    state, // pending | success | failure | error
    context: 'GateTest',
    description: description.slice(0, 140),
    target_url: process.env.GATETEST_APP_URL || 'https://gatetest.io',
  });
}

/**
 * Post a comment on a PR.
 */
async function commentOnPR(installationId, owner, repo, prNumber, body) {
  const token = await getInstallationToken(installationId);
  return githubApiRequest('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, token, {
    body,
  });
}

/**
 * Get repo metadata.
 */
async function getRepo(installationId, owner, repo) {
  const token = await getInstallationToken(installationId);
  return githubApiRequest('GET', `/repos/${owner}/${repo}`, token);
}

// ─── Installation Tracking ─────────────────────────────────

class InstallationStore {
  constructor(storagePath) {
    this.storagePath = storagePath || path.join(process.cwd(), '.gatetest', 'installations.json');
    this.installations = this._load();
  }

  add(installation) {
    this.installations.set(String(installation.id), {
      id: installation.id,
      account: installation.account?.login || 'unknown',
      accountType: installation.account?.type || 'User', // User or Organization
      appId: installation.app_id,
      targetType: installation.target_type,
      permissions: installation.permissions,
      events: installation.events,
      repositorySelection: installation.repository_selection, // all or selected
      createdAt: installation.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this._save();
  }

  remove(installationId) {
    this.installations.delete(String(installationId));
    this._save();
  }

  get(installationId) {
    return this.installations.get(String(installationId));
  }

  list() {
    return Array.from(this.installations.values());
  }

  findByAccount(login) {
    return this.list().find(i => i.account === login);
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        return new Map(Object.entries(data));
      }
    } catch { /* start fresh */ }
    return new Map();
  }

  _save() {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(this.installations);
    fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2));
  }
}

// ─── Webhook Signature Verification ────────────────────────

function verifyWebhookSignature(payload, signature, secret) {
  const webhookSecret = secret || process.env.GATETEST_WEBHOOK_SECRET;
  if (!webhookSecret) return true; // Skip if not configured
  if (!signature) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// ─── Webhook Event Processing ──────────────────────────────

function processWebhookEvent(eventType, event, store) {
  switch (eventType) {
    case 'installation': {
      const action = event.action;
      if (action === 'created') {
        store.add(event.installation);
        return {
          action: 'app_installed',
          account: event.installation.account?.login,
          repos: event.repositories?.map(r => r.full_name) || [],
        };
      }
      if (action === 'deleted') {
        store.remove(event.installation.id);
        return {
          action: 'app_uninstalled',
          account: event.installation.account?.login,
        };
      }
      return { action: `installation_${action}` };
    }

    case 'installation_repositories': {
      return {
        action: event.action === 'added' ? 'repos_added' : 'repos_removed',
        account: event.installation.account?.login,
        added: event.repositories_added?.map(r => r.full_name) || [],
        removed: event.repositories_removed?.map(r => r.full_name) || [],
      };
    }

    case 'push':
      return {
        action: 'push',
        repo: event.repository?.full_name,
        branch: (event.ref || '').replace('refs/heads/', ''),
        sha: event.after,
        installationId: event.installation?.id,
      };

    case 'pull_request':
      return {
        action: `pr_${event.action}`,
        repo: event.repository?.full_name,
        pr: event.pull_request?.number,
        sha: event.pull_request?.head?.sha,
        branch: event.pull_request?.head?.ref,
        installationId: event.installation?.id,
      };

    default:
      return { action: `unknown_${eventType}` };
  }
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  // App setup
  generateAppManifest,
  createAppJWT,
  getPrivateKey,

  // Token management
  TokenCache,
  getInstallationToken,

  // API helpers
  githubApiRequest,

  // OAuth
  exchangeCodeForToken,
  getAuthenticatedUser,

  // Repo access
  listInstallations,
  listInstallationRepos,
  readRepoFile,
  getRepoTree,
  setCommitStatus,
  commentOnPR,
  getRepo,

  // Installation tracking
  InstallationStore,

  // Webhooks
  verifyWebhookSignature,
  processWebhookEvent,
};
