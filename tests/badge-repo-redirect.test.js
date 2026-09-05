// =============================================================================
// The badge a README pastes must be the graded one (the Fifty, move 36)
// =============================================================================
// /badge advertised `?repo=owner/repo` as "shows your grade, updates after
// every scan" while /api/badge never read `repo` — every README that pasted
// it got the generic "quality gate" badge. The graded badge is
// /badge/{owner}/{repo}.svg. Three things pinned here, textually (the routes
// are TypeScript and are not loaded by node's test runner):
//   - /api/badge redirects a well-formed ?repo= to the graded route
//   - the /badge page's snippets point at the graded route, via site-url
//   - the free-scan results end with the repo's own badge markdown
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('/api/badge?repo= redirects to the graded badge', () => {
  const src = read('website/app/api/badge/route.ts');
  it('reads the repo param and redirects to /badge/{owner}/{repo}.svg', () => {
    assert.match(src, /searchParams\.get\("repo"\)/);
    assert.match(src, /NextResponse\.redirect\(new URL\(`\/badge\/\$\{owner\}\/\$\{name\}\.svg`/);
  });
  it('only for a well-formed owner/name — never an open redirect', () => {
    assert.match(src, /\/\^\[\\w\.-\]\+\\\/\[\\w\.-\]\+\$\/\.test\(repoParam\)/);
  });
});

describe('/badge page snippets', () => {
  const src = read('website/app/badge/page.tsx');
  it('use the graded per-repo route, built from site-url', () => {
    assert.doesNotMatch(src, /api\/badge\?repo=/, 'the ungraded ?repo= form must not be offered');
    assert.match(src, /badgeUrlFor\(`\/badge\/\$\{exampleRepo\}\.svg`\)/);
    assert.match(src, /import \{ siteUrl, badgeUrl as badgeUrlFor \} from "@\/app\/lib\/site-url";/);
  });
  it('carry no hardcoded domain', () => {
    assert.doesNotMatch(src, /https:\/\/gatetest\.(io|ai)/);
  });
});

describe('free-scan results end with the repo badge', () => {
  const src = read('website/app/scan/preview/PreviewResults.tsx');
  it('derive owner/repo, render the badge image and the markdown to copy', () => {
    assert.match(src, /const repoSlug = /);
    assert.match(src, /badgeUrlFor\(`\/badge\/\$\{repoSlug\}\.svg`\)/);
    assert.match(src, /\[!\[GateTest\]\(\$\{badgeImage\}\)\]\(\$\{siteUrl\(`\/score\/\$\{repoSlug\}`\)\}\)/);
    assert.match(src, /<CopyButton text=\{badgeMarkdown\} \/>/);
  });
  it('shows nothing when the repo cannot be identified', () => {
    assert.match(src, /\{repoSlug && \(/);
  });
});
