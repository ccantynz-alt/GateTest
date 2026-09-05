// =============================================================================
// /precision must agree with the corpus that produced it
// =============================================================================
// website/app/data/precision.json is what the public precision page renders.
// scripts/real-world-precision.js writes it from its own measurement — the
// same contract as site-stats.json — and this test is the tripwire that stops
// the page and the corpus drifting apart:
//
//   - every repo on the page is in reliability-corpus/real-world.json, at the
//     SAME pinned sha, with the SAME ceiling or floor
//   - no repo the corpus gates is missing from the page (a table that omits a
//     repo reads as "that one was fine")
//   - no measured number exceeds its ceiling or undercuts its floor — the JSON
//     is a snapshot of a PASSING run, never of a red one
//   - the file was generated, not typed: it carries the source script and a
//     parseable timestamp
//
// The Sync Rule in CLAUDE.md is the reason this exists: a surface describing
// the product must move with the product, and a precision claim is the one
// surface a competitor would have to do months of work to answer.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'website', 'app', 'data', 'precision.json');
const MANIFEST_PATH = path.join(ROOT, 'reliability-corpus', 'real-world.json');
const PAGE_PATH = path.join(ROOT, 'website', 'app', 'precision', 'page.tsx');

const page = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

describe('precision.json — generated, not typed', () => {
  it('names the script that wrote it', () => {
    assert.strictEqual(page.source, 'scripts/real-world-precision.js');
  });
  it('carries a real timestamp and engine version', () => {
    assert.ok(!Number.isNaN(Date.parse(page.generatedAt)), 'generatedAt must parse');
    assert.match(String(page.engineVersion), /^\d+\.\d+\.\d+/);
  });
});

describe('precision.json — agrees with reliability-corpus/real-world.json', () => {
  const pageRows = byName(page.repos);
  const corpusRows = byName(manifest.repos);

  it('every corpus repo is on the page', () => {
    const missing = manifest.repos.map((r) => r.name).filter((n) => !pageRows[n]);
    assert.deepStrictEqual(missing, [], 'a repo the corpus gates is absent from the public table');
  });

  it('every page repo is in the corpus', () => {
    const extra = page.repos.map((r) => r.name).filter((n) => !corpusRows[n]);
    assert.deepStrictEqual(extra, [], 'the page shows a repo the corpus does not gate');
  });

  for (const r of manifest.repos) {
    it(`${r.name}: same sha, same bound`, () => {
      const p = pageRows[r.name];
      if (!p) return; // reported by the test above
      assert.strictEqual(p.sha, r.sha, 'the page must show the commit the corpus pins');
      if (typeof r.maxBlocking === 'number') assert.strictEqual(p.ceiling, r.maxBlocking);
      if (typeof r.minBlocking === 'number') assert.strictEqual(p.floor, r.minBlocking);
    });
  }
});

describe('precision.json — a snapshot of a passing run', () => {
  for (const r of page.repos) {
    it(`${r.name}: measured ${r.blocking} respects its bound`, () => {
      assert.strictEqual(typeof r.blocking, 'number');
      if (typeof r.ceiling === 'number') {
        assert.ok(r.blocking <= r.ceiling, `${r.blocking} blocking exceeds ceiling ${r.ceiling} — the JSON was written from a red run`);
      }
      if (typeof r.floor === 'number') {
        assert.ok(r.blocking >= r.floor, `${r.blocking} blocking undercuts floor ${r.floor} — recall dropped`);
      }
    });
  }
});

describe('the page reads the JSON and nothing else', () => {
  it('imports precision.json and hardcodes no repo counts', () => {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.match(src, /from "\.\.\/data\/precision\.json"/, 'the page must import the generated file');
    // A literal blocking count in the JSX would be exactly the hand-typed
    // number this whole arrangement exists to prevent.
    for (const r of page.repos) {
      const literal = new RegExp(`>\\s*${r.blocking}\\s*<`);
      assert.ok(!literal.test(src), `page hardcodes "${r.blocking}" — render it from the JSON`);
    }
  });
});
