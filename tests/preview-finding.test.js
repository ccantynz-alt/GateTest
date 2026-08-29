'use strict';

/**
 * Regression tests for the free preview scan's finding shaper
 * (`website/app/lib/preview-finding.ts`, used by `POST /api/scan/preview`).
 *
 * THE BUG BEING PREVENTED (found 2026-08-29 against LIVE production):
 *   Every finding the live endpoint returned came back `"file": null,
 *   "line": null`, with the path still glued to the front of the message.
 *   The route carried a PRIVATE copy of `parseDetail` whose regex required a
 *   `:<line>` segment before it would attribute a file — but measured across
 *   `website/app/lib/scan-modules/*.ts`, only 15 of 86 detail templates emit
 *   a line number while 57 emit `path: message` with none.
 *
 *   So the structured `file`/`line` fields the API advertises were null for
 *   effectively every real finding, while the canonical extractor in
 *   `issue-extractor.ts` had already handled this shape for the scan-status
 *   page and the admin Command Center. One shared concern, two
 *   implementations, fixed in only one — the KI #77 `TEST_PATH_RE` pattern.
 *
 * The tests below assert BOTH directions, because a parser that attributes a
 * file to everything is just as wrong as one that attributes it to nothing:
 *   - POSITIVE controls: the real emitted shapes DO get a file.
 *   - NEGATIVE controls: details with no real file (`Circular import: ...`,
 *     `BROKEN LINK (404): ...`, `layout/page: ...`) stay `file: null`.
 *   - RATCHET: the route and the helper must not grow a private filename
 *     regex again.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Load the REAL `.ts` module — no CommonJS shim.
 *
 * Two things are in the way, and both are solved here rather than by
 * re-implementing the logic in the test:
 *
 *  1. Type-stripping: Node >= 22.18 executes `.ts` directly.
 *  2. Extensionless sibling imports: `preview-finding.ts` imports
 *     `"./issue-extractor"`, which webpack/Turbopack resolve but Node's ESM
 *     resolver does not. `module.registerHooks()` (Node >= 22.15, synchronous
 *     and in-process) appends the extension for us.
 *
 * A shim would defeat the purpose of this file: the bug under test was two
 * copies of one parser drifting apart. A test that exercises a third copy
 * could not have caught it.
 */
let parseDetail, classifySeverity;
let loadError = null;
try {
  const mod = require('node:module');
  if (typeof mod.registerHooks === 'function') {
    mod.registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && !/\.[mc]?[jt]sx?$/.test(specifier)) {
          const parent = context.parentURL || '';
          if (parent.includes('/website/app/')) {
            const candidate = new URL(specifier + '.ts', parent);
            if (fs.existsSync(candidate)) {
              return { url: candidate.href, shortCircuit: true };
            }
          }
        }
        return nextResolve(specifier, context);
      },
    });
  }
  ({ parseDetail, classifySeverity } = require(
    path.join(ROOT, 'website/app/lib/preview-finding.ts')
  ));
} catch (err) {
  loadError = err;
}

if (!parseDetail) {
  // Only tolerate the ONE environmental cause (a runtime too old to strip
  // types). Any other failure is a real defect and must fail the suite —
  // a blanket catch here is how the original bug stayed invisible.
  const environmental =
    /Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION|SyntaxError/i.test(
      String(loadError && (loadError.code || loadError.message))
    );
  if (environmental) {
    test('preview-finding suite skipped — runtime cannot execute .ts (needs Node >= 22.18)', { skip: true }, () => {});
    return;
  }
  throw loadError;
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS — real emitted shapes must be attributed to a file.
// Each string below is a real template from website/app/lib/scan-modules/*.ts
// with its interpolations filled in.
// ---------------------------------------------------------------------------

test('the live production shape — `path: message`, no line number — attributes a file', () => {
  const r = parseDetail(
    'examples/error/index.js: contains console.log/debug/info call',
    'codeQuality'
  );
  assert.equal(r.file, 'examples/error/index.js');
  assert.equal(r.line, null);
  assert.equal(r.message, 'contains console.log/debug/info call');
  // The path must NOT still be glued to the front of the message.
  assert.ok(!r.message.startsWith('examples/'), 'path leaked into message');
});

test('the second live shape — legacy var declaration — attributes a file', () => {
  const r = parseDetail(
    "examples/auth/index.js: uses legacy 'var' declaration",
    'lint'
  );
  assert.equal(r.file, 'examples/auth/index.js');
  assert.equal(r.message, "uses legacy 'var' declaration");
});

test('classic `path:LINE: message` still parses (regression on the old behaviour)', () => {
  const r = parseDetail('src/foo.ts:42: bad thing', 'lint');
  assert.equal(r.file, 'src/foo.ts');
  assert.equal(r.line, 42);
  assert.equal(r.message, 'bad thing');
});

test('a leading severity prefix is stripped before the filename is matched', () => {
  const r = parseDetail('error: src/api.ts: strict: false', 'infra');
  assert.equal(r.file, 'src/api.ts');
  assert.equal(r.message, 'strict: false');
  assert.equal(r.severity, 'error');
});

test('extensionless conventional filenames (Dockerfile) are attributed', () => {
  const r = parseDetail(
    'Dockerfile: no non-root USER directive — container runs as root by default',
    'iac'
  );
  assert.equal(r.file, 'Dockerfile');
  assert.ok(r.message.startsWith('no non-root USER'));
});

test('package.json sub-key shape keeps the sub-key in the message', () => {
  const r = parseDetail(
    'package.json scripts.postinstall: matches "curl pipe to shell" — review for supply-chain risk',
    'supplyChain'
  );
  assert.equal(r.file, 'package.json');
  assert.ok(r.message.startsWith('scripts.postinstall:'), r.message);
});

test('a `[tag]` prefix is stripped before the filename is matched', () => {
  const r = parseDetail('[secrets] config/prod.yml: committed sensitive file', 'secrets');
  assert.equal(r.file, 'config/prod.yml');
  assert.equal(r.message, 'committed sensitive file');
});

test('the internal CREATE_FILE marker is never shown to a customer', () => {
  const r = parseDetail('missing README.md', 'docs');
  assert.equal(r.file, 'README.md');
  assert.ok(!r.message.includes('CREATE_FILE'), `marker leaked: ${r.message}`);
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROLS — details with no real file must NOT be given one.
// Without these, "attribute everything" would pass the positive tests.
// ---------------------------------------------------------------------------

test('a circular-import finding names no single file', () => {
  const r = parseDetail('error: Circular import: a → b', 'importCycle');
  assert.equal(r.file, null, `misattributed to ${r.file}`);
});

test('a broken-link finding names a URL, not a file', () => {
  const r = parseDetail('error: BROKEN LINK (404): https://example.com/x', 'links');
  assert.equal(r.file, null, `misattributed to ${r.file}`);
});

test('a route-shaped label (`layout/page`) is not a file', () => {
  const r = parseDetail('layout/page: missing Open Graph tag og:title', 'seo');
  assert.equal(r.file, null, `misattributed to ${r.file}`);
});

test('a directory-scoped finding (`public/`) is not a file', () => {
  const r = parseDetail(
    'public/: 12 raster images — consider next/image optimization',
    'performance'
  );
  assert.equal(r.file, null, `misattributed to ${r.file}`);
});

test('an env-var finding names a variable, not a file', () => {
  const r = parseDetail(
    'error: DATABASE_URL used in code but missing from .env.example',
    'envVars'
  );
  assert.equal(r.file, null, `misattributed to ${r.file}`);
});

// ---------------------------------------------------------------------------
// ROBUSTNESS — the shaper must never throw; it runs inside a route whose
// contract is "always 200, never a stacktrace".
// ---------------------------------------------------------------------------

test('non-string input is coerced, not thrown on', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const r = parseDetail(bad, 'mod');
    assert.equal(typeof r.message, 'string');
    assert.equal(r.module, 'mod');
    assert.ok(['error', 'warning', 'info'].includes(r.severity));
  }
});

test('an empty detail yields an empty message and no file', () => {
  const r = parseDetail('', 'mod');
  assert.equal(r.file, null);
  assert.equal(r.message, '');
});

test('classifySeverity reads the RAW string, before prefixes are stripped', () => {
  assert.equal(classifySeverity('error: src/x.ts: bad'), 'error');
  assert.equal(classifySeverity('warning: src/x.ts: meh'), 'warning');
  assert.equal(classifySeverity('info: src/x.ts: fyi'), 'info');
  assert.equal(classifySeverity(42), 'warning');
});

// ---------------------------------------------------------------------------
// SEVERITY — the file path must never decide it, and the module must.
//
// Measured on 2026-08-29: the keyword heuristic ran against the raw string,
// which starts with the path, so `examples/error/index.js` was escalated to
// error while the identical finding in `examples/auth/index.js` was a
// warning. Errors sort first, so the inflated ones led the free preview.
// ---------------------------------------------------------------------------

test('the SAME finding gets the SAME severity regardless of its file path', () => {
  const rule = "uses legacy 'var' declaration";
  const paths = [
    'examples/error/index.js', // the express path that exposed this
    'examples/auth/index.js',
    'src/fail/retry.js',
    'lib/secret.js',
    'app/credential.ts',
    'src/hardcoded.js',
    'src/ordinary.js',
  ];
  const severities = new Set(
    paths.map((p) => parseDetail(`${p}: ${rule}`, 'codeQuality').severity)
  );
  assert.equal(
    severities.size,
    1,
    `path changed the severity of an identical finding: ${JSON.stringify(
      paths.map((p) => [p, parseDetail(`${p}: ${rule}`, 'codeQuality').severity])
    )}`
  );
  assert.equal([...severities][0], 'warning');
});

test('every finding the secrets module can emit is an error', () => {
  // The full SECRET_PATTERNS name list from scan-modules/security-data.ts,
  // plus the committed-sensitive-file shape. All are leaked credentials.
  const secretFindings = [
    'Stripe live key',
    'Stripe test key',
    'GitHub personal access token',
    'AWS access key id',
    'AWS secret access key',
    'OpenAI key',
    'Anthropic key',
    'Google API key',
    'Slack token',
    'Private key block',
    'Hardcoded password',
    'DB connection string with inline credentials',
  ];
  for (const name of secretFindings) {
    const r = parseDetail(`src/config.ts: ${name}`, 'secrets');
    assert.equal(
      r.severity,
      'error',
      `leaked credential shown as ${r.severity}: ${name}`
    );
  }
  const sensitiveFile = parseDetail(
    'config/prod.pem: committed sensitive file (prod.pem)',
    'secrets'
  );
  assert.equal(sensitiveFile.severity, 'error');
});

test('syntax findings are errors — the file does not parse', () => {
  for (const d of [
    'src/a.ts: brace imbalance (3 open vs 1 close)',
    'src/b.ts: unterminated template literal (5 backticks)',
    'package.json: invalid JSON (Unexpected token })',
  ]) {
    assert.equal(parseDetail(d, 'syntax').severity, 'error', d);
  }
});

test('an explicit severity prefix still overrides the module', () => {
  // A module in the always-error set may still downgrade a specific finding
  // by saying so — the explicit marker is the most authoritative signal.
  assert.equal(parseDetail('info: src/x.ts: fyi', 'secrets').severity, 'info');
  assert.equal(parseDetail('warning: src/x.ts: meh', 'syntax').severity, 'warning');
});

test('ordinary style findings are not escalated to error', () => {
  for (const d of [
    'src/a.ts: 520 lines (>500)',
    'src/b.ts: 3 lines with trailing whitespace',
    'src/c.ts: contains TODO/FIXME/HACK/XXX marker',
    'src/d.ts: uses loose equality (== or !=) instead of === / !==',
  ]) {
    assert.equal(parseDetail(d, 'codeQuality').severity, 'warning', d);
  }
});

test('a genuine keyword in the MESSAGE still escalates', () => {
  // The heuristic must keep working where it is actually justified.
  assert.equal(parseDetail('src/api.ts: hardcoded API key', 'lint').severity, 'error');
  assert.equal(
    parseDetail('src/db.ts: SQL injection risk in raw query', 'lint').severity,
    'error'
  );
  assert.equal(
    parseDetail('src/x.ts: known vulnerability in transitive dep', 'lint').severity,
    'error'
  );
});

// ---------------------------------------------------------------------------
// RATCHET — file attribution has exactly ONE definition in the codebase.
// This is the guard that would have caught the original drift.
// ---------------------------------------------------------------------------

test('the preview route defines no parser of its own — it delegates', () => {
  const route = fs.readFileSync(
    path.join(ROOT, 'website/app/api/scan/preview/route.ts'),
    'utf8'
  );
  assert.ok(
    !/function\s+parseDetail/.test(route),
    'preview/route.ts re-declared parseDetail — import it from ' +
      'app/lib/preview-finding instead. A private copy is exactly how the ' +
      'file:null bug shipped to production.'
  );
  assert.ok(
    !/function\s+classifySeverity/.test(route),
    'preview/route.ts re-declared classifySeverity — import it instead.'
  );
});

test('the preview shaper carries no filename regex of its own', () => {
  const helper = fs.readFileSync(
    path.join(ROOT, 'website/app/lib/preview-finding.ts'),
    'utf8'
  );
  // A filename-matching regex is one containing an escaped dot followed by a
  // character-class extension quantifier — the shape of every copy so far.
  assert.ok(
    !/\\\.\[[A-Za-z0-9\\w|-]+\]\{\d/.test(helper),
    'preview-finding.ts grew its own filename regex — file attribution must ' +
      'stay delegated to app/lib/issue-extractor.ts (one definition).'
  );
  assert.ok(
    /from "\.\/issue-extractor"/.test(helper),
    'preview-finding.ts must import the canonical extractor.'
  );
});

test('only ONE module in the website defines a parseDetail', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        if (/(?:export\s+)?function\s+parseDetail\s*\(/.test(src)) {
          hits.push(path.relative(ROOT, full).replace(/\\/g, '/'));
        }
      }
    }
  };
  walk(path.join(ROOT, 'website/app'));
  assert.deepEqual(
    hits.sort(),
    ['website/app/lib/issue-extractor.ts', 'website/app/lib/preview-finding.ts'],
    'a new parseDetail appeared. issue-extractor.ts owns file attribution; ' +
      'preview-finding.ts only re-shapes its result. Any third copy will ' +
      'drift exactly like the preview route did.'
  );
});
