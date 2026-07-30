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

test('no website page hardcodes a GateTest version string', () => {
  // /developers showed "GateTest v1.59.0 — 121 modules" in its terminal demo
  // while the CLI printed v1.61.0. It now reads both from the generated
  // site-stats.json, the same mechanism the module count already uses.
  const appDir = path.join(REPO_ROOT, 'website', 'app');
  const offenders = [];

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        walk(full);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(e.name)) continue;
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      // scans/page.tsx records dated measurements — a version there is evidence
      // of what ran that day, not a claim about the current release.
      if (rel === 'website/app/scans/page.tsx') continue;

      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
        if (/GateTest v\d+\.\d+\.\d+/.test(t)) offenders.push(`${rel}:${i + 1}: ${t.slice(0, 90)}`);
      });
    }
  };
  walk(appDir);

  assert.deepEqual(
    offenders,
    [],
    'hardcoded GateTest version in website copy — read siteStats.version from app/data/site-stats.json'
  );
});

test('reporters derive the tool version instead of hardcoding one', () => {
  // The SARIF driver version is displayed next to every alert in GitHub
  // Security and was pinned at '1.1.0'; the JSON report claimed '1.0.0'.
  // Both are the TOOL version. The one hardcoded version that must stay is the
  // SARIF SPEC version (2.1.0) — that describes the file format, not us.
  const SARIF_SPEC_VERSION = '2.1.0';
  const dir = path.join(REPO_ROOT, 'src', 'reporters');
  const offenders = [];

  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const rel = `src/reporters/${name}`;
    fs.readFileSync(path.join(dir, name), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
      const m = t.match(/version:\s*['"](\d+\.\d+\.\d+)['"]/);
      if (!m) return;
      if (m[1] === SARIF_SPEC_VERSION) return; // the format's own version
      offenders.push(`${rel}:${i + 1}: ${t.slice(0, 80)}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'hardcoded tool version in a reporter — use PKG_VERSION from package.json'
  );
});

test('the SARIF spec version is still pinned (it must NOT track our version)', () => {
  // Anti-overcorrection: the guard above exempts 2.1.0, so make sure the
  // exemption is still doing something and nobody "helpfully" derived it.
  //
  // Scanned over EXECUTABLE lines only. A whole-file `assert.match` passed
  // this test while the real declaration had been replaced, because the
  // explanatory comment above it also contains the literal — the guard was
  // satisfied by prose. Caught by a positive control that survived.
  const lines = fs
    .readFileSync(path.join(REPO_ROOT, 'src/reporters/sarif-reporter.js'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !(l.startsWith('*') || l.startsWith('//') || l.startsWith('/*')));

  assert.ok(
    lines.some((l) => /^version:\s*'2\.1\.0',?$/.test(l)),
    'SARIF output must declare spec version 2.1.0 in code, not only in a comment'
  );
  assert.ok(
    lines.some((l) => /^version: PKG_VERSION,?$/.test(l)),
    'the driver version must be derived from package.json'
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
