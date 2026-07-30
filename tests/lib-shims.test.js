// ============================================================================
// LIB SHIMS TRIPWIRE — website/app/lib clients re-export src/core canonicals.
// ============================================================================
// The Sentry/Datadog(/Rollbar) clients were lifted to src/core so the MCP
// server (CLI-side) can use them without reaching into website/. The
// website keeps one-line re-export shims at the old paths so every
// existing import and the Vercel file-tracing setup keep working.
//
// This test is the tripwire against a future session "simplifying" a shim
// into a fork: the website export MUST be the same function object as the
// src/core export — identity, not equality.
// ============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('website lib shims re-export src/core canonicals (identity)', () => {
  it('sentry-client', () => {
    const core = require('../src/core/sentry-client.js');
    const shim = require('../website/app/lib/sentry-client.js');
    assert.strictEqual(shim.fetchTopErrors, core.fetchTopErrors);
    assert.strictEqual(shim.exchangeOAuthCode, core.exchangeOAuthCode);
    assert.strictEqual(shim.extractFrames, core.extractFrames);
  });

  it('datadog-client', () => {
    const core = require('../src/core/datadog-client.js');
    const shim = require('../website/app/lib/datadog-client.js');
    assert.strictEqual(shim.fetchTopErrors, core.fetchTopErrors);
    assert.strictEqual(shim.fetchErrorTraces, core.fetchErrorTraces);
    assert.strictEqual(shim.extractSourceLocation, core.extractSourceLocation);
  });

  it('rollbar-client', () => {
    const core = require('../src/core/rollbar-client.js');
    const shim = require('../website/app/lib/rollbar-client.js');
    assert.strictEqual(shim.fetchTopErrors, core.fetchTopErrors);
    assert.strictEqual(shim.extractSourceLocation, core.extractSourceLocation);
  });

  // Moved to src/core 2026-07-30 (KI #74): these three ARE the flywheel, and
  // living under website/ meant they were absent from the published package.
  it('auto-distill', () => {
    const core = require('../src/core/auto-distill.js');
    const shim = require('../website/app/lib/auto-distill.js');
    assert.strictEqual(shim.distillClaudeFix, core.distillClaudeFix);
    assert.strictEqual(shim.findMatchingRecipeLocal, core.findMatchingRecipeLocal);
    assert.strictEqual(shim.applyRecipe, core.applyRecipe);
    assert.strictEqual(shim.incrementApplicationCount, core.incrementApplicationCount);
  });

  it('fix-telemetry', () => {
    const core = require('../src/core/fix-telemetry.js');
    const shim = require('../website/app/lib/fix-telemetry.js');
    for (const k of Object.keys(core)) {
      assert.strictEqual(shim[k], core[k], `fix-telemetry.${k} must be the same object`);
    }
  });

  it('recipe-store-remote', () => {
    const core = require('../src/core/recipe-store-remote.js');
    const shim = require('../website/app/lib/recipe-store-remote.js');
    for (const k of Object.keys(core)) {
      assert.strictEqual(shim[k], core[k], `recipe-store-remote.${k} must be the same object`);
    }
  });
});

// ============================================================================
// PACKAGING TRIPWIRE — shipped code must not reach into website/
// ============================================================================
// KI #74's most expensive break: src/core/flywheel-playback-engine.js loaded the
// flywheel from '../../website/app/lib/auto-distill' through a require wrapped in
// a catch that returned null. `package.json` files is ["bin/","src/","lib/",…]
// and .npmignore excludes website/, so in the published package the file was not
// there — and the catch turned "not installed" into "found nothing". Recipe
// playback and distillation were dead for every `npm i -g` user for months while
// the product marketed the flywheel by name.
//
// The bug was invisible because nothing asserted the boundary. This does.
describe('published code never requires across the website/ boundary', () => {
  const fs = require('fs');
  const path = require('path');

  /** Directories that package.json `files` actually publishes. */
  const SHIPPED = ['bin', 'src', 'lib'];

  it('package.json still ships exactly the dirs this test guards', () => {
    const pkg = require('../package.json');
    for (const dir of SHIPPED) {
      assert.ok(
        pkg.files.some((f) => f === `${dir}/` || f === dir),
        `package.json files must include ${dir}/ — otherwise this guard is checking the wrong tree`,
      );
    }
    assert.ok(!pkg.files.includes('website/'), 'website/ is deliberately not published');
  });

  /**
   * KNOWN DEBT — shrink-only, never add.
   *
   * Started at four binaries that crashed with MODULE_NOT_FOUND for anyone who
   * installed from npm. Three are fixed: gatetest-doctor, gatetest-promote and
   * gatetest-train now load ci-doctor/, recipe-promotion and session-telemetry
   * from src/core. Unlike auto-distill, those three had NO website importers —
   * they were simply misfiled engine code — so they moved without needing shims.
   *
   * One left. `gatetest-reliability` is the most urgent of the original four
   * (it is one of the three `bin` entries package.json declares, so it is an
   * advertised command that cannot start) and also the deepest: reliability/ is
   * 9 files and pulls in ssrf-guard, which pulls in pentest/dns-verify, and
   * ssrf-guard is live in four website API routes — so that one needs shims and
   * more care than a straight move.
   *
   * Same approach the CRLF debt took under KI #77: make the remaining set
   * explicit and prevent growth, rather than pretend it is clean. Tracked as
   * Known Issue #74g.
   */
  const KNOWN_DEBT = new Set([
    'bin/gatetest-reliability.js',
  ]);

  it('the known-debt list only shrinks', () => {
    // If someone fixes one, this fails and tells them to delete the entry —
    // which keeps the list honest instead of letting it rot as a permanent
    // exemption nobody rechecks.
    const stillBroken = new Set();
    const walkDebt = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walkDebt(full); continue; }
        if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
        const rel = path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/');
        if (!KNOWN_DEBT.has(rel)) continue;
        if (/website\//.test(fs.readFileSync(full, 'utf8'))) stillBroken.add(rel);
      }
    };
    for (const dir of SHIPPED) walkDebt(path.join(__dirname, '..', dir));

    const fixed = [...KNOWN_DEBT].filter((f) => !stillBroken.has(f));
    assert.deepStrictEqual(fixed, [],
      `These no longer reach into website/ — remove them from KNOWN_DEBT: ${fixed.join(', ')}`);
  });

  it('no shipped file requires a website/ path', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
        const relPath = path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/');
        if (KNOWN_DEBT.has(relPath)) continue; // tracked above, shrink-only
        const src = fs.readFileSync(full, 'utf8');
        src.split(/\r?\n/).forEach((line, i) => {
          // require('...website/...') or import from a website path — comments
          // mentioning website/ paths are fine and common.
          if (/(?:require\s*\(|from\s*)['"][^'"]*website\/[^'"]*['"]/.test(line)) {
            offenders.push(`${path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/')}:${i + 1}: ${line.trim()}`);
          }
          // The path.join(__dirname, '../../website/...') form that caused KI #74.
          if (/path\.join\([^)]*['"][^'"]*website\/[^'"]*['"]/.test(line)) {
            offenders.push(`${path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/')}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    };
    for (const dir of SHIPPED) walk(path.join(__dirname, '..', dir));

    assert.deepStrictEqual(offenders, [],
      'Shipped code cannot load from website/ — it is not in the published package. '
      + 'Move the module to src/core/ and leave a re-export shim at the old path.');
  });
});
