'use strict';

// ============================================================================
// VERSION SYNC — one version, derived everywhere it is shown
// ============================================================================
// Found 2026-07-30 by driving the MCP server end-to-end over JSON-RPC rather
// than reading it: `initialize` answered "gatetest 1.59.0" and check_health
// printed "GateTest MCP — v1.59.0", while package.json said 1.60.0 and the
// Bible declared v1.61.0. Three different answers to "what version is this",
// and the MCP one is customer-visible — it is what an MCP client displays.
//
// Root cause was two hardcoded literals. The fix was to derive from
// package.json; this test is what stops it drifting again.
//
// Bible, THE WEBSITE-SYNC RULE: "Prefer generated values over hardcoded ones,
// so the sync cannot rot." Remembering a rule is weaker than a test that fails.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');

test('package.json version matches the version the Bible declares', () => {
  const bible = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
  const m = bible.match(/^GateTest v(\d+\.\d+\.\d+)/m);
  assert.ok(m, 'could not find a "GateTest vX.Y.Z" declaration in CLAUDE.md');

  assert.equal(
    pkg.version,
    m[1],
    `package.json says ${pkg.version} but CLAUDE.md's VERSION section declares ${m[1]}. ` +
      'Forbidden #17 makes the Bible the source of truth for the release; bump package.json ' +
      'in the same commit as the VERSION section.'
  );
});

test('the MCP server derives its version instead of hardcoding one', () => {
  // The two literals this replaced were two releases stale and shown to users.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'bin/gatetest-mcp.mjs'), 'utf8');

  const offenders = src
    .split('\n')
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    // A version literal in executable code. Comments explaining the history are fine.
    .filter(({ line }) => /v?\d+\.\d+\.\d+/.test(line))
    .filter(({ line }) => !(line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')))
    // Only care about it being presented as OUR version.
    .filter(({ line }) => /version\s*:\s*['"`]\d+\.\d+\.\d+['"`]|GateTest MCP — v\d/.test(line));

  assert.deepEqual(
    offenders.map((o) => `${o.no}: ${o.line}`),
    [],
    'hardcoded version in bin/gatetest-mcp.mjs — use PKG_VERSION (read from package.json)'
  );
});

test('the derived version is actually what the server would report', () => {
  // Anti-vacuity: the test above passes trivially if PKG_VERSION were missing
  // altogether. Assert the wiring exists and resolves to the real version.
  const src = fs.readFileSync(path.join(REPO_ROOT, 'bin/gatetest-mcp.mjs'), 'utf8');
  assert.match(src, /const PKG_VERSION = require\('\.\.\/package\.json'\)\.version;/);
  assert.match(src, /version: PKG_VERSION/);
  assert.match(src, /GateTest MCP — v\$\{PKG_VERSION\}/);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});
