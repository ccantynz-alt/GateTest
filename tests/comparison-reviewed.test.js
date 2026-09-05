// =============================================================================
// Comparison pages are dated — by git, not by hand (the Fifty, move 38)
// =============================================================================
// Every /compare/<slug> page renders <ComparisonReviewed slug>, which reads
// the page's last-commit date and the engine version from build-info.json.
// scripts/generate-build-info.js writes both at build time. This pins:
//   - every comparison slug's page carries the component with its own slug
//   - the generator dates every slug (ISO date) when history is available
//   - the component contains no literal date — nothing to go stale
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { COMPARISON_SLUGS } = require('../website/app/lib/seo/all-urls');

describe('every comparison page is dated by the component', () => {
  for (const slug of COMPARISON_SLUGS) {
    it(`/compare/${slug} renders <ComparisonReviewed slug="${slug}">`, () => {
      const src = fs.readFileSync(path.join(ROOT, 'website', 'app', 'compare', slug, 'page.tsx'), 'utf8');
      assert.match(src, /import ComparisonReviewed from "@\/app\/components\/ComparisonReviewed";/);
      assert.match(src, new RegExp(`<ComparisonReviewed slug="${slug}" />`));
    });
  }
});

describe('the component carries no hand-typed date', () => {
  it('has no YYYY-MM-DD literal', () => {
    const src = fs.readFileSync(path.join(ROOT, 'website', 'app', 'components', 'ComparisonReviewed.tsx'), 'utf8');
    assert.doesNotMatch(src, /\b20\d\d-\d\d-\d\d\b/);
  });
});

describe('generate-build-info dates every comparison slug', () => {
  it('writes pageUpdated with an ISO date per slug (history permitting)', () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-build-info-')), 'build-info.json');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-build-info.js')], {
      cwd: ROOT, env: { ...process.env, BUILD_INFO_OUT: out }, stdio: 'pipe',
    });
    const info = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(info.pageUpdated && typeof info.pageUpdated === 'object');
    let depth;
    try { depth = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT, stdio: 'pipe' }).toString().trim()); }
    catch { depth = 0; } // no git → the generator must have written an empty map, asserted below
    if (depth >= 2) {
      for (const slug of COMPARISON_SLUGS) {
        assert.match(String(info.pageUpdated[slug]), /^\d{4}-\d{2}-\d{2}$/, `${slug} must be dated`);
      }
    } else {
      // A shallow clone must NOT stamp every page "today".
      assert.deepStrictEqual(info.pageUpdated, {});
    }
  });
});
