const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ErrorSwallowModule = require('../src/modules/error-swallow');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new ErrorSwallowModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('ErrorSwallowModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no JS/TS files exist', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'error-swallow:no-files'));
  });

  it('scans JS/TS files', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'error-swallow:scanning'));
  });
});

describe('ErrorSwallowModule — empty catch', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-empty-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on `catch (err) {}`', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  try {',
      '    await doThing();',
      '  } catch (err) {',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on single-line `catch {}`', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  try { doThing(); } catch {}',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:')));
  });

  it('does NOT flag a catch that rethrows', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  try { doThing(); } catch (err) { throw new Error("wrapped: " + err.message); }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:')),
      undefined,
    );
  });

  it('warns (not errors) on a catch block whose body is only a comment', async () => {
    // Corpus shape (src/api/handler.js): comments document intent but don't
    // handle the error, so it's still a surfaced finding — but this codebase's
    // own documented idiom is `catch { // explain why }`, so firing at ERROR
    // blocked our own self-scan with 291 false positives. Calibrated to
    // warning: still visible, no longer blocking.
    write(tmp, 'src/handler.js', [
      'async function getOrderHandler(req, res) {',
      '  try {',
      '    const order = await findOrderById(req.params.id);',
      '    res.json(order);',
      '  } catch (err) {',
      '    // PLANTED: silently swallowed error',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('still errors (not warns) on a truly bare empty catch — no code, no comment', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  try {',
      '    await doThing();',
      '  } catch (err) {',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does NOT flag a comment-only catch nested inside a string literal', async () => {
    write(tmp, 'src/a.js', [
      'const exampleSnippet = "try { x(); } catch (err) { /* nothing */ }";',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:')),
      undefined,
    );
  });

  it('downgrades empty catch in test files to warning', async () => {
    write(tmp, 'a.test.js', [
      'it("throws", () => {',
      '  try { doThing(); } catch {}',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });
});

describe('ErrorSwallowModule — harness scope (control pair)', () => {
  // Measured on colinhacks/zod @7a002366: 23 of the module's 33 blocking
  // findings were benchmark harnesses deliberately measuring the throw path
  // (`packages/zod/src/v3/benchmarks/`, `packages/bench/memory/`). The module
  // already treated a test file as harness code; a benchmark is the same KIND
  // of code. SCOPE, not silence — it still reports, it stops blocking.
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-scope-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const SWALLOW = [
    'function run(i) {',
    '  try {',
    '    bigSchema.parse({ n: "not-a-number" });',
    '  } catch {}',
    '}',
    '',
  ].join('\n');

  it('downgrades — but still reports — an empty catch in a benchmark harness', async () => {
    write(tmp, 'packages/zod/src/v3/benchmarks/primitives.ts', SWALLOW);
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit, 'benchmark findings must stay visible, not vanish');
    assert.strictEqual(hit.severity, 'warning');
  });

  it('still ERRORS on the identical code in shipped source', async () => {
    write(tmp, 'packages/zod/src/v3/parse.ts', SWALLOW);
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error', 'the downgrade must be about the path, not the code');
  });

  it('does not treat `src/latest/` or `src/benchmarking.ts` as a harness', async () => {
    // Segment-anchored: the recurring bug in this engine is a substring test
    // where a segment test was meant.
    write(tmp, 'src/latest/a.ts', SWALLOW);
    write(tmp, 'src/benchmarking.ts', SWALLOW);
    const r = await run(tmp);
    const hits = r.checks.filter((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.strictEqual(hits.length, 2);
    for (const h of hits) assert.strictEqual(h.severity, 'error', `${h.file} should not read as a harness`);
  });

  it('skips the floating-promise heuristic in a benchmark, keeps it in source', async () => {
    const FLOATING = [
      'function main() {',
      '  queue.publish({ id: 1 });',
      '}',
      '',
    ].join('\n');
    write(tmp, 'bench/run.js', FLOATING);
    write(tmp, 'src/run.js', FLOATING);
    const r = await run(tmp);
    const hits = r.checks.filter((c) => c.name.startsWith('error-swallow:floating-promise:'));
    assert.strictEqual(hits.length, 1, `expected only the src/ finding, got ${JSON.stringify(hits.map((h) => h.file))}`);
    assert.strictEqual(hits[0].file.replace(/\\/g, '/'), 'src/run.js');
  });
});

describe('ErrorSwallowModule — guarded attempt (control pair)', () => {
  // In a PARSING library, `try { ... } catch {}` is frequently "that shape did
  // not parse, fall through and try the next one". The discriminator is not
  // the library, it is whether the code around the catch can OBSERVE the
  // failure. See src/core/guarded-catch.js for the measurement.
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-guard-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns (not errors) on coerce-then-check, and says why', async () => {
    write(tmp, 'src/schemas.ts', [
      'export const parseNumber = (payload) => {',
      '  if (def.coerce)',
      '    try {',
      '      payload.value = Number(payload.value);',
      '    } catch (_) {}',
      '  const input = payload.value;',
      '  if (typeof input === "number") return payload;',
      '  payload.issues.push({ expected: "number" });',
      '  return payload;',
      '};',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit, 'a guarded attempt is downgraded, never dropped');
    assert.strictEqual(hit.severity, 'warning');
    assert.strictEqual(hit.guarded, 'checked-target');
    assert.match(hit.message, /handled by the surrounding control flow/);
  });

  it('warns on the sync-attempt / async-fallback fallthrough', async () => {
    write(tmp, 'src/standard.ts', [
      'export const validate = (value) => {',
      '  try {',
      '    const r = inst._zod.run({ value, issues: [] }, ctx);',
      '    if (!(r instanceof Promise)) return toStandardResult(r, ctx);',
      '  } catch (_) {}',
      '  return validateAsync(inst, value);',
      '};',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
    assert.strictEqual(hit.guarded, 'fallthrough');
  });

  it('STILL ERRORS on a swallow the following code cannot observe', async () => {
    write(tmp, 'src/checkout.ts', [
      'export async function checkout(order, res) {',
      '  try {',
      '    await sendReceipt(order.email);',
      '  } catch {}',
      '  await db.markPaid(order.id);',
      '  return res.json({ ok: true });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.strictEqual(hit.guarded, undefined);
  });

  it('STILL ERRORS when the value is read afterwards but never tested', async () => {
    write(tmp, 'src/load.ts', [
      'export async function load(id) {',
      '  let user = null;',
      '  try {',
      '    user = await db.users.find(id);',
      '  } catch {}',
      '  return user;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });
});

describe('ErrorSwallowModule — prose is not code (control pair)', () => {
  // Found by self-scan 2026-09-04: `src/core/guarded-catch.js` documents the
  // shape it detects, and this module reported the two examples in its doc
  // comment at ERROR — blocking our own repo on its own documentation.
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-prose-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag an example inside a /** block comment */', async () => {
    write(tmp, 'src/doc.js', [
      '/**',
      ' * The swallow this rule is about:',
      ' *',
      ' *     try { await db.commit(); } catch {}',
      ' *',
      ' * Do not write that.',
      ' */',
      'module.exports = {};',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hits = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(hits.length, 0, `documentation is not a defect, got: ${JSON.stringify(hits, null, 2)}`);
  });

  it('does NOT flag `.catch(() => {})` quoted in a doc comment', async () => {
    write(tmp, 'src/doc.js', [
      '/** Never write `.catch(() => {})` on a payment call. */',
      'module.exports = {};',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.filter((c) => c.passed === false).length, 0);
  });

  it('STILL flags a swallow that sits below a regex literal containing a quote', async () => {
    // The false-NEGATIVE direction of the same machinery: `/["']/` carries an
    // unbalanced quote, and a masker that mishandles it blanks the rest of the
    // file — after which every finding below reads as prose and disappears.
    write(tmp, 'src/tokenize.js', [
      'const QUOTE_RE = /["\']/;',
      'async function run() {',
      '  try {',
      '    await db.commit();',
      '  } catch {}',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.ok(hit, 'a regex literal must not silence the rest of the file');
    assert.strictEqual(hit.severity, 'error');
  });

  it('STILL flags the same code when it is code, on the line below the comment', async () => {
    write(tmp, 'src/doc.js', [
      '/**',
      ' *     try { await db.commit(); } catch {}',
      ' */',
      'async function run() {',
      '  try {',
      '    await db.commit();',
      '  } catch {}',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hits = r.checks.filter((c) => c.name.startsWith('error-swallow:empty-catch:'));
    assert.strictEqual(hits.length, 1, `expected exactly the executable one, got: ${JSON.stringify(hits.map((h) => h.line))}`);
    assert.strictEqual(hits[0].line, 7);
    assert.strictEqual(hits[0].severity, 'error');
  });
});

describe('ErrorSwallowModule — log-and-eat', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-log-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on catch that only console.errors', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  try {',
      '    await doThing();',
      '  } catch (err) {',
      '    console.error("doThing failed", err);',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:log-and-eat:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('does NOT flag catch that logs AND rethrows', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  try {',
      '    await doThing();',
      '  } catch (err) {',
      '    console.error("doThing failed", err);',
      '    throw err;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:log-and-eat:')),
      undefined,
    );
  });

  it('does NOT flag catch that calls next(err) Express-style', async () => {
    write(tmp, 'src/a.js', [
      'app.use(async (req, res, next) => {',
      '  try {',
      '    await doThing();',
      '  } catch (err) {',
      '    logger.error({ err }, "doThing failed");',
      '    next(err);',
      '  }',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:log-and-eat:')),
      undefined,
    );
  });
});

describe('ErrorSwallowModule — .catch(noop)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-catch-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on .catch(() => {})', async () => {
    write(tmp, 'src/a.js', 'promise.catch(() => {});\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:catch-noop:')));
  });

  it('errors on .catch(() => null)', async () => {
    write(tmp, 'src/a.js', 'const result = await promise.catch(() => null);\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:catch-noop:')));
  });

  it('errors on .catch((e) => {})', async () => {
    write(tmp, 'src/a.js', 'promise.catch((e) => {});\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:catch-noop:')));
  });

  it('errors on .catch(noop) where `noop` is a known empty helper name', async () => {
    write(tmp, 'src/a.js', 'promise.catch(noop);\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:catch-noop:')));
  });

  it('does NOT flag .catch((err) => log.error(err))', async () => {
    write(tmp, 'src/a.js', 'promise.catch((err) => log.error({ err }));\n');
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:catch-noop:')),
      undefined,
    );
  });
});

describe('ErrorSwallowModule — global silent handler', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-glob-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on uncaughtException handler that neither logs nor exits', async () => {
    write(tmp, 'src/a.js', [
      "process.on('uncaughtException', (err) => {",
      '  // oh well',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:global-silent-handler:')));
  });

  it('does NOT flag an uncaughtException handler that calls process.exit(1)', async () => {
    write(tmp, 'src/a.js', [
      "process.on('uncaughtException', (err) => {",
      '  logger.fatal({ err });',
      '  process.exit(1);',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:global-silent-handler:')),
      undefined,
    );
  });
});

describe('ErrorSwallowModule — callback err ignored', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-cb-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns when err is never referenced in callback body', async () => {
    write(tmp, 'src/a.js', [
      'fs.readFile(p, (err, data) => {',
      '  console.log(data.toString());',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('error-swallow:callback-err-ignored:')));
  });

  it('does NOT warn when err is branched on', async () => {
    write(tmp, 'src/a.js', [
      'fs.readFile(p, (err, data) => {',
      '  if (err) throw err;',
      '  console.log(data.toString());',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:callback-err-ignored:')),
      undefined,
    );
  });
});

describe('ErrorSwallowModule — floating promise', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-float-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on fire-and-forget db.save()', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  db.save({ x: 1 });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:'));
    assert.ok(hit);
    assert.strictEqual(hit.method, 'save');
  });

  it('does NOT flag when awaited', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  await db.save({ x: 1 });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
    );
  });

  it('does NOT flag Map/Set/cookie .delete(bareKey) — returns boolean/void, not a promise', async () => {
    // Regression (2026-07-11): collection deletes take a bare key and return
    // boolean; only ORM deletes (object-literal arg) are floating-promise smells.
    write(tmp, 'src/a.js', [
      'function run(scanId, firstIdent, cookieStore) {',
      '  costLedger.delete(scanId);',
      '  taintedVars.delete(firstIdent[1]);',
      '  cookieStore.delete("gh_oauth_state");',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
      'collection .delete(bareKey) must not be flagged',
    );
  });

  it('STILL flags an ORM .delete({ where }) — object-literal arg is a real smell', async () => {
    write(tmp, 'src/a.js', [
      'function run(id) {',
      '  prisma.user.delete({ where: { id } });',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      'ORM delete with an object arg should still be flagged',
    );
  });

  it('does NOT flag .write() on any receiver — it returns a boolean, not a promise', async () => {
    // Regression (2026-07-11): stream/request .write() returns the backpressure
    // boolean per Node's contract, never an awaitable promise. Flagging it was a
    // 42-finding false-positive flood on our own repo (out.write, req.write, …).
    write(tmp, 'src/a.js', [
      'function run(out, req, sink) {',
      '  out.write("hello\\n");',
      '  req.write(JSON.stringify(body));',
      '  sink.write(chunk);',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
      'stream .write() must not be flagged as a floating promise',
    );
  });

  it('does NOT flag when chained with .then/.catch', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  db.save({ x: 1 }).then((r) => log.info(r)).catch((e) => log.error(e));',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
    );
  });

  it('does NOT flag when assigned / returned', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  const p = db.save({ x: 1 });',
      '  return p;',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
    );
  });

  it('does NOT flag in test files (tests often fire-and-forget setup)', async () => {
    write(tmp, 'a.test.js', [
      'it("saves", () => {',
      '  db.save({ x: 1 });',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(
      r.checks.find((c) => c.name.startsWith('error-swallow:floating-promise:')),
      undefined,
    );
  });
});

describe('ErrorSwallowModule — clean baseline', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-es-clean-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('emits zero findings for well-written async code', async () => {
    write(tmp, 'src/a.js', [
      'async function run() {',
      '  try {',
      '    await db.save({ x: 1 });',
      '  } catch (err) {',
      '    logger.error({ err }, "db.save failed");',
      '    throw err;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false);
    assert.strictEqual(issues.length, 0, `unexpected findings: ${JSON.stringify(issues, null, 2)}`);
  });

  // The "void promise" idiom — explicit, ESLint-recommended way to mark
  // intentional fire-and-forget. Must NOT trip catch-noop.
  it('does NOT flag `void promise.catch(() => {})` — idiomatic fire-and-forget', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  void analytics.track("event").catch(() => {});',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.strictEqual(issues.length, 0, `expected no catch-noop on void prefix, got: ${JSON.stringify(issues, null, 2)}`);
  });

  it('does NOT flag multi-line `void promise\\n  .catch(() => {})` chains', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  void analytics',
      '    .track("event")',
      '    .catch(() => {});',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.strictEqual(issues.length, 0, `expected no catch-noop on multi-line void chain, got: ${JSON.stringify(issues, null, 2)}`);
  });

  it('does NOT flag `void promise.catch(noop)` with named noop', async () => {
    write(tmp, 'src/a.js', [
      'const noop = () => {};',
      'function run() {',
      '  void analytics.track("event").catch(noop);',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.strictEqual(issues.length, 0, `expected no catch-noop with void + named noop, got: ${JSON.stringify(issues, null, 2)}`);
  });

  it('still flags `promise.catch(() => {})` WITHOUT a void prefix', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  db.save({ x: 1 }).catch(() => {});',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.ok(issues.length >= 1, `expected catch-noop to still fire without void prefix`);
  });

  it('accepts `// gatetest-fire-and-forget` marker as suppression', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  // gatetest-fire-and-forget',
      '  db.save({ x: 1 }).catch(() => {});',
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.strictEqual(issues.length, 0, `marker comment should suppress catch-noop, got: ${JSON.stringify(issues, null, 2)}`);
  });

  it('does not let a `void` on an unrelated earlier line accidentally suppress', async () => {
    write(tmp, 'src/a.js', [
      'function run() {',
      '  void noop();',         // a void statement
      '  return doSomething();', // statement boundary in between
      '  db.save({ x: 1 }).catch(() => {});', // this is real fire-and-forget, no void
      '}',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const issues = r.checks.filter((c) => c.passed === false && c.name.includes('catch-noop'));
    assert.ok(issues.length >= 1, `void on a prior statement must not suppress an unrelated catch-noop`);
  });

  it('records a summary', async () => {
    write(tmp, 'src/a.js', 'export const x = 1;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'error-swallow:summary');
    assert.ok(s);
    assert.match(s.message, /1 file\(s\)/);
  });
});
