const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NPlusOneModule = require('../src/modules/n-plus-one');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new NPlusOneModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('NPlusOneModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no source files exist', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'n-plus-one:no-files'));
  });

  it('scans JS/TS sources', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'n-plus-one:scanning'));
  });
});

describe('NPlusOneModule — block-form loops', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-block-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on Prisma query in for..of loop', async () => {
    write(tmp, 'src/a.ts', [
      'async function loadAll(userIds) {',
      '  const out = [];',
      '  for (const id of userIds) {',
      '    const u = await prisma.user.findUnique({ where: { id } });',
      '    out.push(u);',
      '  }',
      '  return out;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.strictEqual(hit.loopStart, 3);
  });

  it('errors on Sequelize query in while loop', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  let i = 0;',
      '  while (i < 10) {',
      '    const u = await User.findOne({ where: { id: i } });',
      '    i += 1;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });

  it('errors on raw pool.query in for loop', async () => {
    write(tmp, 'src/a.js', [
      'async function run(ids) {',
      '  for (let i = 0; i < ids.length; i += 1) {',
      '    await pool.query("SELECT * FROM users WHERE id = $1", [ids[i]]);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });
});

describe('NPlusOneModule — callback-form loops', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-cb-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on prisma query in forEach', async () => {
    write(tmp, 'src/a.ts', [
      'async function run(users) {',
      '  users.forEach(async (u) => {',
      '    await prisma.order.findMany({ where: { userId: u.id } });',
      '  });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });

  it('records info on `await Promise.all(arr.map(async () => await db.query(...)))` (batched-ok)', async () => {
    write(tmp, 'src/a.ts', [
      'async function run(userIds) {',
      '  return await Promise.all(userIds.map(async (id) => {',
      '    return await prisma.user.findUnique({ where: { id } });',
      '  }));',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0, `expected zero issues, got: ${JSON.stringify(issues)}`);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:batched-ok:')));
  });
});

describe('NPlusOneModule — negatives', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-neg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag a query NOT in a loop', async () => {
    write(tmp, 'src/a.ts', [
      'async function loadOne(id) {',
      '  return await prisma.user.findUnique({ where: { id } });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')),
      undefined,
    );
  });

  it('does NOT flag a synchronous operation in a loop', async () => {
    write(tmp, 'src/a.ts', [
      'function run(items) {',
      '  for (const item of items) {',
      '    const x = item.id * 2;',
      '    console.log(x);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')),
      undefined,
    );
  });

  it('does NOT flag a non-query await in a loop (e.g. crypto)', async () => {
    write(tmp, 'src/a.ts', [
      'async function run(items) {',
      '  for (const item of items) {',
      '    const hash = await crypto.subtle.digest("SHA-256", item.buf);',
      '    item.hash = hash;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')),
      undefined,
    );
  });

  it('does NOT flag query shape embedded in a string literal', async () => {
    write(tmp, 'src/a.ts', [
      'function docs() {',
      '  const example = "for (const x of arr) { await prisma.user.findUnique(); }";',
      '  return example;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')),
      undefined,
    );
  });
});

describe('NPlusOneModule — ORM coverage', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-orm-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('detects Mongoose Model.findOne in a loop', async () => {
    write(tmp, 'src/a.js', [
      'async function run(ids) {',
      '  for (const id of ids) {',
      '    const u = await User.findOne({ _id: id });',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });

  it('detects TypeORM repo.findOneBy in a loop', async () => {
    write(tmp, 'src/a.ts', [
      'async function run(ids) {',
      '  for (const id of ids) {',
      '    const u = await repo.findOneBy({ id });',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });

  it('detects Drizzle db.select in a loop', async () => {
    write(tmp, 'src/a.ts', [
      'async function run(ids) {',
      '  for (const id of ids) {',
      '    const u = await db.select().from(users).where(eq(users.id, id));',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('n-plus-one:query-in-loop:')));
  });
});

describe('NPlusOneModule — clean baseline', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-clean-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('emits zero findings for batched code', async () => {
    write(tmp, 'src/a.ts', [
      'async function loadAll(ids) {',
      '  return await prisma.user.findMany({ where: { id: { in: ids } } });',
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
    const s = r.checks.find((c) => c.name === 'n-plus-one:summary');
    assert.ok(s);
    assert.match(s.message, /1 file\(s\)/);
  });
});

// ---------------------------------------------------------------------------
// prisma/prisma @ HEAD (2026-09-05): 25 `query-in-loop`, 6 blocking, none a
// per-row lookup — DDL in a setup loop, `SELECT 1` in a wait-for-db loop, a
// statement list being replayed, and fixture rows seeded in test setup.
// ---------------------------------------------------------------------------

describe('NPlusOneModule — what a loop of queries is NOT', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-np-scope-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const hits = (r) => r.checks.filter((c) => c.name.startsWith('n-plus-one:query-in-loop:'));

  it('DDL and `SELECT 1` in a loop are not reported', async () => {
    write(tmp, 'scripts/record.ts', [
      'async function prepare(client, count) {',
      '  for (let i = 0; i < count; i++) {',
      '    const dbName = `prisma_rec_${i}`;',
      // prisma packages/1-framework/3-tooling/cli/scripts/record.ts:435-436, :448
      '    await client.query(`DROP DATABASE IF EXISTS ${dbName}`);',
      '    await client.query(`CREATE DATABASE ${dbName}`);',
      '    await client.query(`DROP DATABASE IF EXISTS prisma_rec_${i}`);',
      '  }',
      '  while (true) {',
      // prisma packages/1-framework/3-tooling/cli/scripts/record.ts:348
      "    try { await client.query('SELECT 1'); break; } catch { await sleep(100); }",
      '  }',
      '}',
      '',
    ].join('\n'));
    assert.deepStrictEqual(hits(await run(tmp)), []);
  });

  it('an opaque pre-built statement is a warning that says so', async () => {
    write(tmp, 'src/index.ts', [
      'async function setup(connection, conformanceCase) {',
      '  for (const statement of conformanceCase.setupSql ?? []) {',
      // prisma packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts:333
      '    await connection.query(statement);',
      '  }',
      '  for (const action of actions) {',
      // prisma packages/1-framework/3-tooling/cli/scripts/record.ts:417
      '    await client.query(action.query);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const found = hits(await run(tmp));
    assert.strictEqual(found.length, 2);
    for (const f of found) {
      assert.strictEqual(f.severity, 'warning');
      assert.strictEqual(f.opaque, true);
      assert.match(f.message, /cannot tell/);
    }
  });

  it('a per-row lookup through a raw driver in application code is still an error', async () => {
    write(tmp, 'src/orders.ts', [
      'async function load(client, users) {',
      '  for (const u of users) {',
      '    const r = await client.query(`SELECT * FROM orders WHERE user_id = ${u.id}`);',
      '    await client.query("SELECT * FROM profiles WHERE id = $1", [u.id]);',
      '    await client.query(buildQuery(u.id));',
      '  }',
      '}',
      '',
    ].join('\n'));
    const found = hits(await run(tmp));
    assert.deepStrictEqual(found.map((f) => [f.line, f.severity]), [[3, 'error'], [4, 'error'], [5, 'error']]);
  });

  it('a test harness seeding rows is a warning, the same loop in src/ an error', async () => {
    const src = [
      'async function seed(db, input) {',
      '  for (const id of ids) {',
      // prisma test/integration/test/ports/engines/queries/aggregation/uniq-count-relation/uniq-count-relation.test.ts:16
      '    await db.public.Comment.create({ id, postId: input.id });',
      '  }',
      '}',
      '',
    ].join('\n');
    write(tmp, 'test/integration/uniq-count-relation.test.ts', src);
    write(tmp, 'benchmarks/seed.ts', src);
    write(tmp, 'src/seed.ts', src);
    const found = hits(await run(tmp));
    const by = Object.fromEntries(found.map((f) => [f.file, f]));
    assert.strictEqual(by['test/integration/uniq-count-relation.test.ts'].severity, 'warning');
    assert.strictEqual(by['test/integration/uniq-count-relation.test.ts'].harness, true);
    assert.strictEqual(by['benchmarks/seed.ts'].severity, 'warning');
    assert.strictEqual(by['src/seed.ts'].severity, 'error');
  });
});

describe('NPlusOneModule — one stripper (control pair)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-npo-mask-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a query in a loop inside a string, a template or a comment is not a query; the real one beside them is (2026-09-05)', async () => {
    write(tmp, 'src/users.js', [
      'const doc = "for (const u of users) { await prisma.user.findUnique({ where: { id: u.id } }); }";',
      'const tpl = `for (const u of users) {',
      '  await prisma.user.findUnique({ where: { id: u.id } });',
      '}`;',
      '/*',
      'for (const u of users) {',
      '  await prisma.user.findUnique({ where: { id: u.id } });',
      '}',
      '*/',
      'async function real(users) {',
      '  for (const u of users) {',
      '    await prisma.user.findUnique({ where: { id: u.id } });',
      '  }',
      '}',
      'module.exports = { doc, tpl, real };',
    ].join('\n'));
    const r = await run(tmp);
    const flagged = r.checks.filter((c) => !c.passed && /^n-plus-one:/.test(c.name));
    assert.deepStrictEqual(
      flagged.map((c) => c.name),
      ['n-plus-one:query-in-loop:src/users.js:12'],
      'only the real query on line 12 sits inside a loop',
    );
    assert.strictEqual(flagged[0].loopStart, 11);
  });

  it('still reads the knex table name from inside the quotes — db("users").where(...) in a loop is reported (2026-09-05)', async () => {
    write(tmp, 'src/knex.js', [
      'async function real(ids, db) {',
      '  for (const id of ids) {',
      "    await db('users').where({ id }).first();",
      '  }',
      '}',
      'module.exports = { real };',
    ].join('\n'));
    const r = await run(tmp);
    const flagged = r.checks.filter((c) => !c.passed && /^n-plus-one:/.test(c.name));
    assert.deepStrictEqual(flagged.map((c) => c.name), ['n-plus-one:query-in-loop:src/knex.js:3']);
  });
});
