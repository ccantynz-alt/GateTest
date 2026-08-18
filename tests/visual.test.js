'use strict';

// VISUAL MODULE — behavioural tests with positive AND negative controls for
// the false-positive classes measured 2026-08-18 (93 blocking errors on 9
// real repos: viewport on fragments/framework layouts, "no fallback" on
// `var(--x)`/`inherit`, duplicate-token on compiled Bootstrap).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VisualModule = require('../src/modules/visual');

function makeResult() {
  const checks = [];
  return { checks, addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); } };
}
async function scan(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-visual-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const result = makeResult();
    await new VisualModule().run(result, { projectRoot: root, getModuleConfig() { return {}; }, get() { return null; } });
    return result.checks.filter((c) => !c.passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const ids = (f) => f.map((c) => c.id);

describe('VisualModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new VisualModule();
    assert.equal(typeof mod.name, 'string');
    assert.equal(typeof mod.run, 'function');
  });
});

describe('VisualModule — viewport', () => {
  it('POSITIVE: a full HTML document without a viewport meta fails', async () => {
    const f = await scan({ 'index.html': '<html><head><title>x</title></head><body></body></html>' });
    assert.ok(ids(f).includes('visual:viewport:index.html'), ids(f).join());
  });
  it('NEGATIVE: a fragment (no <head>) and a Next.js layout.tsx (framework injects viewport) are silent', async () => {
    const f = await scan({
      'templates/nav.html': '<div th:fragment="nav"><html-ish></div>',
      'app/layout.tsx': 'export default function RootLayout({children}){ return <html lang="en"><body>{children}</body></html>; }',
    });
    assert.ok(!ids(f).some((i) => i.startsWith('visual:viewport:')), ids(f).join());
  });
});

describe('VisualModule — font fallback', () => {
  it('POSITIVE: a lone web font with no generic fallback warns', async () => {
    const f = await scan({ 'styles/a.css': 'body { font-family: "Inter"; }' });
    const hit = f.find((c) => c.id === 'styles/a.css' || c.id.startsWith('visual:font-fallback:'));
    assert.ok(hit, ids(f).join());
    assert.equal(hit.meta.severity, 'warning', 'a missing fallback is not a gate-blocking defect');
  });
  it('NEGATIVE: var(--token), inherit and -apple-system stacks are not "fonts without fallback"', async () => {
    const f = await scan({ 'styles/b.css': 'body{font-family: var(--bs-body-font-family);} code{font-family: inherit;} h1{font-family: -apple-system;}' });
    assert.ok(!ids(f).some((i) => i.startsWith('visual:font-fallback:')), ids(f).join());
  });
});

describe('VisualModule — duplicate design tokens', () => {
  it('NEGATIVE: compiled Bootstrap re-declaring --bs-* per component is scoping, not inconsistency', async () => {
    const css = ['.btn{--bs-btn-color:#fff;}', '.btn-primary{--bs-btn-color:#000;}', '.card{--bs-btn-color:#111;}', '.nav{--bs-btn-color:#222;}', '.x{--bs-btn-color:#333;}'].join('\n');
    const f = await scan({ 'static/css/bootstrap.min.css': css, 'src/theme.css': css });
    assert.ok(!ids(f).some((i) => i.startsWith('visual:duplicate-token:')), ids(f).join());
  });
  it('POSITIVE: the same token declared in more than three separate hand-written files is reported (as info)', async () => {
    const files = {};
    for (let i = 0; i < 5; i++) files[`src/part${i}.css`] = `:root{--brand:#0${i}0;}`;
    const f = await scan(files);
    const hit = f.find((c) => c.id === 'visual:duplicate-token:--brand');
    assert.ok(hit, ids(f).join());
    assert.equal(hit.meta.severity, 'info');
  });
});
