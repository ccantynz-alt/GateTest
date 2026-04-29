// ============================================================================
// AI-HANDOFF TEST — pure-function coverage for website/app/lib/ai-handoff.js.
// ============================================================================
// Covers every formatter, the parser, the severity classifier, the
// group-by-file helper, the filter helper, and the dispatch entry-point
// formatHandoff. Anchored on real shapes the scan pipeline actually emits
// so a regression in one of the slicers / parsers / severity heuristics
// shows up here before it ever ships to /scan/status.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SUPPORTED_FORMATS,
  FORMAT_LABELS,
  FORMAT_FILENAMES,
  buildFindings,
  parseFinding,
  classifySeverity,
  groupByFile,
  counts,
  filterFindings,
  formatForClaudeCode,
  formatForCursor,
  formatForClineAider,
  formatForGitHubIssue,
  formatAsJson,
  formatAsMarkdown,
  formatHandoff,
} = require('../website/app/lib/ai-handoff.js');

// ---------- shape tests ----------

test('SUPPORTED_FORMATS lists six exporters in stable order', () => {
  assert.deepEqual(SUPPORTED_FORMATS, [
    'claude-code',
    'cursor',
    'cline-aider',
    'github-issue',
    'json',
    'markdown',
  ]);
});

test('every supported format has a label and a filename', () => {
  for (const f of SUPPORTED_FORMATS) {
    assert.ok(FORMAT_LABELS[f], `missing label for ${f}`);
    assert.ok(FORMAT_FILENAMES[f], `missing filename for ${f}`);
  }
});

// ---------- classifySeverity ----------

test('classifySeverity — explicit prefix wins over keyword heuristics', () => {
  assert.equal(classifySeverity('error: something silly'), 'error');
  assert.equal(classifySeverity('warning: who cares'), 'warning');
  assert.equal(classifySeverity('info: heads up'), 'info');
});

test('classifySeverity — heuristic catches secrets / vulns / etc.', () => {
  assert.equal(classifySeverity('hardcoded API key in src/foo.ts'), 'error');
  assert.equal(classifySeverity('SQL injection surface'), 'error');
  assert.equal(classifySeverity('package is deprecated'), 'warning');
  assert.equal(classifySeverity('summary: scanned 3 files'), 'info');
});

test('classifySeverity — defaults to warning when nothing matches', () => {
  assert.equal(classifySeverity('something neutral about a file'), 'warning');
});

// ---------- parseFinding ----------

test('parseFinding — file:line:col — message format', () => {
  const f = parseFinding('src/foo.ts:42:7 — uses var', 'lint', 0);
  assert.equal(f.file, 'src/foo.ts');
  assert.equal(f.line, 42);
  assert.equal(f.message, 'uses var');
  assert.equal(f.module, 'lint');
});

test('parseFinding — file:line message format (no separator)', () => {
  const f = parseFinding('src/foo.ts:13 message body', 'syntax', 1);
  assert.equal(f.file, 'src/foo.ts');
  assert.equal(f.line, 13);
  assert.equal(f.message, 'message body');
});

test('parseFinding — file: message format (no line)', () => {
  const f = parseFinding('package.json: missing license field', 'licenses', 2);
  assert.equal(f.file, 'package.json');
  assert.equal(f.line, null);
  assert.equal(f.message, 'missing license field');
});

test('parseFinding — bare prose with no file falls back gracefully', () => {
  const f = parseFinding('repo missing README.md', 'documentation', 3);
  assert.equal(f.file, null);
  assert.equal(f.line, null);
  assert.equal(f.message, 'repo missing README.md');
});

test('parseFinding — strips leading severity prefix from raw', () => {
  const f = parseFinding('error: src/x.ts:1 — leak', 'secrets', 4);
  assert.equal(f.file, 'src/x.ts');
  assert.equal(f.line, 1);
  assert.equal(f.message, 'leak');
  assert.equal(f.severity, 'error');
});

test('parseFinding — handles non-string raw without throwing', () => {
  const f = parseFinding(undefined, 'mod', 0);
  assert.equal(f.message, '');
  assert.equal(f.file, null);
});

// ---------- buildFindings ----------

test('buildFindings — empty / null modules yield empty array', () => {
  assert.deepEqual(buildFindings(), []);
  assert.deepEqual(buildFindings(null), []);
  assert.deepEqual(buildFindings([]), []);
});

test('buildFindings — flattens module.details into individual findings', () => {
  const modules = [
    { name: 'lint', details: ['src/a.ts:1 — uses var', 'src/b.ts:2 — line too long'] },
    { name: 'secrets', details: ['hardcoded API key found in src/c.ts'] },
    { name: 'syntax', details: [] }, // empty — skipped
    { name: 'security', details: undefined }, // undefined — skipped
  ];
  const findings = buildFindings(modules);
  assert.equal(findings.length, 3);
  assert.equal(findings[0].module, 'lint');
  assert.equal(findings[0].file, 'src/a.ts');
  assert.equal(findings[2].module, 'secrets');
});

// ---------- counts ----------

test('counts — tallies severity', () => {
  const findings = [
    { severity: 'error' },
    { severity: 'error' },
    { severity: 'warning' },
    { severity: 'info' },
  ];
  const c = counts(findings);
  assert.equal(c.total, 4);
  assert.equal(c.error, 2);
  assert.equal(c.warning, 1);
  assert.equal(c.info, 1);
});

test('counts — empty input returns all zeros', () => {
  const c = counts([]);
  assert.equal(c.total, 0);
  assert.equal(c.error, 0);
});

// ---------- groupByFile ----------

test('groupByFile — groups by file path', () => {
  const findings = [
    { file: 'src/a.ts', severity: 'error' },
    { file: 'src/b.ts', severity: 'warning' },
    { file: 'src/a.ts', severity: 'warning' },
    { file: null, severity: 'info' },
  ];
  const grouped = groupByFile(findings);
  // a has 1 error → comes before b which has 0 errors
  assert.equal(grouped[0][0], 'src/a.ts');
  assert.equal(grouped[0][1].length, 2);
  assert.equal(grouped[1][0], 'src/b.ts');
  assert.equal(grouped[2][0], '(unattributed)');
});

test('groupByFile — unattributed bucket sinks to bottom even with errors', () => {
  const findings = [
    { file: null, severity: 'error' },
    { file: 'src/a.ts', severity: 'warning' },
  ];
  const grouped = groupByFile(findings);
  // Unattributed always at bottom (developer can't act on it from a file list)
  assert.equal(grouped[grouped.length - 1][0], '(unattributed)');
});

// ---------- filterFindings ----------

test('filterFindings — severity filter', () => {
  const findings = [
    { severity: 'error', module: 'lint', file: 'a', message: 'x' },
    { severity: 'warning', module: 'lint', file: 'b', message: 'y' },
  ];
  assert.equal(filterFindings(findings, { severity: 'error' }).length, 1);
  assert.equal(filterFindings(findings, { severity: 'all' }).length, 2);
});

test('filterFindings — module filter', () => {
  const findings = [
    { severity: 'error', module: 'lint', file: 'a', message: 'x' },
    { severity: 'error', module: 'secrets', file: 'b', message: 'y' },
  ];
  assert.equal(filterFindings(findings, { module: 'secrets' }).length, 1);
});

test('filterFindings — search query matches file or message', () => {
  const findings = [
    { severity: 'error', module: 'lint', file: 'src/foo.ts', message: 'uses var' },
    { severity: 'error', module: 'lint', file: 'src/bar.ts', message: 'too long' },
  ];
  assert.equal(filterFindings(findings, { query: 'foo' }).length, 1);
  assert.equal(filterFindings(findings, { query: 'too long' }).length, 1);
  assert.equal(filterFindings(findings, { query: 'nope' }).length, 0);
});

// ---------- formatters ----------

const SAMPLE = [
  { id: 'lint-0', module: 'lint', severity: 'error', file: 'src/foo.ts', line: 12, message: 'uses var declaration', raw: 'src/foo.ts:12 — uses var declaration' },
  { id: 'lint-1', module: 'lint', severity: 'warning', file: 'src/foo.ts', line: 30, message: 'line too long', raw: 'src/foo.ts:30 — line too long' },
  { id: 'secrets-0', module: 'secrets', severity: 'error', file: 'src/config.ts', line: 1, message: 'hardcoded API key', raw: 'error: src/config.ts:1 — hardcoded API key' },
  { id: 'doc-0', module: 'documentation', severity: 'warning', file: null, line: null, message: 'repo missing README.md', raw: 'repo missing README.md' },
];

test('formatForClaudeCode — includes header, counts, every finding, and footer', () => {
  const out = formatForClaudeCode(SAMPLE, { repoUrl: 'https://github.com/o/r', tier: 'full' });
  assert.match(out, /GateTest scan — handoff to Claude/);
  assert.match(out, /https:\/\/github\.com\/o\/r/);
  assert.match(out, /Tier:\*\* full/);
  assert.match(out, /Total:\*\* 4/);
  assert.match(out, /uses var declaration/);
  assert.match(out, /hardcoded API key/);
  assert.match(out, /repo missing README\.md/);
  assert.match(out, /gatetest\.ai/);
});

test('formatForClaudeCode — empty findings still renders header and footer', () => {
  const out = formatForClaudeCode([], {});
  assert.match(out, /GateTest scan — handoff to Claude/);
  assert.match(out, /Total:\*\* 0/);
});

test('formatForCursor — uses @-mention syntax for files', () => {
  const out = formatForCursor(SAMPLE, { repoUrl: 'https://github.com/o/r' });
  assert.match(out, /Cursor task/);
  assert.match(out, /@src\/foo\.ts/);
  assert.match(out, /@src\/config\.ts/);
  assert.match(out, /uses var declaration/);
});

test('formatForCursor — does not mention unattributed bucket as @-file', () => {
  const out = formatForCursor(SAMPLE, {});
  // Unattributed bucket is rendered, but never as "@(unattributed)"
  assert.doesNotMatch(out, /@\(unattributed\)/);
});

test('formatForClineAider — renders aider command with quoted file paths', () => {
  const out = formatForClineAider(SAMPLE, {});
  assert.match(out, /aider src\/foo\.ts src\/config\.ts/);
  assert.match(out, /Cline \/ Aider task/);
});

test('formatForClineAider — paths with spaces get shell-quoted', () => {
  const findings = [
    { id: '1', module: 'lint', severity: 'error', file: 'src/with space.ts', line: 1, message: 'x', raw: '' },
  ];
  const out = formatForClineAider(findings, {});
  assert.match(out, /aider 'src\/with space\.ts'/);
});

test('formatForClineAider — no findings with files emits a helpful aider hint', () => {
  const findings = [
    { id: '1', module: 'doc', severity: 'warning', file: null, line: null, message: 'no readme', raw: '' },
  ];
  const out = formatForClineAider(findings, {});
  assert.match(out, /aider {2}# \(no file paths/);
});

test('formatForGitHubIssue — renders checklist + repo metadata + GateTest preamble', () => {
  const out = formatForGitHubIssue(SAMPLE, { repoUrl: 'https://github.com/o/r', tier: 'full' });
  assert.match(out, /## GateTest scan results/);
  assert.match(out, /Repo:\*\* https:\/\/github\.com\/o\/r/);
  assert.match(out, /Tier:\*\* full/);
  assert.match(out, /\[ \] \*\*ERROR\*\*/);
  assert.match(out, /Filed automatically from a \[GateTest\]/);
});

test('formatAsJson — produces parseable, schema-tagged payload', () => {
  const out = formatAsJson(SAMPLE, { repoUrl: 'https://github.com/o/r', tier: 'full' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.schema, 'gatetest-findings@1');
  assert.equal(parsed.repoUrl, 'https://github.com/o/r');
  assert.equal(parsed.tier, 'full');
  assert.equal(parsed.findings.length, 4);
  assert.equal(parsed.counts.total, 4);
  assert.equal(parsed.counts.error, 2);
  // byFile order — error-rich files first, unattributed last
  assert.equal(parsed.byFile[0].file, 'src/foo.ts');
  assert.equal(parsed.byFile[parsed.byFile.length - 1].file, '(unattributed)');
});

test('formatAsJson — empty findings still produces a valid payload', () => {
  const out = formatAsJson([], {});
  const parsed = JSON.parse(out);
  assert.equal(parsed.findings.length, 0);
  assert.equal(parsed.counts.total, 0);
  assert.equal(parsed.repoUrl, null);
});

test('formatAsMarkdown — checklist with severity flags', () => {
  const out = formatAsMarkdown(SAMPLE, {});
  assert.match(out, /# GateTest findings/);
  assert.match(out, /\[ \] \*\*ERROR\*\*/);
  assert.match(out, /\[ \] \*\*WARNING\*\*/);
});

// ---------- formatHandoff (dispatch) ----------

test('formatHandoff — returns content + filename + mimeType for every format', () => {
  for (const f of SUPPORTED_FORMATS) {
    const r = formatHandoff(f, SAMPLE, { repoUrl: 'x', tier: 'full' });
    assert.ok(r.content && r.content.length > 0, `${f}: empty content`);
    assert.ok(r.filename && r.filename.length > 0, `${f}: missing filename`);
    assert.ok(r.mimeType && r.mimeType.length > 0, `${f}: missing mimeType`);
  }
});

test('formatHandoff — JSON format has application/json mime', () => {
  const r = formatHandoff('json', SAMPLE, {});
  assert.equal(r.mimeType, 'application/json');
});

test('formatHandoff — markdown formats have text/markdown mime', () => {
  for (const f of ['claude-code', 'cursor', 'cline-aider', 'github-issue', 'markdown']) {
    const r = formatHandoff(f, SAMPLE, {});
    assert.equal(r.mimeType, 'text/markdown', `${f} should be text/markdown`);
  }
});

test('formatHandoff — unknown format throws with helpful message', () => {
  assert.throws(() => formatHandoff('claude-flim-flam', SAMPLE, {}), /Unsupported format/);
});

test('formatHandoff — null findings normalised to empty array (no crash)', () => {
  const r = formatHandoff('claude-code', null, {});
  assert.match(r.content, /Total:\*\* 0/);
});
