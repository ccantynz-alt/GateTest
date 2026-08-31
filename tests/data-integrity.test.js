const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DataIntegrityModule = require('../src/modules/data-integrity');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('DataIntegrityModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dataint-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new DataIntegrityModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new DataIntegrityModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

/**
 * SQL-injection detection: position matters, and multi-line counts.
 *
 * Found 2026-07-28 by scanning an all-inert fixture — a handbook file whose
 * every dangerous construct sits inside a doc string. `data:sql-injection`
 * fired on it as a BLOCKING error:
 *
 *   sqlTmpl: "db.query(`SELECT * FROM u WHERE id = ${req.query.id}`)",
 *
 * The discriminator is where `query(` sits. In real code it IS code; in the
 * handbook it is inside an outer string. Checking the match position beats
 * dropping to a line-by-line scan, which would have lost the multi-line
 * form entirely.
 *
 * And while verifying that, the multi-line form turned out never to have
 * been detected at all — the pattern demanded SELECT immediately after the
 * opening quote. Confirmed against the pre-change code rather than assumed.
 */
describe('data-integrity — SQL injection: strings vs code, single vs multi-line', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-di-sqli-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function scan(rel, source) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    const mod = new DataIntegrityModule();
    const result = makeResult();
    await mod.run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && c.name.startsWith('data:sql-injection'));
  }

  it('does NOT flag a query snippet quoted inside a doc string', async () => {
    const found = await scan('src/handbook.js', [
      'const RULES = {',
      '  sqlTmpl: "db.query(`SELECT * FROM u WHERE id = ${req.query.id}`)",',
      '};',
      'module.exports = { RULES };',
    ].join('\n'));
    assert.deepStrictEqual(found.map((f) => f.name), []);
  });

  it('does NOT flag a query snippet inside a comment', async () => {
    const found = await scan('src/notes.js', [
      '// never write db.query(`SELECT * FROM u WHERE id = ${id}`)',
      'const a = 1;',
      'module.exports = { a };',
    ].join('\n'));
    assert.deepStrictEqual(found.map((f) => f.name), []);
  });

  it('DOES flag a real single-line interpolated query', async () => {
    const found = await scan('src/db.js', [
      'async function one(db, req) {',
      '  return db.query(`SELECT * FROM users WHERE id = ${req.query.id}`);',
      '}',
      'module.exports = { one };',
    ].join('\n'));
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].line, 2, 'the finding must carry a line number');
  });

  it('DOES flag a real MULTI-LINE interpolated query', async () => {
    // This shape was never detected before 2026-07-28.
    const found = await scan('src/db2.js', [
      'async function many(db, req) {',
      '  return db.query(`',
      '    SELECT * FROM users WHERE id = ${req.query.id}',
      '  `);',
      '}',
      'module.exports = { many };',
    ].join('\n'));
    assert.strictEqual(found.length, 1, 'multi-line queries are the common formatting');
  });

  it('does NOT flag a parameterised query', async () => {
    const found = await scan('src/safe.js', [
      'async function safe(db, req) {',
      '  return db.query("SELECT * FROM users WHERE id = $1", [req.query.id]);',
      '}',
      'module.exports = { safe };',
    ].join('\n'));
    assert.deepStrictEqual(found.map((f) => f.name), []);
  });
});

/**
 * PII — "Sensitive data serialized": where the bytes GO decides it.
 *
 * `JSON.stringify(...)` containing the word token/password/secret was a
 * blocking error wherever it appeared. That flags the shape of every login form
 * and every "save my API key" form ever written, including this repo's own
 * admin PAT form (website/app/admin/tabs/AccountsTab.tsx:49), which POSTs the
 * token to our own API so it can be stored — the whole point of the feature.
 * Nothing is logged, put in a URL, or written to localStorage there, and the
 * matching read path returns only the last four characters of the token.
 *
 * The rule's real targets are serialization to somewhere OBSERVABLE or
 * PERSISTENT. Only the `body:`/`body =` position is exempt; every one of those
 * targets must keep firing, which is what the POSITIVE cases below pin.
 */
describe('data-integrity — PII: a request body is not a leak, a log is', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-di-pii-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function scan(rel, source) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, source);
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    const result = makeResult();
    await new DataIntegrityModule().run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && c.name.startsWith('data:pii'));
  }

  it('NEGATIVE: a token serialized as a fetch request body is the credential doing its job', async () => {
    const found = await scan('app/AccountsTab.tsx', [
      'export async function addProfile(ghLabel, ghToken, orgs) {',
      '  const res = await fetch("/api/admin/github-profiles", {',
      '    method: "POST",',
      '    headers: { "Content-Type": "application/json" },',
      '    body: JSON.stringify({ label: ghLabel, token: ghToken, orgs }),',
      '  });',
      '  return res.json();',
      '}',
    ].join('\n'));
    assert.deepStrictEqual(found.map((f) => f.name), []);
  });

  it('POSITIVE: the same payload written to a LOG still fires', async () => {
    const found = await scan('app/log.js', [
      'function save(user) {',
      '  console.log("saving", JSON.stringify({ password: user.password }));',
      '}',
      'module.exports = { save };',
    ].join('\n'));
    assert.ok(found.length > 0, 'a serialized password in a log is a real leak');
    assert.ok(found.some((f) => f.line === 2), JSON.stringify(found));
  });

  it('POSITIVE: the same payload written to localStorage still fires', async () => {
    const found = await scan('app/store.js', [
      'function persist(session) {',
      '  localStorage.setItem("session", JSON.stringify({ token: session.token }));',
      '}',
      'module.exports = { persist };',
    ].join('\n'));
    assert.ok(found.length > 0, 'a serialized token in localStorage is a real leak');
  });

  it('POSITIVE: a bare serialization not bound to a request body still fires', async () => {
    const found = await scan('app/dump.js', [
      'function dump(cfg) {',
      '  const blob = JSON.stringify({ secret: cfg.secret });',
      '  return blob;',
      '}',
      'module.exports = { dump };',
    ].join('\n'));
    assert.ok(found.length > 0, 'only the body: position is exempt, not stringify in general');
  });

  it('the exemption is positional: "somebody:" or a trailing comment must not spell "body:"', async () => {
    const found = await scan('app/tricky.js', [
      'function leak(u) {',
      '  const nobody = JSON.stringify({ token: u.token });',
      '  return nobody;',
      '}',
      'module.exports = { leak };',
    ].join('\n'));
    assert.ok(found.length > 0, '`nobody =` must not be read as `body =`');
  });
});
