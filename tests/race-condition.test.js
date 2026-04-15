const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RaceConditionModule = require('../src/modules/race-condition');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new RaceConditionModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('RaceConditionModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rc-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no source files exist', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'race-condition:no-files'));
  });

  it('scans JS/TS sources', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'race-condition:scanning'));
  });
});

describe('RaceConditionModule — fs TOCTOU', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rc-fs-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on fs.existsSync followed by fs.unlink on same path', async () => {
    write(tmp, 'src/a.ts', [
      'function cleanup(p) {',
      '  if (fs.existsSync(p)) {',
      '    fs.unlinkSync(p);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('race-condition:fs-toctou:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does NOT flag the idempotent if(!exists) mkdir/writeFile setup pattern', async () => {
    write(tmp, 'src/a.ts', [
      'function setup(dir) {',
      '  if (!fs.existsSync(dir)) {',
      '    fs.mkdirSync(dir, { recursive: true });',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('race-condition:fs-toctou:')),
      undefined,
    );
  });

  it('errors on fs.stat followed by fs.unlink on same path', async () => {
    write(tmp, 'src/a.js', [
      'async function nuke(p) {',
      '  const stat = await fs.promises.stat(p);',
      '  if (stat.isFile()) {',
      '    await fs.promises.unlink(p);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('race-condition:fs-toctou:')));
  });

  it('downgrades to warning in test files', async () => {
    write(tmp, 'tests/a.test.ts', [
      'it("cleans up", () => {',
      '  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('race-condition:fs-toctou:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does NOT flag unrelated fs.writeFile with no preceding check', async () => {
    write(tmp, 'src/a.ts', [
      'async function save(p, data) {',
      '  await fs.promises.writeFile(p, data);',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('race-condition:fs-toctou:')),
      undefined,
    );
  });
});

describe('RaceConditionModule — get-or-create race', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rc-goc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on prisma.user.findFirst then prisma.user.create with no tx', async () => {
    write(tmp, 'src/a.ts', [
      'async function getOrCreate(email) {',
      '  const existing = await prisma.user.findFirst({ where: { email } });',
      '  if (existing) return existing;',
      '  return await prisma.user.create({ data: { email } });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('race-condition:get-or-create:'));
    assert.ok(hit, `expected get-or-create hit, got: ${JSON.stringify(r.checks.map((c) => c.name))}`);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('warns on Sequelize User.findOne then User.update with no tx', async () => {
    write(tmp, 'src/a.js', [
      'async function maybeActivate(id) {',
      '  const u = await User.findOne({ where: { id } });',
      '  if (!u.active) {',
      '    await User.update({ active: true }, { where: { id } });',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('race-condition:get-or-create:')));
  });

  it('does NOT warn when $transaction wraps the get-then-create', async () => {
    write(tmp, 'src/a.ts', [
      'async function getOrCreate(email) {',
      '  return await prisma.$transaction(async (tx) => {',
      '    const existing = await prisma.user.findFirst({ where: { email } });',
      '    if (existing) return existing;',
      '    return await prisma.user.create({ data: { email } });',
      '  }, { isolationLevel: "Serializable" });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('race-condition:get-or-create:')),
      undefined,
    );
  });

  it('does NOT warn when the findFirst is followed by an upsert', async () => {
    write(tmp, 'src/a.ts', [
      'async function getOrCreate(email) {',
      '  const existing = await prisma.user.findFirst({ where: { email } });',
      '  return await prisma.user.upsert({ where: { email }, create: { email }, update: {} });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('race-condition:get-or-create:')),
      undefined,
    );
  });

  it('does NOT warn when P2002 error code is handled', async () => {
    write(tmp, 'src/a.ts', [
      'async function getOrCreate(email) {',
      '  const existing = await prisma.user.findFirst({ where: { email } });',
      '  if (existing) return existing;',
      '  try {',
      '    return await prisma.user.create({ data: { email } });',
      '  } catch (err) {',
      '    if (err.code === "P2002") return await prisma.user.findFirst({ where: { email } });',
      '    throw err;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('race-condition:get-or-create:')),
      undefined,
    );
  });
});

describe('RaceConditionModule — negatives', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rc-neg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag a find without a subsequent mutate', async () => {
    write(tmp, 'src/a.ts', [
      'async function getUser(id) {',
      '  return await prisma.user.findUnique({ where: { id } });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0);
  });

  it('does NOT flag check-then-act shapes inside a string literal', async () => {
    write(tmp, 'src/a.ts', [
      'const docs = "if (!fs.existsSync(p)) fs.writeFile(p, data);";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0);
  });
});

describe('RaceConditionModule — clean baseline', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rc-clean-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('emits zero findings for atomic fs.open(wx) pattern', async () => {
    write(tmp, 'src/a.ts', [
      'async function createExclusive(p, data) {',
      '  await fs.promises.writeFile(p, data, { flag: "wx" });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0);
  });

  it('records a summary', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'race-condition:summary');
    assert.ok(s);
    assert.match(s.message, /1 file\(s\)/);
  });
});
