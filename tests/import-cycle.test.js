const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ImportCycleModule = require('../src/modules/import-cycle');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new ImportCycleModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('ImportCycleModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('no-op when no source files', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'import-cycle:no-files'));
  });

  it('records summary when files exist', async () => {
    write(tmp, 'src/a.js', 'module.exports = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'import-cycle:summary'));
  });
});

describe('ImportCycleModule — direct 2-file cycles', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-2-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on a.js <-> b.js import cycle (ESM)', async () => {
    write(tmp, 'src/a.js', 'import { B } from "./b";\nexport const A = 1;\n');
    write(tmp, 'src/b.js', 'import { A } from "./a";\nexport const B = 2;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('import-cycle:cycle:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.ok(hit.files.includes('src/a.js'));
    assert.ok(hit.files.includes('src/b.js'));
  });

  it('errors on a.js <-> b.js cycle (CommonJS require)', async () => {
    write(tmp, 'src/a.js', 'const b = require("./b");\nmodule.exports = { a: 1, b };\n');
    write(tmp, 'src/b.js', 'const a = require("./a");\nmodule.exports = { b: 2, a };\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('import-cycle:cycle:')));
  });

  it('no cycle when imports are acyclic', async () => {
    write(tmp, 'src/a.js', 'import { B } from "./b";\nexport const A = B;\n');
    write(tmp, 'src/b.js', 'export const B = 2;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('ImportCycleModule — 3-file cycle', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-3-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on a -> b -> c -> a', async () => {
    write(tmp, 'src/a.ts', 'import "./b";\nexport const A = 1;\n');
    write(tmp, 'src/b.ts', 'import "./c";\nexport const B = 2;\n');
    write(tmp, 'src/c.ts', 'import "./a";\nexport const C = 3;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('import-cycle:cycle:'));
    assert.ok(hit);
    assert.strictEqual(hit.files.length, 3);
  });
});

describe('ImportCycleModule — self-loop', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-self-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on file importing itself', async () => {
    write(tmp, 'src/a.js', 'import "./a";\nexport const A = 1;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('import-cycle:self-loop:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });
});

describe('ImportCycleModule — type-only imports', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-type-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does not flag `import type` cycles — erased at build time', async () => {
    write(tmp, 'src/a.ts', 'import type { B } from "./b";\nexport type A = B;\n');
    write(tmp, 'src/b.ts', 'import type { A } from "./a";\nexport type B = A;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('does not flag `export type` cycles', async () => {
    write(tmp, 'src/a.ts', 'export type { B } from "./b";\n');
    write(tmp, 'src/b.ts', 'export type { A } from "./a";\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('ImportCycleModule — lazy require inside function', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-lazy-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does not flag require(...) inside a function body (lazy)', async () => {
    write(tmp, 'src/a.js', 'function getB() {\n  const b = require("./b");\n  return b;\n}\nmodule.exports = getB;\n');
    write(tmp, 'src/b.js', 'const a = require("./a");\nmodule.exports = { b: 2, a };\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('ImportCycleModule — external & bare imports', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-bare-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips bare-package imports (no cycle possible)', async () => {
    write(tmp, 'src/a.js', 'import React from "react";\nexport const A = 1;\n');
    write(tmp, 'src/b.js', 'import lodash from "lodash";\nexport const B = 2;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('ImportCycleModule — index.js resolution', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-idx-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('resolves ./x/index.js when importing ./x', async () => {
    write(tmp, 'src/a.js', 'import { B } from "./b";\nexport const A = 1;\n');
    write(tmp, 'src/b/index.js', 'import { A } from "../a";\nexport const B = 2;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('import-cycle:cycle:'));
    assert.ok(hit);
  });
});

describe('ImportCycleModule — suppressions', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-sup-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('honours // import-cycle-ok on the import line', async () => {
    write(tmp, 'src/a.js', 'import { B } from "./b"; // import-cycle-ok — legacy\nexport const A = 1;\n');
    write(tmp, 'src/b.js', 'import { A } from "./a";\nexport const B = 2;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('import-cycle:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('ImportCycleModule — test path downgrade', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ic-test-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('downgrades error -> warning when any file in cycle is in a test path', async () => {
    write(tmp, 'tests/a.test.js', 'import { B } from "./b";\nexport const A = 1;\n');
    write(tmp, 'tests/b.js', 'import { A } from "./a.test";\nexport const B = 2;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('import-cycle:cycle:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });
});
