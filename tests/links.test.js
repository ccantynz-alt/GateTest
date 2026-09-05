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

// ── resolver: how docs SITES and npm spell a path (2026-09-05 corpus: nest 46,
//    apollo-server 277, trpc 75, prisma 1134 "broken" internal links) ──────────
describe('LinksModule — internal-link resolver reads the link the way its renderer does', () => {
  const runOn = async (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-links-res-'));
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
  const internal = (checks) => checks.find((c) => c.n === 'links:internal');

  it('NEGATIVE: a URL-encoded path (prisma AGENTS.md → docs/Architecture%20Overview.md) resolves', async () => {
    const checks = await runOn({
      'AGENTS.md': 'Read [the overview](docs/Architecture%20Overview.md) first.',
      'docs/Architecture Overview.md': '# Overview',
    });
    assert.ok(internal(checks).p, JSON.stringify(internal(checks)));
  });

  it('NEGATIVE: docs-site routes resolve to their .md/.mdx files (apollo docs/source/api/apollo-server.mdx, trpc www/docs/server/adapters-intro.md)', async () => {
    const checks = await runOn({
      'docs/source/api/apollo-server.mdx': '[Get started](../getting-started) · [SDL](../schema/schema/#the-schema-definition-language) · [resolvers](../data/resolvers/)',
      'docs/source/getting-started.mdx': '# Getting started',
      'docs/source/schema/schema.md': '# Schema',
      'docs/source/data/resolvers.mdx': '# Resolvers',
      'www/docs/server/adapters-intro.md': 'See [standalone](adapters/standalone) and [fetch](adapters/fetch).',
      'www/docs/server/adapters/standalone.md': '# Standalone',
      'www/docs/server/adapters/fetch.mdx': '# Fetch',
    });
    assert.ok(internal(checks).p, JSON.stringify(internal(checks)));
  });

  it('NEGATIVE: a README beside a package.json may link repo-root files (npm rewrites them) — nest packages/common/Readme.md', async () => {
    const checks = await runOn({
      'packages/common/Readme.md': '[中文](readme_zh.md) · [License](LICENSE)',
      'packages/common/package.json': '{"name":"@nestjs/common"}',
      'readme_zh.md': '# 中文',
      'LICENSE': 'MIT',
    });
    assert.ok(internal(checks).p, JSON.stringify(internal(checks)));
  });

  it('POSITIVE: the same README WITHOUT a package.json beside it is still broken (the root-relative hit is npm\'s, not GitHub\'s)', async () => {
    const checks = await runOn({
      'packages/common/Readme.md': '[中文](readme_zh.md)',
      'readme_zh.md': '# 中文',
    });
    assert.ok(!internal(checks).p, JSON.stringify(internal(checks)));
  });

  it('POSITIVE: a genuinely missing target still fires, and at WARNING severity (apollo CONTRIBUTING.md → ./ROADMAP.md)', async () => {
    const checks = await runOn({ 'CONTRIBUTING.md': 'See the [roadmap](./ROADMAP.md) and [changesets](changesets).' });
    const c = internal(checks);
    assert.ok(c && !c.p, JSON.stringify(c));
    assert.strictEqual(c.severity, 'warning');
    assert.strictEqual(c.details.length, 2);
  });

  it('NEGATIVE: href="#" drawn into an ImageResponse (trpc www/og-image/pages/api/_ref/tailwind.tsx) is paint; POSITIVE: a page placeholder still fires', async () => {
    const checks = await runOn({
      'www/og-image/pages/api/_ref/tailwind.tsx': [
        "import { ImageResponse } from '@vercel/og';",
        'export default function handler() {',
        '  return new ImageResponse(',
        '    <div tw="flex"><a href="#" tw="text-blue-600">Home</a><a href="#" tw="text-blue-600">Docs</a></div>,',
        '  );',
        '}',
      ].join('\n'),
      'src/App.jsx': 'export default () => <a href="#">a</a>;',
    });
    const dead = checks.find((c) => c.n === 'links:dead-links');
    assert.ok(dead && !dead.p, 'the real App.jsx placeholder must still fire');
    assert.strictEqual(dead.details.length, 1, JSON.stringify(dead.details));
    assert.strictEqual(dead.details[0].source.split(path.sep).join('/'), 'src/App.jsx');
  });
});
