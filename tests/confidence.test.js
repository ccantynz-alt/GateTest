'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CONFIDENCE,
  BLOCK_THRESHOLD,
  DEFAULT_RULE_OVERRIDES,
  scoreFinding,
  isBlockingFinding,
  _signals,
} = require('../src/core/confidence');

// ─── constants ──────────────────────────────────────────────────────────────

test('DEFAULT_CONFIDENCE is 1.0', () => {
  assert.equal(DEFAULT_CONFIDENCE, 1.0);
});

test('BLOCK_THRESHOLD is 0.7', () => {
  assert.equal(BLOCK_THRESHOLD, 0.7);
});

test('DEFAULT_RULE_OVERRIDES is frozen', () => {
  assert.ok(Object.isFrozen(DEFAULT_RULE_OVERRIDES));
});

// ─── individual signals ─────────────────────────────────────────────────────

test('isDocFile fires on .md / .mdx / .rst', () => {
  assert.ok(_signals.isDocFile('README.md'));
  assert.ok(_signals.isDocFile('docs/guide.mdx'));
  assert.ok(_signals.isDocFile('manual.rst'));
  assert.equal(_signals.isDocFile('src/index.js'), null);
});

test('isTestFile fires on tests/, *.test.*, *.spec.*, __tests__/', () => {
  assert.ok(_signals.isTestFile('tests/foo.test.js'));
  assert.ok(_signals.isTestFile('src/foo.test.ts'));
  assert.ok(_signals.isTestFile('src/foo.spec.js'));
  assert.ok(_signals.isTestFile('src/__tests__/foo.js'));
  assert.equal(_signals.isTestFile('src/index.js'), null);
});

test('isFixtureFile fires on fixtures/, __fixtures__/, test-data/, mocks/, stubs/', () => {
  assert.ok(_signals.isFixtureFile('tests/fixtures/data.json'));
  assert.ok(_signals.isFixtureFile('src/__fixtures__/a.js'));
  assert.ok(_signals.isFixtureFile('test-data/sample.json'));
  assert.ok(_signals.isFixtureFile('src/mocks/server.js'));
  assert.ok(_signals.isFixtureFile('test/stubs/x.js'));
  assert.equal(_signals.isFixtureFile('src/index.js'), null);
});

test('isExampleDataFile fires on example*, sample*, demo*, docs/', () => {
  assert.ok(_signals.isExampleDataFile('docs/api.md'));
  assert.ok(_signals.isExampleDataFile('examples/basic.js'));
  assert.ok(_signals.isExampleDataFile('sample-config.json'));
  assert.ok(_signals.isExampleDataFile('demo-app.js'));
  assert.equal(_signals.isExampleDataFile('src/index.js'), null);
});

test('isHomeworkDir fires on node_modules, dist, build, .next, coverage, vendor', () => {
  assert.ok(_signals.isHomeworkDir('node_modules/foo/index.js'));
  assert.ok(_signals.isHomeworkDir('dist/main.js'));
  assert.ok(_signals.isHomeworkDir('build/out.js'));
  assert.ok(_signals.isHomeworkDir('website/.next/static/x.js'));
  assert.ok(_signals.isHomeworkDir('coverage/lcov.info'));
  assert.ok(_signals.isHomeworkDir('vendor/lib.js'));
  assert.equal(_signals.isHomeworkDir('src/index.js'), null);
});

test('isInsideBlockComment detects target line inside block comment', () => {
  const src = 'const a = 1;\n/* this is a\n  multi-line comment\n*/\nconst b = 2;';
  // Line 3 is inside the block comment
  assert.ok(_signals.isInsideBlockComment(src, 3));
  // Line 1 is not
  assert.equal(_signals.isInsideBlockComment(src, 1), null);
  // Line 5 is after the comment closes
  assert.equal(_signals.isInsideBlockComment(src, 5), null);
});

test('isInsideBlockComment detects line-comment-only lines', () => {
  const src = 'const a = 1;\n// just a comment\nconst b = 2;';
  assert.ok(_signals.isInsideBlockComment(src, 2));
});

test('isInsideStringLiteral with column detects string position', () => {
  const src = 'const url = "http://localhost:3000";';
  // Column 20 is inside the string
  assert.ok(_signals.isInsideStringLiteral(src, 1, 20));
  // Column 0 is not
  assert.equal(_signals.isInsideStringLiteral(src, 1, 0), null);
});

test('isInsideStringLiteral conservatively flags doc-string-shape lines', () => {
  // Line is dominated by a string literal (no executable receiver)
  const src = '  "NEXT_PUBLIC_ANTHROPIC_API_KEY in browser bundle",';
  assert.ok(_signals.isInsideStringLiteral(src, 1));
});

test('looksLikeUserFacingDocString fires on doc-shaped messages', () => {
  assert.ok(_signals.looksLikeUserFacingDocString(
    'NEXT_PUBLIC_API_KEY in browser bundle',
  ));
  assert.ok(_signals.looksLikeUserFacingDocString('Should not be committed'));
  assert.ok(_signals.looksLikeUserFacingDocString('Example of bad code'));
  assert.equal(
    _signals.looksLikeUserFacingDocString('Found hardcoded URL'),
    null,
  );
});

// ─── scoreFinding ───────────────────────────────────────────────────────────

test('scoreFinding on a normal source file returns 1.0', () => {
  const { confidence, signals } = scoreFinding({
    filePath: 'src/index.js',
    ruleKey: 'something',
    message: 'Found a real bug',
  });
  assert.equal(confidence, 1.0);
  assert.deepEqual(signals, []);
});

test('scoreFinding on a .md file returns ≤ 0.5', () => {
  const { confidence } = scoreFinding({
    filePath: 'README.md',
    ruleKey: 'something',
  });
  assert.ok(confidence <= 0.5, `expected <= 0.5, got ${confidence}`);
});

test('scoreFinding on a test file returns ≤ 0.7', () => {
  const { confidence } = scoreFinding({
    filePath: 'tests/foo.test.js',
    ruleKey: 'something',
  });
  assert.ok(confidence <= 0.7, `expected <= 0.7, got ${confidence}`);
});

test('scoreFinding on a fixture returns ≤ 0.5', () => {
  const { confidence } = scoreFinding({
    filePath: 'tests/fixtures/sample.json',
    ruleKey: 'something',
  });
  assert.ok(confidence <= 0.5, `expected <= 0.5, got ${confidence}`);
});

test('scoreFinding inside block comment returns ≤ 0.3', () => {
  const src = 'const a = 1;\n/*\n  http://localhost:3000\n*/\nconst b = 2;';
  const { confidence } = scoreFinding({
    filePath: 'src/index.js',
    ruleKey: 'hardcoded-url',
    line: 3,
    sourceText: src,
  });
  assert.ok(confidence <= 0.3, `expected <= 0.3, got ${confidence}`);
});

test('scoreFinding inside string literal returns ≤ 0.5', () => {
  // Conservative no-column detection: pattern-like doc string
  const src = '  "NEXT_PUBLIC_ANTHROPIC_API_KEY",';
  const { confidence } = scoreFinding({
    filePath: 'src/modules/prompt-safety.js',
    ruleKey: 'prompt-safety:public-api-key',
    line: 1,
    sourceText: src,
  });
  assert.ok(confidence <= 0.5, `expected <= 0.5, got ${confidence}`);
});

test('scoreFinding multiple signals stack multiplicatively', () => {
  // .md (0.3) AND doc string message (0.5) => 1.0 * 0.3 * 0.5 = 0.15
  const { confidence, signals } = scoreFinding({
    filePath: 'README.md',
    ruleKey: 'hardcoded-url',
    message: 'in browser bundle',
  });
  assert.ok(confidence < 0.2, `expected < 0.2, got ${confidence}`);
  assert.ok(signals.length >= 2);
});

test('scoreFinding clamps to [0, 1]', () => {
  const { confidence } = scoreFinding({
    filePath: 'node_modules/foo/dist/index.js',
    ruleKey: 'something',
  });
  assert.ok(confidence >= 0);
  assert.ok(confidence <= 1);
});

test('scoreFinding ruleOverrides.ignoreTestPath bypasses the test signal', () => {
  // Without override: confidence drops on test file
  const without = scoreFinding({
    filePath: 'tests/foo.test.js',
    ruleKey: 'unknown-rule',
  });
  assert.ok(without.confidence < 1.0);

  // With override: confidence stays high
  const withOverride = scoreFinding(
    { filePath: 'tests/foo.test.js', ruleKey: 'unknown-rule' },
    { 'unknown-rule': { ignoreTestPath: true } },
  );
  assert.equal(withOverride.confidence, 1.0);
});

test('scoreFinding flakyTests default override ignores test path', () => {
  // flakyTests is supposed to fire on test files
  const { confidence } = scoreFinding({
    filePath: 'tests/foo.test.js',
    ruleKey: 'flakyTests:committed-only:tests/foo.test.js:42',
    module: 'flakyTests',
  });
  assert.equal(confidence, 1.0);
});

test('scoreFinding documentation default override ignores doc files', () => {
  const { confidence } = scoreFinding({
    filePath: 'README.md',
    ruleKey: 'documentation:missing-section',
    module: 'documentation',
  });
  assert.equal(confidence, 1.0);
});

test('scoreFinding with no filePath defaults to 1.0', () => {
  const { confidence } = scoreFinding({
    ruleKey: 'something',
    message: 'config-level finding',
  });
  assert.equal(confidence, 1.0);
});

test('scoreFinding ignores sourceText when no line given', () => {
  const src = '/*\ncommented out\n*/';
  const { confidence } = scoreFinding({
    filePath: 'src/index.js',
    sourceText: src,
  });
  assert.equal(confidence, 1.0);
});

// ─── isBlockingFinding ─────────────────────────────────────────────────────

test('isBlockingFinding: error with confidence 1.0 → blocking', () => {
  assert.equal(
    isBlockingFinding({ passed: false, severity: 'error', confidence: 1.0 }),
    true,
  );
});

test('isBlockingFinding: error with confidence 0.4 → not blocking', () => {
  assert.equal(
    isBlockingFinding({ passed: false, severity: 'error', confidence: 0.4 }),
    false,
  );
});

test('isBlockingFinding: error with no confidence defaults to blocking', () => {
  assert.equal(
    isBlockingFinding({ passed: false, severity: 'error' }),
    true,
  );
});

test('isBlockingFinding: warning is never blocking regardless of confidence', () => {
  assert.equal(
    isBlockingFinding({ passed: false, severity: 'warning', confidence: 1.0 }),
    false,
  );
});

test('isBlockingFinding: passed check is never blocking', () => {
  assert.equal(
    isBlockingFinding({ passed: true, severity: 'error', confidence: 1.0 }),
    false,
  );
});

test('isBlockingFinding: custom threshold raises the bar', () => {
  // 0.8 is above default 0.7 but below 0.9
  assert.equal(
    isBlockingFinding(
      { passed: false, severity: 'error', confidence: 0.8 },
      0.9,
    ),
    false,
  );
  // 0.95 is above 0.9
  assert.equal(
    isBlockingFinding(
      { passed: false, severity: 'error', confidence: 0.95 },
      0.9,
    ),
    true,
  );
});

// ─── PR #85 regression coverage ────────────────────────────────────────────

test('PR #85 regression: NEXT_PUBLIC_* example inside doc string downgrades', () => {
  // The literal pattern string in a module's detection table:
  // `'NEXT_PUBLIC_ANTHROPIC_API_KEY in browser bundle'` matched
  // the public-API-key scanner against itself.
  const src = '  message: "NEXT_PUBLIC_ANTHROPIC_API_KEY in browser bundle",';
  const { confidence } = scoreFinding({
    filePath: 'src/modules/prompt-safety.js',
    ruleKey: 'prompt-safety:public-api-key:src/modules/prompt-safety.js:42',
    module: 'promptSafety',
    message: 'NEXT_PUBLIC_ANTHROPIC_API_KEY in browser bundle',
    line: 1,
    sourceText: src,
  });
  // This should be soft (< 0.7) and not block the gate.
  assert.ok(confidence < 0.7, `expected < 0.7, got ${confidence}`);
});

test('PR #85 regression: localhost example inside comment downgrades', () => {
  const src = '// example: http://localhost:3000';
  const { confidence } = scoreFinding({
    filePath: 'src/index.js',
    ruleKey: 'hardcoded-url:localhost',
    message: 'hardcoded localhost URL',
    line: 1,
    sourceText: src,
  });
  assert.ok(confidence < 0.7, `expected < 0.7, got ${confidence}`);
});

test('PR #85 regression: ephemeral .claude/worktrees path downgrades', () => {
  // The path itself signals "not real code" — vendor/build-output signal
  const { confidence } = scoreFinding({
    filePath: 'node_modules/some-tool/dist/index.js',
    ruleKey: 'hardcoded-url:localhost',
    message: 'hardcoded localhost URL',
  });
  assert.ok(confidence < 0.2, `expected < 0.2, got ${confidence}`);
});

// ---------------------------------------------------------------------------
// Block-comment walker must skip line comments and string literals.
//
// It used to count any `/*` on any preceding line, so a line comment like
// `// The /api/v1/* endpoints ...` or a glob string latched the walker on
// permanently — every finding below it in that file then scored 0.20
// "inside block comment".
//
// That is the FALSE-NEGATIVE direction and it defeats the gate: an
// error-severity finding below the block threshold is downgraded to a
// non-blocking soft error. Measured on GateTest's own repo before the fix —
// 13 findings carried the signal, all 13 were not inside a comment, and one
// was error-severity, i.e. the gate passed something it should have caught.
// Found 2026-07-28 by grouping low-confidence findings by signal.
// ---------------------------------------------------------------------------

function _score(sourceText, line) {
  return scoreFinding({
    filePath: 'src/x.js',
    ruleKey: 'error-swallow:empty-catch',
    module: 'errorSwallow',
    line,
    sourceText,
  });
}
function _insideFlagged(sourceText, line) {
  return (_score(sourceText, line).signals || []).includes('inside block comment');
}

test('block-comment walker: a line comment containing /* does not latch it', () => {
  const src = ['// The /api/v1/* endpoints are public', 'try { g(); } catch {}'].join('\n');
  assert.equal(_insideFlagged(src, 2), false);
  assert.equal(_score(src, 2).confidence, 1);
});

test('block-comment walker: a string containing /* does not latch it', () => {
  const src = ["const glob = 'src/**" + "/*.test.js';", 'try { g(); } catch {}'].join('\n');
  assert.equal(_insideFlagged(src, 2), false);
});

test('block-comment walker: a double-quoted string containing /* does not latch it', () => {
  const src = ['const s = "a /* b";', 'try { g(); } catch {}'].join('\n');
  assert.equal(_insideFlagged(src, 2), false);
});

test('block-comment walker: an escaped quote does not desynchronise tracking', () => {
  // String.raw so the scanned source really contains a backslash-escape;
  // written with a normal escape it collapses and the fixture stops
  // testing what it claims to.
  const src = [String.raw`const s = 'it\'s /* fine';`, 'try { g(); } catch {}'].join('\n');
  assert.ok(src.includes("\\'"), 'fixture must contain a real escaped quote');
  assert.equal(_insideFlagged(src, 2), false);
});

test('block-comment walker: an inline /* */ ON the finding line is not "inside"', () => {
  // `} catch { /* not fatal */ }` is real, executing code.
  const src = ['function f() {', '  try { g(); } catch { /* not fatal */ }', '}'].join('\n');
  assert.equal(_insideFlagged(src, 2), false);
});

test('block-comment walker: code after a CLOSED block comment is not inside it', () => {
  const src = ['/**', ' * docs', ' */', 'try { g(); } catch {}'].join('\n');
  assert.equal(_insideFlagged(src, 4), false);
});

// The detection must still WORK — the fix must not have turned it off.
test('block-comment walker: a finding genuinely inside a block comment is still flagged', () => {
  const src = ['/*', '  try { g(); } catch {}', '*/', 'const a = 1;'].join('\n');
  assert.equal(_insideFlagged(src, 2), true);
  assert.equal(_score(src, 2).confidence, 0.2);
});

test('block-comment walker: a finding inside a JSDoc block is still flagged', () => {
  const src = ['/**', ' * try { g(); } catch {}', ' */', 'const a = 1;'].join('\n');
  assert.equal(_insideFlagged(src, 2), true);
});

test('block-comment walker: the real-world shape that exposed this scores full confidence', () => {
  // Reduced from src/core/doctor.js, where line 247's `/api/v1/*` line
  // comment silently down-weighted every finding below it.
  const src = [
    '// The /api/v1/* endpoints expose GateTest as a platform',
    'function f() {',
    '  try {',
    '    g();',
    '  } catch { /* not fatal */ }',
    '}',
  ].join('\n');
  assert.equal(_score(src, 5).confidence, 1);
});
