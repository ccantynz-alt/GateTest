'use strict';

// ============================================================================
// Workflow / script file references must resolve on disk
// ============================================================================
// Found 2026-07-31 by a scheduled run going red: trainer-nightly.yml still did
// `require('./website/app/lib/session-telemetry.js')` after this session moved
// that file to src/core/ as part of the KI #74 packaging fix. Nothing caught it
// — the module graph tests only cover code that the test suite imports, and a
// workflow's `node -e` string is invisible to every one of them.
//
// The failure mode is the expensive kind: the nightly trainer had been dying at
// its FIRST step every night, so the whole flywheel-ingest job silently did
// nothing until a human happened to read the run list.
//
// This test resolves the paths that workflows and scripts name, so moving a
// file breaks the suite instead of a cron job nobody watches.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['.github/workflows', 'scripts', 'integrations'];

// Repo-relative paths to first-party source, as written in a workflow or
// script. Bare package specifiers and URLs are deliberately not matched.
const REF = /['"`](\.{0,2}\/?(?:website\/app\/lib|src\/core|src\/modules|lib|bin)\/[A-Za-z0-9_\-./]+\.(?:js|mjs|cjs|ts))['"`]/g;

function collectFiles() {
  const out = [];
  for (const dir of SEARCH_DIRS) {
    const full = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        if (/\.(yml|yaml|js|mjs|cjs|sh)$/.test(e.name)) out.push(f);
      }
    })(full);
  }
  return out;
}

/** Every first-party file path named by a workflow/script, with its location. */
function collectReferences(files) {
  const refs = [];
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(src))) {
      refs.push({
        file: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
        line: src.slice(0, m.index).split('\n').length,
        spec: m[1],
      });
    }
  }
  return refs;
}

test('every source path named by a workflow or script exists', () => {
  const files = collectFiles();
  const refs = collectReferences(files);

  // Anti-vacuity: if the walk or the regex breaks, this test would pass while
  // checking nothing. The repo has many such references; assert we found them.
  assert.ok(files.length > 10, `expected to scan workflows/scripts, found ${files.length} files`);
  assert.ok(refs.length > 5, `expected to find source references, found ${refs.length}`);

  const broken = refs
    .filter((r) => !fs.existsSync(path.join(REPO_ROOT, r.spec.replace(/^\.\//, ''))))
    .map((r) => `${r.file}:${r.line} -> ${r.spec}`);

  assert.deepEqual(
    broken,
    [],
    'workflow/script references a file that does not exist:\n  ' + broken.join('\n  ') +
      '\n\nA moved or renamed file must be updated here too — these paths are ' +
      'invisible to the module graph, so nothing else catches them.'
  );
});

test('POSITIVE CONTROL — a reference to a missing file is detected', () => {
  // Proves the resolver actually resolves, rather than passing on an empty set.
  const missing = path.join(REPO_ROOT, 'src/core/definitely-not-a-real-file.js');
  assert.ok(!fs.existsSync(missing), 'fixture path must not exist');

  const fakeRefs = [{ file: 'fake.yml', line: 1, spec: './src/core/definitely-not-a-real-file.js' }];
  const broken = fakeRefs.filter((r) => !fs.existsSync(path.join(REPO_ROOT, r.spec.replace(/^\.\//, ''))));
  assert.equal(broken.length, 1, 'a non-existent path must be reported as broken');
});

test('the regex matches the shape that actually broke', () => {
  // The real defect was a `node -e` string inside YAML, not an import statement.
  const sample = `run: |\n  node -e "\n    const ST = require('./website/app/lib/session-telemetry.js');\n  "\n`;
  REF.lastIndex = 0;
  const found = [...sample.matchAll(REF)].map((m) => m[1]);
  assert.deepEqual(found, ['./website/app/lib/session-telemetry.js']);
});
