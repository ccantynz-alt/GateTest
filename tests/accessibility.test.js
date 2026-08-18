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

  it('a UI-kit primitive input (components/ui/input.tsx) and a commented-out <input> are not "unlabelled"', async () => {
    w('components/ui/input.tsx', 'export const Input = (props) => <input className="x" {...props} />;');
    w('pages/form.html', '<html><head></head><body><main><!-- <input type="text"> --><label for="q">Q</label><input id="q" type="text"></main></body></html>');
    const f = await run();
    assert.ok(!f.some((c) => c.name.startsWith('a11y:input-label:')), JSON.stringify(f.map((c) => c.name)));
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
