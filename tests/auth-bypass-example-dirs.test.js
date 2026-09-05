// =============================================================================
// AUTH-BYPASS — example/demo directories are not an attack surface
// =============================================================================
// Measured 2026-09-01, full-suite scan of expressjs/express @023767f (a clean,
// widely-used third-party repo): authBypass produced 12 findings and ALL 12
// were in `examples/` — hello-world, error-pages, markdown, view-locals. It
// reported `GET /` in `examples/hello-world/index.js` as an unprotected route.
//
// That is 100% of this module's output on that repo being noise, and 9% of the
// repo's entire warning volume. Warnings do not block, but volume on clean code
// is how a tool teaches developers to stop reading it.
//
// The lesson already existed in the codebase: src/modules/security.js excludes
// examples/samples/demos and its comment names this very repo. This module
// never got it. These tests keep it.
//
// The exclusion is segment-anchored, and the negative controls below are the
// point: `src/exampleService/` and `src/demos.js` must STILL be scanned. The
// existing loose checks in this file (`lower.includes('test')`) match
// `src/latest/` too, and widening this one the same way would silence real
// routes.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AuthBypassModule = require('../src/modules/auth-bypass');

/** An Express route with no auth middleware — a finding wherever it counts. */
const UNPROTECTED_ROUTE = [
  "const express = require('express');",
  'const app = express();',
  "app.get('/account/settings', (req, res) => {",
  '  res.json({ ok: true });',
  '});',
  'module.exports = app;',
  '',
].join('\n');

async function scanWith(relFile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-authbypass-ex-'));
  try {
    const full = path.join(root, relFile);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, UNPROTECTED_ROUTE);

    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    await new AuthBypassModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('auth-bypass — illustrations are excluded', () => {
  const EXCLUDED = [
    'examples/hello-world/index.js',
    'example/index.js',
    'samples/api/index.js',
    'demo/index.js',
    'demos/server/index.js',
    'fixtures/app.js',
    '__mocks__/server.js',
  ];

  for (const rel of EXCLUDED) {
    it(`silent in ${rel}`, async () => {
      const findings = await scanWith(rel);
      assert.deepStrictEqual(
        findings.map((f) => f.id), [],
        `${rel} is illustration code and must not be reported`,
      );
    });
  }
});

describe('auth-bypass — real application code still reported', () => {
  // The load-bearing half. Without these, the exclusion could be widened to
  // silence everything and the suite would still pass — indistinguishable
  // from the module working.
  const SCANNED = [
    'src/routes/account.js',
    'app/routes/settings.js',
    'server/api/account.js',
    // Segment-anchored: these CONTAIN an excluded word but are not those dirs.
    'src/exampleService/routes.js',
    'src/demos.js',
    'lib/sampler/routes.js',
  ];

  for (const rel of SCANNED) {
    it(`still fires in ${rel}`, async () => {
      const findings = await scanWith(rel);
      assert.ok(
        findings.length > 0,
        `${rel} is application code — an unprotected /account/settings route must still be reported`,
      );
    });
  }
});

// Move 10 (2026-09-05): the exempt-path check used `lower.includes('test')`
// and `includes('spec')`, so src/latest/, contest/, attestation.js and
// inspect.js were never checked for missing auth at all. Segment-anchored
// now; these must FIRE.
describe('auth-bypass — "test" inside a word is not a test dir', () => {
  for (const rel of ['src/latest/routes.js', 'src/contest/entry.js', 'src/attestation.js', 'src/inspect.js']) {
    it(`reports the unprotected route in ${rel}`, async () => {
      const findings = await scanWith(rel);
      assert.ok(findings.length > 0, `${rel} was exempted from the auth check`);
    });
  }
  for (const rel of ['tests/routes.test.js', 'src/__tests__/app.js', 'spec/app.js']) {
    it(`still silent in ${rel}`, async () => {
      const findings = await scanWith(rel);
      assert.strictEqual(findings.length, 0, `${rel}: ${findings.map((f) => f.id).join(', ')}`);
    });
  }
});
