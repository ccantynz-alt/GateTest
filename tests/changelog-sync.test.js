// =============================================================================
// /changelog must agree with the repository that produced it
// =============================================================================
// website/app/data/changelog.json is what the public changelog renders.
// scripts/generate-changelog.js writes it from the main branch's first-parent
// history — the same contract as site-stats.json and precision.json — and
// this test is the tripwire that stops the page and the repository drifting:
//
//   - the generator parses both merge shapes (a "Merge pull request #N"
//     commit whose body carries the title, and a squash "title (#N)") and
//     keeps a direct commit as a direct commit — proven on a fabricated
//     history with known answers, not on ours
//   - a version bump is recorded on the commit that made it, and only there
//   - the committed file was generated, not typed: source script, parseable
//     timestamp, entries in history order, every area from the one list
//   - the file's version is package.json's version — bump one without
//     regenerating the other and this fails
//   - the page imports the file, and the footer and sitemap link the page
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'generate-changelog.js');
const JSON_PATH = path.join(ROOT, 'website', 'app', 'data', 'changelog.json');
const PAGE_PATH = path.join(ROOT, 'website', 'app', 'changelog', 'page.tsx');

const { describeCommit, areaOf, serialize, AREAS } = require(SCRIPT);

describe('generate-changelog — one commit, one entry, either merge shape', () => {
  it('reads the PR number and title from a merge commit body', () => {
    const d = describeCommit('Merge pull request #434 from crclabs-hq/claude/fifty-move07-rule-noise',
      '\nFlywheel: per-rule silenced rate, published at /noise (Move 07)\n\nlonger body');
    assert.deepEqual(d, { pr: 434, title: 'Flywheel: per-rule silenced rate, published at /noise (Move 07)' });
  });
  it('reads a squash / API merge subject', () => {
    assert.deepEqual(describeCommit('Gate: policy hash in every report (Move 26) (#436)', ''),
      { pr: 436, title: 'Gate: policy hash in every report (Move 26)' });
  });
  it('keeps a direct commit as a direct commit', () => {
    assert.deepEqual(describeCommit('docs: the launch playbook', ''), { pr: null, title: 'docs: the launch playbook' });
  });
  it('a merge commit with an empty body falls back to the subject rather than an empty title', () => {
    const d = describeCommit('Merge pull request #9 from x/y', '');
    assert.equal(d.pr, 9);
    assert.ok(d.title.length > 0);
  });
  it('classifies paths into the one area list', () => {
    assert.equal(areaOf('src/modules/secrets.js'), 'engine');
    assert.equal(areaOf('bin/gatetest.js'), 'engine');
    assert.equal(areaOf('website/app/page.tsx'), 'website');
    assert.equal(areaOf('action.yml'), 'integrations');
    assert.equal(areaOf('integrations/github-actions/gatetest-gate.yml'), 'integrations');
    assert.equal(areaOf('.github/workflows/ci.yml'), 'ci');
    assert.equal(areaOf('tests/x.test.js'), 'tests');
    assert.equal(areaOf('reliability-corpus/real-world.json'), 'corpus');
    assert.equal(areaOf('scripts/x.js'), 'tooling');
    assert.equal(areaOf('docs/HISTORY.md'), 'docs');
    assert.equal(areaOf('README.md'), 'docs');
    assert.equal(areaOf('package.json'), 'other');
    for (const f of ['src/a.js', 'website/x', 'action.yml', '.github/a', 'tests/a', 'reliability-corpus/a', 'scripts/a', 'docs/a', 'LICENSE']) {
      assert.ok(AREAS.includes(areaOf(f)), f);
    }
  });
});

describe('generate-changelog — a fabricated history with known answers', () => {
  let tmp;
  let out;
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), body);
  };
  const commit = (msg) => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', msg); };

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-changelog-'));
    out = path.join(tmp, 'out.json');
    git('init', '-q', '-b', 'main');
    write('package.json', '{ "name": "x", "version": "1.0.0" }\n');
    write('src/modules/secrets.js', '// v1\n');
    commit('chore: initial');
    // A PR merged with a real merge commit: title lives in the body.
    git('checkout', '-q', '-b', 'feature-a');
    write('src/modules/secrets.js', '// v2\n');
    write('tests/secrets.test.js', '// t\n');
    commit('secrets: tighten the JWT rule');
    git('checkout', '-q', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', 'feature-a',
      '-m', 'Merge pull request #7 from acme/feature-a\n\nSecrets: the JWT rule no longer fires on fixtures\n\nbody text');
    // A squash merge whose subject carries the number, bumping the version.
    write('package.json', '{ "name": "x", "version": "1.1.0" }\n');
    write('website/app/page.tsx', '// page\n');
    write('website/app/layout.tsx', '// layout\n');
    commit('Website: the pricing page (#8)');
    // A direct commit, docs only.
    write('README.md', '# x\n');
    commit('docs: readme');
    execFileSync('node', [SCRIPT, '--repo', tmp, '--out', out, '--ref', 'main'], { stdio: ['ignore', 'pipe', 'pipe'] });
  });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('lists every first-parent commit newest first, with the merge attributed as one entry', () => {
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(data.source, 'scripts/generate-changelog.js');
    assert.equal(data.currentVersion, '1.1.0');
    assert.deepEqual(data.entries.map((e) => [e.pr, e.title]), [
      [null, 'docs: readme'],
      [8, 'Website: the pricing page'],
      [7, 'Secrets: the JWT rule no longer fires on fixtures'],
      [null, 'chore: initial'],
    ]);
    // The feature branch's own commit is not an entry — the merge is.
    assert.ok(!data.entries.some((e) => e.title === 'secrets: tighten the JWT rule'));
  });

  it('records the area by file count, the modules through the registry, and the version bump where it happened', () => {
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    const [docs, site, merge, initial] = data.entries;
    assert.equal(merge.area, 'engine');
    assert.deepEqual(merge.areas, { engine: 1, tests: 1 });
    assert.deepEqual(merge.modules, ['secrets']);
    assert.equal(merge.files, 2);
    assert.equal(site.area, 'website');
    assert.equal(site.version, '1.1.0');
    assert.equal(merge.version, null);
    assert.equal(docs.version, null);
    assert.equal(docs.area, 'docs');
    assert.equal(initial.version, null);
    for (const e of data.entries) assert.match(e.sha, /^[0-9a-f]{40}$/);
  });

  it('writes one entry per line and parses back to the same data', () => {
    const text = fs.readFileSync(out, 'utf8');
    const data = JSON.parse(text);
    const rows = text.split('\n').filter((l) => l.startsWith('    {"sha":'));
    assert.equal(rows.length, data.entries.length);
    assert.equal(serialize(data), text);
  });

  it('refuses a shallow clone unless told to keep the committed file', () => {
    const shallow = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-changelog-shallow-'));
    const shallowOut = path.join(shallow, 'out.json');
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', `file://${tmp}`, path.join(shallow, 'repo')], { stdio: 'ignore' });
      assert.throws(() => execFileSync('node', [SCRIPT, '--repo', path.join(shallow, 'repo'), '--out', shallowOut], { stdio: ['ignore', 'pipe', 'pipe'] }),
        (err) => /shallow/.test(String(err.stderr)));
      assert.ok(!fs.existsSync(shallowOut), 'a truncated changelog must never be written');
      execFileSync('node', [SCRIPT, '--repo', path.join(shallow, 'repo'), '--out', shallowOut, '--if-full-history'], { stdio: ['ignore', 'pipe', 'pipe'] });
      assert.ok(!fs.existsSync(shallowOut), 'prebuild mode keeps the committed file');
    } finally {
      fs.rmSync(shallow, { recursive: true, force: true });
    }
  });
});

describe('changelog.json — generated, not typed, and current', () => {
  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  it('names the script that wrote it and carries a parseable timestamp', () => {
    assert.equal(data.source, 'scripts/generate-changelog.js');
    assert.ok(Number.isFinite(Date.parse(data.generatedAt)));
    assert.match(String(data.head), /^[0-9a-f]{40}$/);
  });

  it('carries the version package.json carries — bump one, regenerate the other', () => {
    assert.equal(data.currentVersion, pkg.version);
  });

  it('every entry is well-formed, in history order, with an area from the one list', () => {
    assert.ok(data.entries.length > 0);
    assert.deepEqual(data.areas, AREAS);
    let prev = null;
    for (const e of data.entries) {
      assert.match(e.sha, /^[0-9a-f]{40}$/);
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(e.title.trim().length > 0, e.sha);
      assert.ok(!/^Merge pull request/.test(e.title), `unparsed merge: ${e.sha}`);
      assert.ok(e.pr === null || (Number.isInteger(e.pr) && e.pr > 0), e.sha);
      assert.ok(AREAS.includes(e.area), `${e.sha} area ${e.area}`);
      for (const a of Object.keys(e.areas)) assert.ok(AREAS.includes(a), a);
      assert.ok(Array.isArray(e.modules));
      assert.ok(e.version === null || /^\d+\.\d+\.\d+/.test(e.version));
      if (prev) assert.ok(e.date <= prev, `${e.date} after ${prev} — not history order`);
      prev = e.date;
    }
    assert.equal(data.entries[0].sha, data.head);
  });

  it('is written one entry per line, so a regeneration diffs as lines added at the top', () => {
    const text = fs.readFileSync(JSON_PATH, 'utf8');
    const rows = text.split('\n').filter((l) => l.startsWith('    {"sha":'));
    assert.equal(rows.length, data.entries.length);
  });
});

describe('/changelog — the page, the footer and the sitemap', () => {
  it('the page imports the generated file and nothing else for its entries', () => {
    const src = fs.readFileSync(PAGE_PATH, 'utf8');
    assert.match(src, /from "\.\.\/data\/changelog\.json"/);
    assert.match(src, /generate-changelog\.js/);
  });
  it('the footer and the sitemap link /changelog', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'website', 'app', 'components', 'Footer.tsx'), 'utf8'), /href="\/changelog"/);
    assert.match(fs.readFileSync(path.join(ROOT, 'website', 'app', 'sitemap.ts'), 'utf8'), /\$\{base\}\/changelog`/);
  });
  it('the website prebuild and the nightly regenerate the file', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'website', 'package.json'), 'utf8'));
    assert.match(pkg.scripts.prebuild, /generate-changelog\.js --if-full-history/);
    const nightly = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'dogfood-nightly.yml'), 'utf8');
    assert.match(nightly, /node scripts\/generate-changelog\.js/);
    assert.match(nightly, /GENERATED="[^"]*website\/app\/data\/changelog\.json/);
  });
});
