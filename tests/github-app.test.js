const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  generateAppManifest,
  TokenCache,
  InstallationStore,
  verifyWebhookSignature,
  processWebhookEvent,
} = require('../src/core/github-app');

// ─── App Manifest ──────────────────────────────────────────

describe('generateAppManifest', () => {
  it('should generate a valid manifest with defaults', () => {
    const manifest = generateAppManifest({ appUrl: 'https://gatetest.io' });

    assert.strictEqual(manifest.name, 'GateTest');
    assert.strictEqual(manifest.url, 'https://gatetest.io');
    assert.ok(manifest.hook_attributes.url.includes('/api/webhook'));
    assert.ok(manifest.redirect_url.includes('/api/github/callback'));
    assert.strictEqual(manifest.public, true);
  });

  it('should include required permissions', () => {
    const manifest = generateAppManifest();
    const perms = manifest.default_permissions;

    assert.strictEqual(perms.contents, 'read');
    assert.strictEqual(perms.metadata, 'read');
    assert.strictEqual(perms.commit_statuses, 'write');
    assert.strictEqual(perms.pull_requests, 'write');
    assert.strictEqual(perms.issues, 'write');
    assert.strictEqual(perms.checks, 'write');
  });

  it('should subscribe to required events', () => {
    const manifest = generateAppManifest();

    assert.ok(manifest.default_events.includes('push'));
    assert.ok(manifest.default_events.includes('pull_request'));
    assert.ok(manifest.default_events.includes('installation'));
    assert.ok(manifest.default_events.includes('installation_repositories'));
  });

  it('should accept custom name and URL', () => {
    const manifest = generateAppManifest({
      name: 'MyQA',
      appUrl: 'https://myqa.dev',
    });

    assert.strictEqual(manifest.name, 'MyQA');
    assert.strictEqual(manifest.url, 'https://myqa.dev');
    assert.ok(manifest.hook_attributes.url.includes('myqa.dev'));
  });
});

// ─── Token Cache ───────────────────────────────────────────

describe('TokenCache', () => {
  it('should return null for unknown installation', () => {
    const cache = new TokenCache();
    assert.strictEqual(cache.get(12345), null);
  });

  it('should store and retrieve tokens', () => {
    const cache = new TokenCache();
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour
    cache.set(123, 'ghs_faketoken', expiresAt);

    assert.strictEqual(cache.get(123), 'ghs_faketoken');
  });

  it('should return null for expired tokens', () => {
    const cache = new TokenCache();
    const expired = new Date(Date.now() - 1000).toISOString(); // Already expired
    cache.set(123, 'ghs_expired', expired);

    assert.strictEqual(cache.get(123), null);
  });

  it('should return null when token expires within 5 minutes', () => {
    const cache = new TokenCache();
    const almostExpired = new Date(Date.now() + 200000).toISOString(); // 3.3 min
    cache.set(123, 'ghs_almost', almostExpired);

    assert.strictEqual(cache.get(123), null);
  });

  it('should handle multiple installations', () => {
    const cache = new TokenCache();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    cache.set(111, 'token_a', expiresAt);
    cache.set(222, 'token_b', expiresAt);

    assert.strictEqual(cache.get(111), 'token_a');
    assert.strictEqual(cache.get(222), 'token_b');
  });
});

// ─── Installation Store ────────────────────────────────────

const STORE_PATH = path.join(__dirname, '..', '.test-tmp-installations.json');

describe('InstallationStore', () => {
  beforeEach(() => {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  });
  afterEach(() => {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  });

  it('should start empty', () => {
    const store = new InstallationStore(STORE_PATH);
    assert.deepStrictEqual(store.list(), []);
  });

  it('should add and retrieve installations', () => {
    const store = new InstallationStore(STORE_PATH);
    store.add({
      id: 12345,
      account: { login: 'testuser', type: 'User' },
      app_id: 67890,
      target_type: 'User',
      permissions: { contents: 'read' },
      events: ['push'],
      repository_selection: 'selected',
    });

    const inst = store.get(12345);
    assert.ok(inst);
    assert.strictEqual(inst.account, 'testuser');
    assert.strictEqual(inst.accountType, 'User');
    assert.strictEqual(inst.repositorySelection, 'selected');
  });

  it('should persist to disk', () => {
    const store1 = new InstallationStore(STORE_PATH);
    store1.add({ id: 111, account: { login: 'org1', type: 'Organization' } });

    // Load from disk
    const store2 = new InstallationStore(STORE_PATH);
    const inst = store2.get(111);
    assert.ok(inst);
    assert.strictEqual(inst.account, 'org1');
  });

  it('should remove installations', () => {
    const store = new InstallationStore(STORE_PATH);
    store.add({ id: 111, account: { login: 'user1' } });
    store.add({ id: 222, account: { login: 'user2' } });

    store.remove(111);
    assert.strictEqual(store.get(111), undefined);
    assert.ok(store.get(222));
    assert.strictEqual(store.list().length, 1);
  });

  it('should find by account login', () => {
    const store = new InstallationStore(STORE_PATH);
    store.add({ id: 111, account: { login: 'myorg' } });

    const found = store.findByAccount('myorg');
    assert.ok(found);
    assert.strictEqual(found.id, 111);

    assert.strictEqual(store.findByAccount('nonexistent'), undefined);
  });
});

// ─── Webhook Signature Verification ────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_gatetest_123';

  it('should accept valid signatures', () => {
    const body = '{"action":"push"}';
    const sig = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    assert.strictEqual(verifyWebhookSignature(body, sig, secret), true);
  });

  it('should reject invalid signatures', () => {
    const body = '{"action":"push"}';
    assert.strictEqual(verifyWebhookSignature(body, 'sha256=invalid', secret), false);
  });

  it('should reject null signatures', () => {
    assert.strictEqual(verifyWebhookSignature('{}', null, secret), false);
  });

  it('should reject wrong-length signatures', () => {
    assert.strictEqual(verifyWebhookSignature('{}', 'sha256=short', secret), false);
  });

  it('should pass when no secret configured', () => {
    assert.strictEqual(verifyWebhookSignature('{}', null, ''), true);
  });
});

// ─── Webhook Event Processing ──────────────────────────────

describe('processWebhookEvent', () => {
  const store = new InstallationStore(STORE_PATH);

  afterEach(() => {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  });

  it('should handle app installation', () => {
    const result = processWebhookEvent('installation', {
      action: 'created',
      installation: {
        id: 999,
        account: { login: 'newuser', type: 'User' },
        app_id: 123,
        target_type: 'User',
        permissions: {},
        events: [],
        repository_selection: 'all',
      },
      repositories: [{ full_name: 'newuser/repo1' }],
    }, store);

    assert.strictEqual(result.action, 'app_installed');
    assert.strictEqual(result.account, 'newuser');
    assert.deepStrictEqual(result.repos, ['newuser/repo1']);
    assert.ok(store.get(999));
  });

  it('should handle app uninstallation', () => {
    store.add({ id: 888, account: { login: 'leavinguser' } });

    const result = processWebhookEvent('installation', {
      action: 'deleted',
      installation: { id: 888, account: { login: 'leavinguser' } },
    }, store);

    assert.strictEqual(result.action, 'app_uninstalled');
    assert.strictEqual(store.get(888), undefined);
  });

  it('should handle repos added', () => {
    const result = processWebhookEvent('installation_repositories', {
      action: 'added',
      installation: { account: { login: 'user1' } },
      repositories_added: [{ full_name: 'user1/new-repo' }],
      repositories_removed: [],
    }, store);

    assert.strictEqual(result.action, 'repos_added');
    assert.deepStrictEqual(result.added, ['user1/new-repo']);
  });

  it('should handle push events', () => {
    const result = processWebhookEvent('push', {
      repository: { full_name: 'org/myapp' },
      ref: 'refs/heads/main',
      after: 'abc123',
      installation: { id: 555 },
    }, store);

    assert.strictEqual(result.action, 'push');
    assert.strictEqual(result.repo, 'org/myapp');
    assert.strictEqual(result.branch, 'main');
    assert.strictEqual(result.sha, 'abc123');
  });

  it('should handle PR events', () => {
    const result = processWebhookEvent('pull_request', {
      action: 'opened',
      repository: { full_name: 'org/myapp' },
      pull_request: { number: 42, head: { sha: 'def456', ref: 'feature-x' } },
      installation: { id: 555 },
    }, store);

    assert.strictEqual(result.action, 'pr_opened');
    assert.strictEqual(result.pr, 42);
    assert.strictEqual(result.sha, 'def456');
  });

  it('should handle unknown events', () => {
    const result = processWebhookEvent('marketplace_purchase', {}, store);
    assert.strictEqual(result.action, 'unknown_marketplace_purchase');
  });
});
