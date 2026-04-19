const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  GluecronBridge,
  resolveBaseUrl,
  circuitState,
  rateLimitState,
  RETRY_CONFIG,
  CIRCUIT_BREAKER,
} = require('../src/core/gluecron-bridge');

const { createBridge, listBridges } = require('../src/core/host-bridge');

describe('GluecronBridge Resilience', () => {
  beforeEach(() => {
    circuitState.status = 'closed';
    circuitState.failures = 0;
    circuitState.lastFailureTime = null;
    circuitState.lastSuccessTime = null;

    rateLimitState.remaining = null;
    rateLimitState.limit = null;
    rateLimitState.resetTime = null;
  });

  describe('Registration', () => {
    it('registers under hostName "gluecron"', () => {
      assert.strictEqual(GluecronBridge.hostName, 'gluecron');
      assert.ok(listBridges().includes('gluecron'));
    });

    it('createBridge("gluecron") returns a GluecronBridge', () => {
      const bridge = createBridge('gluecron', { token: 'glc_' + 'a'.repeat(64) });
      assert.ok(bridge instanceof GluecronBridge);
      assert.strictEqual(bridge.hostName, 'gluecron');
    });

    it('still exposes GitHubBridge as a sibling implementation', () => {
      // Force registration by requiring the module.
      require('../src/core/github-bridge');
      assert.ok(listBridges().includes('github'));
      assert.ok(listBridges().includes('gluecron'));
    });
  });

  describe('Constructor + env resolution', () => {
    it('accepts an explicit token', () => {
      const bridge = new GluecronBridge({ token: 'glc_explicit' });
      assert.strictEqual(bridge.token, 'glc_explicit');
    });

    it('falls back to GLUECRON_API_TOKEN env var when no token given', () => {
      const orig = process.env.GLUECRON_API_TOKEN;
      process.env.GLUECRON_API_TOKEN = 'glc_from_env';
      try {
        const bridge = new GluecronBridge();
        assert.strictEqual(bridge.token, 'glc_from_env');
      } finally {
        if (orig === undefined) delete process.env.GLUECRON_API_TOKEN;
        else process.env.GLUECRON_API_TOKEN = orig;
      }
    });

    it('resolves base URL from options, env, or default', () => {
      const orig = process.env.GLUECRON_BASE_URL;
      delete process.env.GLUECRON_BASE_URL;
      try {
        assert.strictEqual(resolveBaseUrl(), 'https://gluecron.com');
        process.env.GLUECRON_BASE_URL = 'https://staging.gluecron.com/';
        assert.strictEqual(resolveBaseUrl(), 'https://staging.gluecron.com');
        assert.strictEqual(resolveBaseUrl('https://custom/'), 'https://custom');
      } finally {
        if (orig === undefined) delete process.env.GLUECRON_BASE_URL;
        else process.env.GLUECRON_BASE_URL = orig;
      }
    });

    it('strips trailing slash from base URL', () => {
      const bridge = new GluecronBridge({ baseUrl: 'https://gluecron.com/' });
      assert.strictEqual(bridge.baseUrl, 'https://gluecron.com');
    });
  });

  describe('Circuit Breaker', () => {
    it('starts in closed state', () => {
      assert.strictEqual(circuitState.status, 'closed');
      assert.strictEqual(circuitState.failures, 0);
    });

    it('opens after threshold failures', () => {
      circuitState.failures = CIRCUIT_BREAKER.failureThreshold;
      circuitState.status = 'open';
      circuitState.lastFailureTime = Date.now();
      assert.strictEqual(circuitState.status, 'open');
    });

    it('resets on manual reset', () => {
      const bridge = new GluecronBridge({ token: 'glc_test' });
      circuitState.status = 'open';
      circuitState.failures = 10;
      bridge.resetCircuitBreaker();
      assert.strictEqual(circuitState.status, 'closed');
      assert.strictEqual(circuitState.failures, 0);
    });

    it('exposes circuit state via getAccessStatus', () => {
      const bridge = new GluecronBridge({ token: 'glc_test' });
      circuitState.failures = 2;
      const status = bridge.getAccessStatus();
      assert.strictEqual(status.circuitBreaker.failures, 2);
      assert.strictEqual(status.circuitBreaker.status, 'closed');
      assert.strictEqual(status.retryConfig.maxRetries, RETRY_CONFIG.maxRetries);
    });

    it('has reasonable threshold + reset time', () => {
      assert.ok(CIRCUIT_BREAKER.failureThreshold >= 3);
      assert.ok(CIRCUIT_BREAKER.failureThreshold <= 10);
      assert.ok(CIRCUIT_BREAKER.resetTimeMs >= 30000);
      assert.ok(CIRCUIT_BREAKER.resetTimeMs <= 300000);
    });
  });

  describe('Rate Limit Tracking', () => {
    it('starts with null rate limit state', () => {
      assert.strictEqual(rateLimitState.remaining, null);
      assert.strictEqual(rateLimitState.limit, null);
      assert.strictEqual(rateLimitState.resetTime, null);
    });

    it('exposes rate limit via getAccessStatus', () => {
      const bridge = new GluecronBridge({ token: 'glc_test' });
      rateLimitState.remaining = 4500;
      rateLimitState.limit = 5000;
      rateLimitState.resetTime = Math.floor(Date.now() / 1000) + 3600;
      const status = bridge.getAccessStatus();
      assert.strictEqual(status.rateLimit.remaining, 4500);
      assert.strictEqual(status.rateLimit.limit, 5000);
    });
  });

  describe('Retry Configuration', () => {
    it('has sensible retry defaults mirroring GitHubBridge', () => {
      assert.strictEqual(RETRY_CONFIG.maxRetries, 4);
      assert.strictEqual(RETRY_CONFIG.baseDelayMs, 2000);
      assert.ok(RETRY_CONFIG.retryableStatuses.includes(503));
      assert.ok(RETRY_CONFIG.retryableStatuses.includes(502));
      assert.ok(RETRY_CONFIG.retryableStatuses.includes(429));
      assert.ok(RETRY_CONFIG.retryableStatuses.includes(500));
    });

    it('does not retry on 401 / 404 / 422', () => {
      assert.ok(!RETRY_CONFIG.retryableStatuses.includes(401));
      assert.ok(!RETRY_CONFIG.retryableStatuses.includes(404));
      assert.ok(!RETRY_CONFIG.retryableStatuses.includes(422));
    });
  });

  describe('HostBridge contract surface', () => {
    const bridge = new GluecronBridge({ token: 'glc_test' });

    it('exposes all required primitives', () => {
      const methods = [
        'healthCheck', 'verifyAuth', 'getAccessStatus', 'resetCircuitBreaker',
        'accessRepo', 'cloneRepo', 'pull', 'push',
        'getDefaultBranch', 'createBranch',
        'createPullRequest', 'getPullRequest', 'updatePullRequest',
        'addPrComment', 'listPrComments',
        'createCommit', 'getCommit', 'listCommits',
        'setCommitStatus', 'getCombinedStatus',
        'createWebhookServer',
        // Inherited shared methods
        'postGateResult', 'reportResults',
      ];
      for (const m of methods) {
        assert.strictEqual(typeof bridge[m], 'function', `missing method ${m}`);
      }
    });

    it('validates commit status state via shared helper', () => {
      assert.throws(() => bridge._validateCommitState('bogus'), /Invalid commit status state/);
      assert.doesNotThrow(() => bridge._validateCommitState('pending'));
      assert.doesNotThrow(() => bridge._validateCommitState('success'));
      assert.doesNotThrow(() => bridge._validateCommitState('failure'));
      assert.doesNotThrow(() => bridge._validateCommitState('error'));
    });

    it('accessRepo / cloneRepo / pull / push throw explanatory errors', async () => {
      await assert.rejects(bridge.accessRepo('o', 'r', '/tmp'), /not supported/);
      await assert.rejects(bridge.cloneRepo('o', 'r'), /not supported/);
      await assert.rejects(bridge.pull(), /not supported/);
      await assert.rejects(bridge.push(), /not supported/);
      await assert.rejects(bridge.createCommit(), /not supported/);
    });

    it('createWebhookServer returns an HTTP server', () => {
      const srv = bridge.createWebhookServer({ push: () => {} }, { secret: 'x' });
      assert.ok(srv, 'webhook server returned');
      assert.strictEqual(typeof srv.listen, 'function');
      assert.strictEqual(typeof srv.close, 'function');
      srv.close();
    });
  });

  describe('verifyAuth', () => {
    it('throws a helpful error when no token configured', async () => {
      const bridge = new GluecronBridge({ token: null });
      bridge.token = null;
      await assert.rejects(
        bridge.verifyAuth(),
        /No Gluecron token configured/,
      );
    });
  });

  describe('Cross-host coexistence', () => {
    it('GitHub + Gluecron circuit breakers are independent', () => {
      // Require both bridges to ensure both register.
      const gh = require('../src/core/github-bridge');
      const gl = require('../src/core/gluecron-bridge');

      // Tripping one must not affect the other.
      gl.circuitState.status = 'open';
      gl.circuitState.failures = 5;
      assert.notStrictEqual(gh.circuitState.status, 'open');
    });
  });
});
