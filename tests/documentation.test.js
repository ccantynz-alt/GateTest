const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DocumentationModule = require('../src/modules/documentation');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('DocumentationModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docs-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new DocumentationModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new DocumentationModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

// Move 11 (2026-09-05): `_hasApiRoutes` uses the shared route grammar. A
// Fastify API with no API docs used to read as "no API here".
describe('DocumentationModule — API detection is framework-agnostic', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docs-routes-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function docsApi(source) {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'server.js'), source);
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    fs.writeFileSync(path.join(tmp, 'README.md'), '# t\n\nA service.\n');
    const mod = new DocumentationModule();
    const result = makeResult();
    await mod.run(result, { projectRoot: tmp });
    return result.checks.find((c) => c.name === 'docs:api' && !c.passed);
  }

  it('a Fastify API without docs is reported', async () => {
    assert.ok(await docsApi("fastify.get('/users', async () => []);\nfastify.post('/users', async (req) => req.body);\n"));
  });
  it('a file with no routes is not an API', async () => {
    assert.strictEqual(await docsApi('module.exports = { add: (a, b) => a + b };\n'), undefined);
  });
});
