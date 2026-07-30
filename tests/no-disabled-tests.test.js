'use strict';

// ============================================================================
// TRIPWIRE — no disabled test files may sit in the repo
// ============================================================================
// `node --test tests/*.test.js` does not match `*.test.skip.js`, so a renamed
// test file stops running and nothing complains. Four of them had accumulated
// (cross-repo-lookup, datadog-client, incremental-filter, mcp-server). Every
// one had drifted into asserting behaviour that no longer existed:
//
//   - datadog-client's had been written against an API that was later replaced
//     wholesale (extractStackFrames/normaliseEvent → extractSourceLocation).
//   - cross-repo-lookup's asserted prior-art wording that had changed, plus an
//     anti-template guard that had been REMOVED from the source — the disabled
//     file was the only remaining record that the guard ever existed.
//   - mcp-server's was superseded by tests/heavy/mcp-server.test.js.
//
// The damage is not the lost coverage, it is the ambiguity: a disabled file
// looks like coverage during triage. One of them cost a session real time
// before being identified as a corpse.
//
// So: a test file is either running or gone. If you need to park one, fix it or
// delete it — do not rename it out of the glob.
//
// Bible: "Never skip tests for 'speed'. Untested code does not exist."
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;

// Patterns that hide a test file from the runner's glob.
const DISABLED_PATTERNS = [
  /\.test\.skip\.[cm]?js$/,
  /\.test\.[cm]?js\.skip$/,
  /\.test\.disabled\.[cm]?js$/,
  /\.skip\.test\.[cm]?js$/,
  /\.test\.[cm]?js\.(bak|old|orig)$/,
];

/** Every file under tests/, recursively, as a repo-relative path. */
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

test('no disabled test files are parked in tests/', () => {
  const files = walk(TESTS_DIR);
  const disabled = files
    .map((f) => path.relative(TESTS_DIR, f).split(path.sep).join('/'))
    .filter((rel) => DISABLED_PATTERNS.some((p) => p.test(rel)))
    .sort();

  assert.deepEqual(
    disabled,
    [],
    `Disabled test file(s) found — a test file is either running or gone:\n` +
      disabled.map((d) => `  tests/${d}`).join('\n') +
      `\n\nFix it and rename it back into the *.test.js glob, or delete it. ` +
      `Do not leave it parked: during triage a disabled file reads as coverage ` +
      `that does not exist, and its assertions silently drift out of date.`
  );
});

test('the tripwire is actually looking at test files (anti-vacuity)', () => {
  // Guard against the walk silently returning nothing — the failure mode where
  // this whole file passes while checking an empty list.
  const files = walk(TESTS_DIR);
  const liveTests = files.filter((f) => /\.test\.[cm]?js$/.test(f));
  assert.ok(
    liveTests.length > 50,
    `expected to see the real test suite, found only ${liveTests.length} test files`
  );
  // And that the patterns match what they claim to.
  assert.ok(DISABLED_PATTERNS.some((p) => p.test('foo.test.skip.js')));
  assert.ok(DISABLED_PATTERNS.some((p) => p.test('foo.test.js.skip')));
  assert.ok(!DISABLED_PATTERNS.some((p) => p.test('foo.test.js')));
  assert.ok(!DISABLED_PATTERNS.some((p) => p.test('skip-logic.test.js')));
});
