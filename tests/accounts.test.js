const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { AccountManager, TIERS } = require('../src/core/accounts');

const TEST_ROOT = path.join(__dirname, '..', '.test-tmp-accounts');

function setup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
  fs.mkdirSync(path.join(TEST_ROOT, '.gatetest'), { recursive: true });
}

function cleanup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
}

describe('TIERS', () => {
  it('should define all four tiers', () => {
    assert.ok(TIERS.admin);
    assert.ok(TIERS.pro);
    assert.ok(TIERS.team);
    assert.ok(TIERS.free);
  });

  it('admin should be unmetered with unlimited scans', () => {
    assert.strictEqual(TIERS.admin.metered, false);
    assert.strictEqual(TIERS.admin.scansPerMonth, Infinity);
    assert.strictEqual(TIERS.admin.modules, 'all');
  });

  it('free should be limited to quick suite and 30 scans', () => {
    assert.strictEqual(TIERS.free.scansPerMonth, 30);
    assert.deepStrictEqual(TIERS.free.suites, ['quick']);
    assert.ok(Array.isArray(TIERS.free.modules));
    assert.strictEqual(TIERS.free.metered, true);
  });

  it('pro should allow 500 scans', () => {
    assert.strictEqual(TIERS.pro.scansPerMonth, 500);
    assert.strictEqual(TIERS.pro.modules, 'all');
  });

  it('team should allow 2000 scans with team management', () => {
    assert.strictEqual(TIERS.team.scansPerMonth, 2000);
    assert.ok(TIERS.team.features.includes('team-management'));
  });
});

describe('AccountManager', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should return null when no account exists', () => {
    const mgr = new AccountManager(TEST_ROOT);
    assert.strictEqual(mgr.getAccount(), null);
  });

  it('should default to free tier when not logged in', () => {
    const mgr = new AccountManager(TEST_ROOT);
    const tier = mgr.getTier();
    assert.strictEqual(tier.name, 'Free');
    assert.strictEqual(tier.scansPerMonth, 30);
  });

  it('should load a saved account', () => {
    const accountData = {
      id: 'usr_123',
      email: 'test@example.com',
      tier: 'pro',
      apiKey: 'gt_abc123',
      usage: { scansThisMonth: 5, periodStart: new Date().toISOString() },
    };
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify(accountData));

    const mgr = new AccountManager(TEST_ROOT);
    const account = mgr.getAccount();

    assert.strictEqual(account.email, 'test@example.com');
    assert.strictEqual(account.tier, 'pro');
  });

  it('should check suite access by tier', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'free' }));

    const mgr = new AccountManager(TEST_ROOT);
    assert.strictEqual(mgr.canRunSuite('quick'), true);
    assert.strictEqual(mgr.canRunSuite('full'), false);
    assert.strictEqual(mgr.canRunSuite('nuclear'), false);
  });

  it('should check module access by tier', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'free' }));

    const mgr = new AccountManager(TEST_ROOT);
    assert.strictEqual(mgr.canRunModule('syntax'), true);
    assert.strictEqual(mgr.canRunModule('lint'), true);
    assert.strictEqual(mgr.canRunModule('security'), false); // Not in free modules
    assert.strictEqual(mgr.canRunModule('liveCrawler'), false);
  });

  it('admin should access all modules', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'admin' }));

    const mgr = new AccountManager(TEST_ROOT);
    assert.strictEqual(mgr.canRunModule('security'), true);
    assert.strictEqual(mgr.canRunModule('liveCrawler'), true);
    assert.strictEqual(mgr.canRunModule('anything'), true);
  });

  it('should check feature access', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'pro' }));

    const mgr = new AccountManager(TEST_ROOT);
    assert.strictEqual(mgr.hasFeature('session-ledger'), true);
    assert.strictEqual(mgr.hasFeature('live-crawler'), true);
    assert.strictEqual(mgr.hasFeature('team-management'), false); // Team only
  });

  it('should check quota for metered accounts', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'free',
      usage: { scansThisMonth: 25, periodStart: new Date().toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    const quota = mgr.checkQuota();

    assert.strictEqual(quota.allowed, true);
    assert.strictEqual(quota.used, 25);
    assert.strictEqual(quota.remaining, 5);
    assert.strictEqual(quota.limit, 30);
  });

  it('should block when quota exceeded', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'free',
      usage: { scansThisMonth: 30, periodStart: new Date().toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    const quota = mgr.checkQuota();

    assert.strictEqual(quota.allowed, false);
    assert.strictEqual(quota.remaining, 0);
  });

  it('admin should have unlimited quota', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'admin' }));

    const mgr = new AccountManager(TEST_ROOT);
    const quota = mgr.checkQuota();

    assert.strictEqual(quota.allowed, true);
    assert.strictEqual(quota.remaining, Infinity);
  });

  it('should reset quota on new month', () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'free',
      usage: { scansThisMonth: 30, periodStart: lastMonth.toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    const quota = mgr.checkQuota();

    assert.strictEqual(quota.allowed, true);
    assert.strictEqual(quota.used, 0);
    assert.strictEqual(quota.remaining, 30);
  });

  it('should record scans and increment usage', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'pro',
      usage: { scansThisMonth: 10, periodStart: new Date().toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    mgr.recordScan();

    // Reload and check
    const updated = JSON.parse(fs.readFileSync(accountPath, 'utf-8'));
    assert.strictEqual(updated.usage.scansThisMonth, 11);
  });

  it('should not track usage for admin', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'admin',
      usage: { scansThisMonth: 0, periodStart: new Date().toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    mgr.recordScan();

    const updated = JSON.parse(fs.readFileSync(accountPath, 'utf-8'));
    assert.strictEqual(updated.usage.scansThisMonth, 0);
  });

  it('should logout and remove credentials', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({ tier: 'pro', email: 'test@test.com' }));

    const mgr = new AccountManager(TEST_ROOT);
    assert.ok(mgr.getAccount());

    mgr.logout();
    assert.strictEqual(fs.existsSync(accountPath), false);
    assert.strictEqual(mgr.getAccount(), null);
  });

  it('should generate valid API keys', () => {
    const mgr = new AccountManager(TEST_ROOT);
    const key = mgr.generateApiKey();

    assert.ok(key.startsWith('gt_'));
    assert.strictEqual(key.length, 3 + 48); // gt_ + 24 bytes hex
  });

  it('should return status summary for logged-in user', () => {
    const accountPath = path.join(TEST_ROOT, '.gatetest', 'account.json');
    fs.writeFileSync(accountPath, JSON.stringify({
      tier: 'team',
      email: 'admin@company.com',
      usage: { scansThisMonth: 100, periodStart: new Date().toISOString() },
    }));

    const mgr = new AccountManager(TEST_ROOT);
    const status = mgr.getStatusSummary();

    assert.strictEqual(status.authenticated, true);
    assert.strictEqual(status.tierName, 'Team');
    assert.strictEqual(status.scansUsed, 100);
    assert.strictEqual(status.scansRemaining, 1900);
    assert.ok(status.features.includes('team-management'));
  });

  it('should return status summary for anonymous user', () => {
    const mgr = new AccountManager(TEST_ROOT);
    const status = mgr.getStatusSummary();

    assert.strictEqual(status.authenticated, false);
    assert.strictEqual(status.tier, 'free');
    assert.ok(status.message.includes('Not logged in'));
  });
});
