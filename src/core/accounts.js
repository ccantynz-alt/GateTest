/**
 * GateTest Account System — User Management with Admin/User Roles
 *
 * Tiers:
 *   admin    — Full access, unmetered, all modules, all features
 *   pro      — All modules, 500 scans/month, priority support
 *   team     — All modules, 2000 scans/month, team management
 *   free     — Quick suite only, 30 scans/month
 *
 * Storage:
 *   - Local dev: .gatetest/account.json (API key + cached profile)
 *   - Server: API calls to GateTest cloud for verification
 *
 * Auth flow:
 *   1. User runs `gatetest auth login` → opens browser to gatetest.io/auth
 *   2. User signs in (GitHub OAuth or email)
 *   3. Callback sets API key locally
 *   4. Every scan verifies key + checks usage quota
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// ─── Tier Definitions ──────────────────────────────────────

const TIERS = {
  admin: {
    name: 'Admin',
    scansPerMonth: Infinity,
    suites: ['quick', 'standard', 'full', 'live', 'nuclear'],
    modules: 'all',
    features: ['session-ledger', 'continuous-scan', 'live-crawler', 'team-management', 'api-access', 'priority-support', 'custom-modules'],
    metered: false,
  },
  team: {
    name: 'Team',
    scansPerMonth: 2000,
    suites: ['quick', 'standard', 'full', 'live', 'nuclear'],
    modules: 'all',
    features: ['session-ledger', 'continuous-scan', 'live-crawler', 'team-management', 'api-access'],
    metered: true,
    stripePriceId: null, // Set at runtime from env
  },
  pro: {
    name: 'Pro',
    scansPerMonth: 500,
    suites: ['quick', 'standard', 'full', 'live'],
    modules: 'all',
    features: ['session-ledger', 'continuous-scan', 'live-crawler'],
    metered: true,
    stripePriceId: null,
  },
  free: {
    name: 'Free',
    scansPerMonth: 30,
    suites: ['quick'],
    modules: ['syntax', 'lint', 'secrets', 'codeQuality'],
    features: ['session-ledger'],
    metered: true,
  },
};

// ─── Account Manager ───────────────────────────────────────

class AccountManager {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.accountPath = path.join(projectRoot, '.gatetest', 'account.json');
    this.apiBase = options.apiBase || process.env.GATETEST_API_URL || 'https://api.gatetest.io';
    this._account = null;
  }

  /**
   * Get current account (from cache or API).
   */
  getAccount() {
    if (this._account) return this._account;
    this._account = this._loadLocal();
    return this._account;
  }

  /**
   * Get the tier definition for the current account.
   */
  getTier() {
    const account = this.getAccount();
    if (!account) return TIERS.free;
    return TIERS[account.tier] || TIERS.free;
  }

  /**
   * Check if the current account can run a specific suite.
   */
  canRunSuite(suiteName) {
    const tier = this.getTier();
    return tier.suites.includes(suiteName);
  }

  /**
   * Check if the current account can run a specific module.
   */
  canRunModule(moduleName) {
    const tier = this.getTier();
    if (tier.modules === 'all') return true;
    return tier.modules.includes(moduleName);
  }

  /**
   * Check if the account has a specific feature.
   */
  hasFeature(featureName) {
    const tier = this.getTier();
    return tier.features.includes(featureName);
  }

  /**
   * Check usage quota. Returns { allowed, remaining, limit, used }.
   */
  checkQuota() {
    const account = this.getAccount();
    const tier = this.getTier();

    if (!tier.metered) {
      return { allowed: true, remaining: Infinity, limit: Infinity, used: 0 };
    }

    const usage = account?.usage || { scansThisMonth: 0, periodStart: new Date().toISOString() };

    // Reset if new month
    const periodStart = new Date(usage.periodStart);
    const now = new Date();
    if (now.getMonth() !== periodStart.getMonth() || now.getFullYear() !== periodStart.getFullYear()) {
      usage.scansThisMonth = 0;
      usage.periodStart = now.toISOString();
    }

    const remaining = tier.scansPerMonth - usage.scansThisMonth;
    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      limit: tier.scansPerMonth,
      used: usage.scansThisMonth,
    };
  }

  /**
   * Record a scan against the quota.
   */
  recordScan() {
    const account = this.getAccount();
    if (!account) return;

    const tier = this.getTier();
    if (!tier.metered) return; // Admin — no tracking

    if (!account.usage) {
      account.usage = { scansThisMonth: 0, periodStart: new Date().toISOString() };
    }

    // Reset if new month
    const periodStart = new Date(account.usage.periodStart);
    const now = new Date();
    if (now.getMonth() !== periodStart.getMonth() || now.getFullYear() !== periodStart.getFullYear()) {
      account.usage.scansThisMonth = 0;
      account.usage.periodStart = now.toISOString();
    }

    account.usage.scansThisMonth++;
    this._saveLocal(account);
  }

  /**
   * Authenticate with API key.
   */
  async login(apiKey) {
    // Verify key against API
    const profile = await this._apiGet('/v1/account/me', apiKey);

    const account = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tier: profile.tier || 'free',
      apiKey,
      stripeCustomerId: profile.stripeCustomerId || null,
      teamId: profile.teamId || null,
      usage: profile.usage || { scansThisMonth: 0, periodStart: new Date().toISOString() },
      lastVerified: new Date().toISOString(),
    };

    this._saveLocal(account);
    this._account = account;
    return account;
  }

  /**
   * Log out — remove local credentials.
   */
  logout() {
    if (fs.existsSync(this.accountPath)) {
      fs.unlinkSync(this.accountPath);
    }
    this._account = null;
  }

  /**
   * Generate a new API key (admin only).
   */
  generateApiKey() {
    return `gt_${crypto.randomBytes(24).toString('hex')}`;
  }

  /**
   * Verify the cached account is still valid (call API periodically).
   */
  async verify() {
    const account = this.getAccount();
    if (!account?.apiKey) return false;

    // Only verify once per hour
    if (account.lastVerified) {
      const elapsed = Date.now() - new Date(account.lastVerified).getTime();
      if (elapsed < 3600000) return true; // 1 hour
    }

    try {
      const profile = await this._apiGet('/v1/account/me', account.apiKey);
      account.tier = profile.tier || account.tier;
      account.usage = profile.usage || account.usage;
      account.lastVerified = new Date().toISOString();
      this._saveLocal(account);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get account status summary for display.
   */
  getStatusSummary() {
    const account = this.getAccount();
    const tier = this.getTier();
    const quota = this.checkQuota();

    if (!account) {
      return {
        authenticated: false,
        tier: 'free',
        tierName: 'Free',
        message: 'Not logged in. Run `gatetest auth login` to unlock full features.',
      };
    }

    return {
      authenticated: true,
      email: account.email,
      tier: account.tier,
      tierName: tier.name,
      metered: tier.metered,
      scansUsed: quota.used,
      scansRemaining: quota.remaining,
      scansLimit: quota.limit,
      features: tier.features,
      message: tier.metered
        ? `${tier.name} plan: ${quota.remaining}/${quota.limit} scans remaining this month`
        : `${tier.name} plan: Unlimited access`,
    };
  }

  // ─── Internal ────────────────────────────────────────────

  _loadLocal() {
    if (!fs.existsSync(this.accountPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.accountPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  _saveLocal(account) {
    const dir = path.dirname(this.accountPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.accountPath, JSON.stringify(account, null, 2), { mode: 0o600 });
  }

  _apiGet(urlPath, apiKey) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.apiBase);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'GateTest-CLI/1.0.0',
          'Accept': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode >= 400) {
            reject(new Error(`API error ${res.statusCode}: ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Invalid API response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy(new Error('API request timeout'));
      });
      req.end();
    });
  }
}

module.exports = { AccountManager, TIERS };
