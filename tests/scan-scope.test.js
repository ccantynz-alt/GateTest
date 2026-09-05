// =============================================================================
// SCAN SCOPE — which files are the application, and which are pages
// =============================================================================
// Two predicates, two different questions, both learned from measurement on
// third-party repos rather than from reading our own code:
//
//   isIllustrationPath   — "is this the application?"    (examples/, sandbox/)
//   isNonUserFacingPage  — "is this a page a user visits?" (adds test/, perf/)
//
// Measured 2026-09-01, --suite full:
//   axios  @81df7a5  54 blocking, 30 (56%) inside examples/ and sandbox/
//   express @023767f 12 authBypass findings, 12 (100%) inside examples/
//   lodash @a666ba5  47 blocking, 33 (70%) inside test/ and perf/ —
//                    test/index.html is a QUnit runner titled "lodash Test
//                    Suite"; perf/index.html is "lodash Performance Suite".
//
// SCOPE, NEVER SEVERITY. Craig ruled 2026-09-01 "keep the a11y blocking,
// thats quality." These predicates decide which files are looked at, never how
// loudly a real finding is reported. If a rule fires wrongly on real
// application code that is a precision bug in the rule, fixed with a control
// pair — not by widening these.
//
// The load-bearing group is the last one. A predicate that returns true for
// everything would make every scan silent and every other test here pass.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  isIllustrationPath, isNonUserFacingPage,
} = require('../src/core/scan-scope');

describe('scan-scope — illustrations are not the application', () => {
  const ILLUSTRATIONS = [
    'examples/hello-world/index.js',
    'example/server.js',
    'samples/api/index.js',
    'sample/app.js',
    'demo/index.html',
    'demos/server/index.js',
    'sandbox/client.js',
    'playground/index.html',
    'fixtures/app.js',
    '__fixtures__/data.js',
    '__mocks__/server.js',
    // Nested, and Windows separators.
    'packages/core/examples/basic/index.js',
    'examples\\abort-controller\\server.js',
  ];

  for (const p of ILLUSTRATIONS) {
    it(`illustration: ${p}`, () => assert.strictEqual(isIllustrationPath(p), true));
  }
});

describe('scan-scope — harness pages are not user-facing', () => {
  const HARNESS = [
    'test/index.html',
    'tests/runner.html',
    'spec/index.html',
    '__tests__/page.tsx',
    'perf/index.html',
    'bench/index.html',
    'benchmarks/suite.html',
    'e2e/fixtures/page.html',
    'cypress/support/index.html',
    'playwright/pages/index.html',
  ];

  for (const p of HARNESS) {
    it(`not a user-facing page: ${p}`, () => {
      assert.strictEqual(isNonUserFacingPage(p), true);
    });
    it(`but still part of the application: ${p}`, () => {
      // A harness is code we ship checks against; it is not an illustration.
      // Keeping these separate is why authBypass and secrets are unaffected
      // by the presentation-module scoping.
      if (!/^(fixtures|__fixtures__|e2e\/fixtures)/.test(p.replace(/\\/g, '/'))) {
        assert.strictEqual(isIllustrationPath(p), false);
      }
    });
  }
});

describe('scan-scope — real application code is STILL scanned', () => {
  // The half that stops these predicates from becoming a blanket mute.
  // Every one of these CONTAINS an excluded word without being that directory.
  const APPLICATION = [
    'src/index.js',
    'app/routes/account.js',
    'lib/adapters/http.js',
    'website/app/page.tsx',
    // Segment-anchored: the loose `includes('test')` checks elsewhere in this
    // codebase also match these, which is exactly the mistake not to repeat.
    'src/latest/index.js',
    'src/exampleService/routes.js',
    'src/demos.js',
    'lib/sampler/routes.js',
    'src/testimonials/page.tsx',
    'src/contest/index.js',
    'app/perfect-forward/index.js',
    'src/benchmarking.js',
    'components/SpecSheet.tsx',
  ];

  for (const p of APPLICATION) {
    it(`still scanned as application: ${p}`, () => {
      assert.strictEqual(isIllustrationPath(p), false, `${p} wrongly treated as illustration`);
    });
    it(`still scanned as a page: ${p}`, () => {
      assert.strictEqual(isNonUserFacingPage(p), false, `${p} wrongly treated as non-user-facing`);
    });
  }

  it('empty and nullish input is not silently excluded', () => {
    for (const v of ['', null, undefined]) {
      assert.strictEqual(isIllustrationPath(v), false);
      assert.strictEqual(isNonUserFacingPage(v), false);
    }
  });
});

// A SPA shell (Angular / React index.html) has nothing to score: the
// application renders the page at runtime. CleanArchitecture's two shells
// produced 26 of its 39 blocking findings (2026-09-05).
describe('scan-scope — SPA shells are not pages', () => {
  const { isSpaShell } = require('../src/core/scan-scope');
  it('recognises Angular and React shells', () => {
    assert.strictEqual(isSpaShell('<!doctype html><html><head><title>x</title></head><body><app-root></app-root><script src="main.js"></script></body></html>'), true);
    assert.strictEqual(isSpaShell('<html><head></head><body>\n  <div id="root"></div>\n  <noscript>Enable JS</noscript>\n</body></html>'), true);
  });
  it('a real page with content is still a page', () => {
    assert.strictEqual(isSpaShell('<html><head></head><body><div id="root"><h1>Pricing</h1><p>Three tiers, one gate, no per-seat licensing anywhere.</p></div></body></html>'), false);
    assert.strictEqual(isSpaShell('<html><head></head><body><main><h1>Docs</h1></main></body></html>'), false);
  });
});

describe('scan-scope — Go testdata and Maven/Gradle test-resources are harness dirs', () => {
  const { isNonUserFacingPage } = require('../src/core/scan-scope');
  it('are not user-facing', () => {
    assert.strictEqual(isNonUserFacingPage('ktor-server/core/jvm/test-resources/testdir/test.html'), true);
    assert.strictEqual(isNonUserFacingPage('pkg/parser/testdata/page.html'), true);
    assert.strictEqual(isNonUserFacingPage('lib/test_fixtures/a.html'), true);
  });
  it('a directory that merely starts with "test" is', () => {
    assert.strictEqual(isNonUserFacingPage('src/testimonials/index.html'), false);
  });
});
