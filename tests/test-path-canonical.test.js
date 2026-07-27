/**
 * KI #77 — one canonical "is this test code?" predicate.
 *
 * What the audit actually found (the KI said "TEST_PATH_RE copy-pasted into
 * 20 files", which undersold it): there were **6 materially different**
 * bodies, so whether a path counted as a test depended on which module asked.
 *
 * And the live defect underneath: `path.relative()` returns `tests\helper.js`
 * on Windows, but every one of those regexes required `/`. Eight modules
 * tested the raw value — async-iteration, env-vars, hardcoded-url,
 * import-cycle, openapi-drift, race-condition, resource-leak, ssrf — so on
 * any Windows checkout a file under `tests/` went unrecognised unless its
 * NAME also carried `.test.`/`.spec.`. Findings in `tests/helper.js`,
 * `tests/setup.js`, `spec/support/*.js` were reported at full severity; for
 * `ssrf` that is a gate-BLOCKING error instead of an info.
 *
 * Measured effect of consolidating, on GateTest's own repo (a Windows
 * checkout): warnings 820 -> 813. Seven real false positives removed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BaseModule = require('../src/modules/base-module');
const MODULES_DIR = path.join(__dirname, '..', 'src', 'modules');

const probe = new BaseModule('probe', 'probe');

describe('BaseModule._isTestPath — canonical predicate', () => {
  const MATCH = [
    'tests/helper.js',
    'test/helper.js',
    'src/__tests__/a.js',
    'spec/support/env.js',
    'specs/thing.js',
    'e2e/flow.js',
    'src/fixtures/data.js',
    'stories/Button.js',
    'src/foo.test.js',
    'src/foo.spec.ts',
    'src/foo.stories.tsx',
    'app/test_thing.spec.py',
  ];
  const NO_MATCH = [
    'src/app.js',
    'lib/tester.js',        // "test" as a substring is not a test dir
    'src/contest/main.js',
    'src/latest/x.js',
    'src/attestation.js',
    'protest.js',
  ];

  for (const p of MATCH) {
    it(`matches ${p}`, () => assert.strictEqual(probe._isTestPath(p), true));
  }
  for (const p of NO_MATCH) {
    it(`does not match ${p}`, () => assert.strictEqual(probe._isTestPath(p), false));
  }

  it('handles junk input without throwing', () => {
    for (const v of [null, undefined, '', 42, {}, []]) {
      assert.strictEqual(probe._isTestPath(v), false);
    }
  });
});

describe('KI #77 — Windows separators (the live defect)', () => {
  // These are the exact shapes path.relative() produces on Windows. Before
  // consolidation the 8 non-normalising modules returned false for all of
  // them and reported test-code findings at full severity.
  const WIN = [
    'tests\\helper.js',
    'tests\\setup.js',
    'spec\\support\\env.js',
    'src\\fixtures\\data.js',
    'e2e\\flow.js',
    'src\\__tests__\\a.js',
  ];
  for (const p of WIN) {
    it(`recognises ${JSON.stringify(p)}`, () => {
      assert.strictEqual(probe._isTestPath(p), true, 'backslash paths must normalise');
    });
  }

  it('a backslash path and its posix twin agree', () => {
    const pairs = [
      ['tests/helper.js', 'tests\\helper.js'],
      ['src/fixtures/data.js', 'src\\fixtures\\data.js'],
      ['src/app.js', 'src\\app.js'],
    ];
    for (const [posix, win] of pairs) {
      assert.strictEqual(
        probe._isTestPath(posix),
        probe._isTestPath(win),
        `${posix} and ${win} must classify identically`,
      );
    }
  });
});

describe('KI #77 — the drift cannot come back', () => {
  // base-module owns the canonical body. claude-compliance keeps its own
  // because it asks a BROADER question (mocks/examples/docs = "not shipped
  // code"), and folding that in would start suppressing findings in docs/
  // for all 20 modules.
  const ALLOWED_OWN_PATTERN = new Set(['base-module.js', 'claude-compliance.js']);

  it('no module re-declares its own TEST_PATH_RE', () => {
    const offenders = fs
      .readdirSync(MODULES_DIR)
      .filter((f) => f.endsWith('.js') && !ALLOWED_OWN_PATTERN.has(f))
      .filter((f) => /const\s+TEST_PATH_RE\s*=/.test(fs.readFileSync(path.join(MODULES_DIR, f), 'utf8')));
    assert.deepStrictEqual(offenders, [], 'use this._isTestPath() instead of a local copy');
  });

  it('the modules that were migrated now call the helper', () => {
    const migrated = [
      'ssrf.js', 'race-condition.js', 'resource-leak.js', 'hardcoded-url.js',
      'async-iteration.js', 'env-vars.js', 'openapi-drift.js', 'import-cycle.js',
      'cookie-security.js', 'log-pii.js', 'money-float.js', 'tls-security.js',
      'homoglyph.js', 'error-swallow.js', 'redos.js', 'datetime-bug.js',
      'feature-flag.js', 'cron-expression.js', 'cross-file-taint.js',
    ];
    for (const f of migrated) {
      const src = fs.readFileSync(path.join(MODULES_DIR, f), 'utf8');
      assert.match(src, /this\._isTestPath\(/, `${f} should call the shared helper`);
    }
  });

  it('the canonical pattern normalises inside the helper, not at call sites', () => {
    // The whole bug was call sites forgetting to normalise. Keep that
    // responsibility in one place.
    const src = fs.readFileSync(path.join(MODULES_DIR, 'base-module.js'), 'utf8');
    assert.match(src, /_isTestPath\(relPath\)\s*\{[\s\S]*?replace\(\/\\\\\/g, '\/'\)/);
  });
});
