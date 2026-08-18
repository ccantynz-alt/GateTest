'use strict';

// SEO MODULE — behavioural tests with positive AND negative controls.
//
// 2026-08-18 false-positive audit: seo produced 446 blocking errors across
// 9 real repos, 59/69 of them on server-template fragments (Thymeleaf /
// Jinja / swig partials, layouts, includes) that carry no <html>/<head> of
// their own, plus "no sitemap" on libraries that are not websites. The
// module now checks FULL DOCUMENTS only and asks for sitemap/robots only
// where a deployable site exists. The positive control below plants a real
// broken page and asserts the rules still fire — without it, tightening the
// filter until the repo goes quiet is indistinguishable from the rule working.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SeoModule = require('../src/modules/seo');

function makeResult() {
  const checks = [];
  return { checks, addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); } };
}
function makeConfig(projectRoot) {
  return { projectRoot, getModuleConfig() { return {}; }, get() { return null; } };
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
async function runOn(root) {
  const result = makeResult();
  await new SeoModule().run(result, makeConfig(root));
  return result.checks;
}
const failing = (checks) => checks.filter((c) => !c.passed);
const FULL_PAGE_NO_META = '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>a</h1><h1>b</h1></body></html>';

describe('SeoModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new SeoModule();
    assert.equal(typeof mod.name, 'string');
    assert.equal(typeof mod.run, 'function');
  });
});

describe('SeoModule — full documents only', () => {
  let root;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-seo-')); });
  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('POSITIVE CONTROL: a real page missing title/description still fails', async () => {
    write(root, 'index.html', FULL_PAGE_NO_META);
    const bad = failing(await runOn(root));
    assert.ok(bad.some((c) => c.id === 'seo:title:index.html'), 'missing <title> must fire');
    assert.ok(bad.some((c) => c.id === 'seo:description:index.html'), 'missing description must fire');
    assert.ok(bad.some((c) => c.id === 'seo:h1-multiple:index.html'), 'multiple h1 must fire');
  });

  it('a Thymeleaf/Jinja fragment with no <html>/<head> is skipped, not failed', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-seo-frag-'));
    try {
      write(r, 'src/main/resources/templates/fragments/layout.html', '<div th:fragment="nav"><ul><li>x</li></ul></div>');
      write(r, 'app/templates/_footer.html', '<footer>{{ year }}</footer>');
      const checks = await runOn(r);
      assert.equal(failing(checks).length, 0, `fragments produced findings: ${JSON.stringify(failing(checks).map((c) => c.id))}`);
      assert.ok(checks.some((c) => c.id === 'seo:fragments' && c.passed), 'skipped fragments are reported once as info');
    } finally { fs.rmSync(r, { recursive: true, force: true }); }
  });

  it('a child template that extends a layout inherits its head and is skipped', () => {
    assert.equal(SeoModule.isFullDocument('web/page.html', '{% extends "base.html" %}<html><head></head><body></body></html>'), false);
    assert.equal(SeoModule.isFullDocument('web/page.html', '<html><head><title>x</title></head><body></body></html>'), true);
  });

  it('files under templates/, views/, fixtures/, tests/ or examples/ are never pages', () => {
    for (const p of ['templates/a.html', 'app/views/b.html', 'tests/fixtures/c.html', 'examples/d.html', 'docs_src/e.html']) {
      assert.equal(SeoModule.isFullDocument(p, '<html><head></head><body></body></html>'), false, p);
    }
  });
});

describe('SeoModule — sitemap/robots only for deployable sites', () => {
  it('a library with no HTML pages is not told it lacks a sitemap or robots.txt', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-seo-lib-'));
    try {
      write(r, 'lib/index.js', 'module.exports = 1;\n');
      write(r, 'test/fixtures/page.html', '<html><head></head><body></body></html>');
      const checks = await runOn(r);
      assert.ok(!checks.some((c) => c.id === 'seo:sitemap' && !c.passed), 'sitemap must not fire on a library');
      assert.ok(!checks.some((c) => c.id === 'seo:robots-txt' && !c.passed), 'robots must not fire on a library');
      assert.ok(checks.some((c) => c.id === 'seo:site-files' && c.passed));
    } finally { fs.rmSync(r, { recursive: true, force: true }); }
  });

  it('a real site without sitemap/robots gets a WARNING (not a gate-blocking error)', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-seo-site-'));
    try {
      write(r, 'index.html', '<html><head><title>Home</title><meta name="description" content="A perfectly described page for testing purposes here."></head><body><h1>Hi</h1></body></html>');
      const checks = await runOn(r);
      const sitemap = checks.find((c) => c.id === 'seo:sitemap');
      const robots = checks.find((c) => c.id === 'seo:robots-txt');
      assert.ok(sitemap && !sitemap.passed && sitemap.meta.severity === 'warning');
      assert.ok(robots && !robots.passed && robots.meta.severity === 'warning');
    } finally { fs.rmSync(r, { recursive: true, force: true }); }
  });

  it('a Next.js app dir counts as a website even before any HTML is emitted', () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-seo-next-'));
    try {
      write(r, 'app/layout.tsx', 'export default function L({children}){return children}');
      assert.equal(SeoModule.looksLikeWebsite(r), true);
    } finally { fs.rmSync(r, { recursive: true, force: true }); }
  });
});
