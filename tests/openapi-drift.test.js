const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OpenApiDriftModule = require('../src/modules/openapi-drift');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new OpenApiDriftModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('OpenApiDriftModule — no-spec', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-no-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('is a no-op when no spec is present', async () => {
    write(tmp, 'src/a.ts', 'app.get("/x", h);\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'openapi-drift:no-spec'));
  });
});

describe('OpenApiDriftModule — undocumented-route', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-undoc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors when Express route is missing from spec', async () => {
    write(tmp, 'openapi.yaml', [
      'openapi: 3.0.0',
      'info:',
      '  title: API',
      '  version: "1.0"',
      'paths:',
      '  /users:',
      '    get:',
      '      summary: list',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', [
      'app.get("/users", listUsers);',
      'app.post("/admin/backdoor", secretRoute);',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name === 'openapi-drift:undocumented-route:POST:/admin/backdoor');
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors when Fastify route is missing from spec', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /a:',
      '    get: { summary: a }',
      '',
    ].join('\n'));
    write(tmp, 'src/server.ts', 'fastify.post("/b", handler);\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'openapi-drift:undocumented-route:POST:/b'));
  });

  it('errors when Next.js App Router route is missing from spec', async () => {
    write(tmp, 'openapi.json', JSON.stringify({ paths: { '/api/users': { get: {} } } }));
    write(tmp, 'app/api/secret/route.ts', [
      'export async function POST(req) { return Response.json({}); }',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'openapi-drift:undocumented-route:POST:/api/secret'));
  });

  it('does NOT flag when route is declared in spec (both Express and Fastify path shape)', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /users/{id}:',
      '    get:',
      '      summary: get-one',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', 'router.get("/users/:id", getOne);\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('openapi-drift:undocumented-route:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('OpenApiDriftModule — spec-ghost-route', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-ghost-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns when spec declares a path with no matching handler', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /users:',
      '    get:',
      '      summary: list',
      '  /dead-endpoint:',
      '    post:',
      '      summary: nothing here',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', 'app.get("/users", listUsers);\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name === 'openapi-drift:spec-ghost-route:POST:/dead-endpoint');
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('matches Next.js App Router route against spec path with dynamic segment', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /api/users/{id}:',
      '    get: { summary: one }',
      '',
    ].join('\n'));
    write(tmp, 'app/api/users/[id]/route.ts', [
      'export async function GET(req) { return Response.json({}); }',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('openapi-drift:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('OpenApiDriftModule — path-param normalisation', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-norm-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('treats :id and {userId} as matching shapes', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /users/{userId}:',
      '    get: { summary: by-id }',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', 'app.get("/users/:id", h);\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('openapi-drift:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('treats trailing slash as equivalent', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /things:',
      '    get: { summary: all }',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', 'app.get("/things/", h);\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('openapi-drift:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('OpenApiDriftModule — test files', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-tests-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('ignores routes defined in test/spec paths', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /users:',
      '    get: { summary: list }',
      '',
    ].join('\n'));
    write(tmp, 'tests/routes.test.ts', 'app.post("/fake-test-route", stub);\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('openapi-drift:undocumented-route:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('OpenApiDriftModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-oa-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 'openapi.yaml', [
      'paths:',
      '  /users:',
      '    get: { summary: list }',
      '',
    ].join('\n'));
    write(tmp, 'src/routes.ts', 'app.get("/users", h);\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'openapi-drift:summary');
    assert.ok(s);
    assert.match(s.message, /spec path\(s\).*code route\(s\)/);
  });
});
