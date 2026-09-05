const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AccessibilityModule = require('../src/modules/accessibility');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('AccessibilityModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-a11y-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new AccessibilityModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new AccessibilityModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

describe('AccessibilityModule — fragment / primitive / AAA precision (2026-08-18 audit)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-a11y-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const w = (rel, c) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  const run = async () => { const r = makeResult(); await new AccessibilityModule().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks.filter((c) => !c.passed); };

  it('html-lang / landmark-main do not fire on a template fragment that has no <head>', async () => {
    w('templates/fragments/nav.html', '<html xmlns:th="http://www.thymeleaf.org"><body><nav th:fragment="nav">x</nav></body></html>');
    const f = await run();
    assert.ok(!f.some((c) => /a11y:(html-lang|landmark-main):/.test(c.name)), JSON.stringify(f.map((c) => c.name)));
  });

  it('POSITIVE: a full document without lang / main still fires', async () => {
    w('index.html', '<html><head><title>t</title></head><body><div>hi</div></body></html>');
    const f = await run();
    assert.ok(f.some((c) => c.name === 'a11y:html-lang:index.html'), JSON.stringify(f.map((c) => c.name)));
    assert.ok(f.some((c) => c.name === 'a11y:landmark-main:index.html'));
  });

  it('a SPA shell is not told it lacks <main>/<h1> (the app renders those) — but html-lang is still its own', async () => {
    // CleanArchitecture src/Web/ClientApp/src/index.html (2026-09-05): the
    // Angular shell produced landmark-main + heading findings for a body
    // that is `<app-root>Loading...</app-root>`.
    w('src/index.html', '<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body><app-root>Loading...</app-root></body></html>');
    const f = await run();
    const names = f.map((c) => c.name);
    assert.ok(!names.some((n) => /a11y:(landmark-main|heading|h1)[^:]*:src\/index\.html/.test(n)), JSON.stringify(names));
    assert.ok(names.includes('a11y:html-lang:src/index.html'), 'POSITIVE: a shell without lang still fires — the <head> and <html> are the shell\'s: ' + JSON.stringify(names));
  });

  it('a UI-kit primitive input (components/ui/input.tsx) and a commented-out <input> are not "unlabelled"', async () => {
    w('components/ui/input.tsx', 'export const Input = (props) => <input className="x" {...props} />;');
    w('pages/form.html', '<html><head></head><body><main><!-- <input type="text"> --><label for="q">Q</label><input id="q" type="text"></main></body></html>');
    const f = await run();
    assert.ok(!f.some((c) => c.name.startsWith('a11y:input-label:')), JSON.stringify(f.map((c) => c.name)));
  });

  // ── img-alt: a JSX tag split across expression boundaries ───────────────
  //
  // `<img\b([^>]*?)>` stops at the first `>`, which is not always the img's own.
  // The badge page renders a copy-paste HTML snippet whose <img> is broken over
  // three JSX children, so the first `>` reached belongs to the <span> in the
  // middle and the alt (present, one line further down) was never seen.
  // The module must not report an alt it never got to look at.

  it('NEGATIVE: an <img> split across JSX expressions (alt on a later line) does not fire', async () => {
    w('app/badge/page.tsx', [
      'export default function P() {',
      '  return (',
      '    <code>',
      '      {`<a href="https://gatetest.io/playground"><img src="https://gatetest.io/api/badge?repo=`}',
      '      <span className="text-emerald-400">owner/repo</span>',
      '      {`" alt="GateTest"></a>`}',
      '    </code>',
      '  );',
      '}',
    ].join('\n'));
    const f = await run();
    assert.ok(!f.some((c) => c.name.startsWith('a11y:img-alt:')), JSON.stringify(f.map((c) => c.name)));
  });

  it('POSITIVE: a genuinely alt-less <img> still fires — in HTML and in JSX', async () => {
    w('bare.html', '<html lang="en"><head><title>t</title></head><body><main><img src="hero.png"></main></body></html>');
    w('app/card.tsx', 'export const C = () => <div><img src="/logo.png" width={40} /></div>;');
    const f = await run();
    const names = f.map((c) => c.name);
    assert.ok(names.includes('a11y:img-alt:bare.html'), JSON.stringify(names));
    assert.ok(names.some((n) => n.startsWith('a11y:img-alt:') && n.includes('card.tsx')), JSON.stringify(names));
  });

  it('POSITIVE: an alt-less <img> immediately followed by another tag still fires', async () => {
    // Guards the fix itself: the skip must trigger only when the `<` lands
    // INSIDE the attributes (an unterminated tag), never when the img closes
    // normally and a sibling element follows.
    w('sibling.html', '<html lang="en"><head><title>t</title></head><body><main><img src="a.png"><span>caption</span></main></body></html>');
    const f = await run();
    assert.ok(f.some((c) => c.name === 'a11y:img-alt:sibling.html'), JSON.stringify(f.map((c) => c.name)));
  });

  // ── input-label: the playground search box ──────────────────────────────

  it('POSITIVE: a placeholder-only <input> is unlabelled; NEGATIVE: an sr-only <label htmlFor> labels it', async () => {
    w('app/before.tsx', [
      'export const F = () => (',
      '  <form>',
      '    <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}',
      '      placeholder="https://github.com/owner/repo" className="flex-1" />',
      '  </form>',
      ');',
    ].join('\n'));
    w('app/after.tsx', [
      'export const F = () => (',
      '  <form>',
      '    <label className="sr-only" htmlFor="playground-repo-url">GitHub repository URL to scan</label>',
      '    <input id="playground-repo-url" type="url" value={url}',
      '      onChange={(e) => setUrl(e.target.value)}',
      '      placeholder="https://github.com/owner/repo" className="flex-1" />',
      '  </form>',
      ');',
    ].join('\n'));
    const f = await run();
    const names = f.map((c) => c.name);
    assert.ok(names.some((n) => n.startsWith('a11y:input-label:') && n.includes('before.tsx')), JSON.stringify(names));
    assert.ok(!names.some((n) => n.startsWith('a11y:input-label:') && n.includes('after.tsx')), JSON.stringify(names));
  });

  it('a 4.5–7:1 contrast (passes AA, fails AAA) is a warning; below 4.5:1 stays an error', async () => {
    w('styles/a.css', '.aa { color: #767676; background-color: #ffffff; }\n.bad { color: #aaaaaa; background-color: #ffffff; }');
    const f = await run();
    const contrast = f.filter((c) => c.name.startsWith('a11y:contrast-static:'));
    assert.ok(contrast.length >= 2, JSON.stringify(f.map((c) => c.name)));
    const aa = contrast.find((c) => c.selector === '.aa');
    const bad = contrast.find((c) => c.selector === '.bad');
    assert.strictEqual(aa && aa.severity, 'warning');
    assert.ok(bad && bad.severity !== 'warning');
  });
});
