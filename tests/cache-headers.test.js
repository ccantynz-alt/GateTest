'use strict';

// cacheHeaders — `_checkApiRoutes` only ever opened `app/api/**/route.*`
// (KI #106): a Pages Router or SvelteKit app was told "API routes have
// cache headers configured" over files it never read.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CacheHeadersModule = require('../src/modules/cache-headers');

function makeResult() {
  const checks = [];
  return { checks, addCheck(name, passed, details) { checks.push({ name, passed, ...(details || {}) }); } };
}

describe('CacheHeadersModule — API routes', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cache-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const w = (rel, c) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  const routes = async () => {
    const r = makeResult();
    await new CacheHeadersModule()._checkApiRoutes(tmp, r);
    return r.checks;
  };

  it('POSITIVE: five Pages Router API files with no Cache-Control are reported (was: never opened)', async () => {
    for (let i = 0; i < 5; i += 1) w(`pages/api/item${i}.ts`, 'export default function handler(req, res) { res.json({ i: ' + i + ' }); }\n');
    const c = await routes();
    assert.ok(c.some((x) => x.name === 'api-routes-no-cache' && !x.passed), JSON.stringify(c));
  });

  it('SvelteKit `+server.ts` and a root `api/` functions dir count as API routes', async () => {
    for (let i = 0; i < 3; i += 1) w(`src/routes/api/x${i}/+server.ts`, 'export async function GET() { return new Response("x"); }\n');
    for (let i = 0; i < 2; i += 1) w(`api/fn${i}.js`, 'module.exports = (req, res) => res.send("ok");\n');
    const c = await routes();
    assert.ok(c.some((x) => x.name === 'api-routes-no-cache' && !x.passed), JSON.stringify(c));
  });

  it('NEGATIVE: routes that set Cache-Control pass; test files under pages/api are not routes', async () => {
    for (let i = 0; i < 5; i += 1) w(`pages/api/item${i}.ts`, "export default function handler(req, res) { res.setHeader('Cache-Control', 'no-store'); res.json({}); }\n");
    for (let i = 0; i < 5; i += 1) w(`pages/api/__tests__/item${i}.test.ts`, 'it("x", () => {});\n');
    const c = await routes();
    assert.ok(c.some((x) => x.name === 'api-routes-cache' && x.passed), JSON.stringify(c));
    assert.ok(!c.some((x) => x.name === 'api-routes-no-cache'));
  });

  it('a component under app/ that is not an API route is ignored', async () => {
    for (let i = 0; i < 5; i += 1) w(`app/dashboard/page${i}.tsx`, 'export default function P() { return null; }\n');
    assert.deepEqual(await routes(), []);
  });
});
