const { describe, it } = require('node:test');
const assert = require('node:assert');

const LinksModule = require('../src/modules/links');

describe('LinksModule — baseline shape', () => {
  it('exposes the expected BaseModule shape', () => {
    const mod = new LinksModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });
});

// ── precision (2026-08-18 audit: 7/7 repos blocked on links:internal) ────────
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('LinksModule — internal-link classification', () => {
  const runOn = async (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-links-'));
    try {
      for (const [rel, c] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), c);
      }
      const checks = [];
      await new LinksModule().run({ addCheck: (n, p, d = {}) => checks.push({ n, p, ...d }) }, { projectRoot: root, getModuleConfig() { return {}; }, get() { return null; } });
      return checks;
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  };

  it('irc:/ftp:/sms: schemes, Thymeleaf @{…}, and template expressions are not broken internal links', async () => {
    const checks = await runOn({
      'README.md': 'Chat on [IRC](irc://irc.libera.chat/gin) or [FTP](ftp://x.example/y).',
      'templates/owner.html': '<a th:href="@{/owners/{id}(id=${owner.id})}">x</a><a href="{{ url_for(\'index\') }}">y</a><a href="<%= path %>">z</a>',
    });
    const internal = checks.find((c) => c.n === 'links:internal');
    assert.ok(internal && internal.p, JSON.stringify(internal));
  });

  it('a placeholder href inside a docs/MDX example is not a shipped dead link, and one line is reported once', async () => {
    const checks = await runOn({
      'content/docs/anchors.mdx': '<a href="#">demo</a> <a href="#">demo</a>',
      'src/App.jsx': 'export default () => <><a href="#">a</a><a href="#">b</a></>;',
    });
    const dead = checks.find((c) => c.n === 'links:dead-links');
    assert.ok(dead && !dead.p, 'the real App.jsx placeholder must still fire');
    assert.strictEqual(dead.details.length, 1, JSON.stringify(dead.details));
    assert.strictEqual(dead.details[0].source.split(path.sep).join('/'), 'src/App.jsx');
  });

  it('POSITIVE CONTROL: a relative link to a missing file is still broken', async () => {
    const checks = await runOn({ 'docs/a.md': 'See [b](./b.md).' });
    const internal = checks.find((c) => c.n === 'links:internal');
    assert.ok(internal && !internal.p, JSON.stringify(internal));
  });
});
