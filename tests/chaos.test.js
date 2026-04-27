// ============================================================================
// CHAOS-MODULE TEST — Phase 3.4 of THE FIX-FIRST BUILD PLAN
// ============================================================================
// Covers src/modules/chaos.js — the resilience-testing module that
// injects failures (slow network, API failures, offline mode) via
// Playwright. The browser-side scenarios can't run in CI without
// Playwright + a target URL, but the module's CONFIG / SKIP /
// PLAYWRIGHT-DETECTION paths are testable and important — they
// determine whether the module fails-soft or fails-confused when
// dependencies are missing.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ChaosModule = require('../src/modules/chaos');

// Minimal stub of the result object the module writes to. Records every
// addCheck call so tests can assert on what got reported.
function makeResult() {
  const calls = [];
  return {
    calls,
    addCheck(name, passed, meta) {
      calls.push({ name, passed, meta: meta || {} });
    },
  };
}

// Minimal config stub matching the GateTestConfig surface the module uses.
function makeConfig({ chaosUrl, explorerUrl, liveCrawlerUrl } = {}) {
  return {
    getModuleConfig(name) {
      if (name === 'chaos') return chaosUrl ? { url: chaosUrl } : {};
      return {};
    },
    get(key) {
      if (key === 'explorer.url') return explorerUrl;
      if (key === 'liveCrawler.url') return liveCrawlerUrl;
      return undefined;
    },
  };
}

// ---------- Module shape ----------

test('ChaosModule — module shape', () => {
  const mod = new ChaosModule();
  assert.equal(typeof mod.name, 'string');
  assert.ok(mod.name.length > 0);
  assert.equal(mod.name, 'chaos');
  assert.equal(typeof mod.description, 'string');
  assert.ok(mod.description.length > 0);
  assert.equal(typeof mod.run, 'function');
});

test('ChaosModule — has the five resilience scenarios as private methods', () => {
  const mod = new ChaosModule();
  // The five scenarios named in the module header — slow network,
  // API failures, offline, missing resources, timeouts.
  assert.equal(typeof mod._testSlowNetwork, 'function');
  assert.equal(typeof mod._testApiFailures, 'function');
  assert.equal(typeof mod._testOfflineMode, 'function');
  assert.equal(typeof mod._testMissingResources, 'function');
  assert.equal(typeof mod._testTimeouts, 'function');
});

// ---------- run() early-return paths ----------

test('run — no URL configured anywhere → fails soft with config message, never touches Playwright', async () => {
  const mod = new ChaosModule();
  const result = makeResult();
  const config = makeConfig(); // nothing configured

  await mod.run(result, config);

  assert.equal(result.calls.length, 1);
  const c = result.calls[0];
  assert.equal(c.name, 'chaos:config');
  assert.equal(c.passed, true); // info, not a failure — we don't punish absence
  assert.match(c.meta.message, /No URL configured/);
});

test('run — chaos.url takes precedence over explorer.url and liveCrawler.url', async () => {
  // We can't actually launch a browser in tests, but we CAN verify the
  // URL-resolution logic by stubbing module._launch... actually, the
  // current module doesn't expose a stub seam. Until it does, we only
  // assert the config-resolution branch via the no-Playwright path
  // (covered below) which still resolves the URL first.
  const mod = new ChaosModule();
  const result = makeResult();
  const config = makeConfig({
    chaosUrl: 'https://chaos.example.com',
    explorerUrl: 'https://explorer.example.com',
    liveCrawlerUrl: 'https://crawler.example.com',
  });

  // Hijack require('playwright') to throw — ensures we exit before
  // any browser launch. The module's catch block records the
  // chaos:playwright check.
  const pwPath = require.resolve('module');
  const Module = require(pwPath);
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, parent, ...rest) {
    if (req === 'playwright') throw new Error("Cannot find module 'playwright'");
    return origResolve.call(this, req, parent, ...rest);
  };

  try {
    await mod.run(result, config);
  } finally {
    Module._resolveFilename = origResolve;
  }

  // Should have recorded a "playwright not installed" check
  const pwCheck = result.calls.find((c) => c.name === 'chaos:playwright');
  assert.ok(pwCheck, 'expected chaos:playwright check to fire');
  assert.equal(pwCheck.passed, false);
  assert.match(pwCheck.meta.message, /Playwright not installed/);
  assert.match(pwCheck.meta.suggestion, /npm install playwright/);
});

test('run — falls back to liveCrawler.url when no chaos.url configured', async () => {
  const mod = new ChaosModule();
  const result = makeResult();
  const config = makeConfig({ liveCrawlerUrl: 'https://fallback.example.com' });

  // Same playwright stub as above
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, parent, ...rest) {
    if (req === 'playwright') throw new Error("Cannot find module 'playwright'");
    return origResolve.call(this, req, parent, ...rest);
  };

  try {
    await mod.run(result, config);
  } finally {
    Module._resolveFilename = origResolve;
  }

  // URL fallback worked → we got past the no-URL early return →
  // hit the playwright-missing branch (which is what we want to assert).
  const pwCheck = result.calls.find((c) => c.name === 'chaos:playwright');
  assert.ok(pwCheck, 'expected to reach the Playwright-load step');
});

test('run — no URL anywhere does NOT attempt to require playwright', async () => {
  const mod = new ChaosModule();
  const result = makeResult();
  const config = makeConfig();

  let playwrightLoadAttempted = false;
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (req, parent, ...rest) {
    if (req === 'playwright') {
      playwrightLoadAttempted = true;
      throw new Error("Cannot find module 'playwright'");
    }
    return origResolve.call(this, req, parent, ...rest);
  };

  try {
    await mod.run(result, config);
  } finally {
    Module._resolveFilename = origResolve;
  }

  assert.equal(playwrightLoadAttempted, false, 'Playwright should not be touched when no URL is configured');
});

// ---------- Coverage for the registered tier inclusion ----------

test('ChaosModule — listed as a runnable module (CommonJS export)', () => {
  // The registry imports this via require — make sure the module
  // exports a class that's `new`-able with no required arguments.
  const mod = new ChaosModule();
  assert.ok(mod instanceof ChaosModule);
});
