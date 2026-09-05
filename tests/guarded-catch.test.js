/**
 * Control pairs for `src/core/guarded-catch.js`.
 *
 * The rule this file guards is one exclusion away from being useless. If
 * "empty catch" stops blocking whenever anything at all follows it, the module
 * still passes every test that only checks the idiom stays quiet — which is
 * why every shape below comes in a PAIR: the parsing idiom must be recognised
 * AND the genuine swallow it resembles must still be reported.
 *
 * Shapes are taken from real code. The negative controls are zod
 * @7a002366 (`packages/zod/src/v4/core/{schemas,compile}.ts`); the positive
 * controls are the swallows those shapes are one edit away from.
 */

const { describe, it } = require('node:test');
const { stripStringsAndComments } = require('../src/core/source-strip');
const assert = require('node:assert');

const {
  classifyEmptyCatch,
  hasTopLevelExit,
  assignedTargets,
  isTestedAfter,
  enclosingContext,
  isTeardownName,
} = require('../src/core/guarded-catch');

/** Classify the first `catch` in `src`. */
function classify(src) {
  const raw = src.split('\n');
  const masked = stripStringsAndComments(src).split('\n');
  for (let i = 0; i < raw.length; i += 1) {
    const m = raw[i].match(/\bcatch\s*(?:\([^)]*\))?\s*\{/);
    if (m) return classifyEmptyCatch(masked, i, m.index);
  }
  throw new Error('no catch in fixture');
}

describe('guarded-catch — the parsing idiom is recognised (negative controls)', () => {
  it('coerce-then-check: try assigns a property the next statement typeof-tests', () => {
    // zod packages/zod/src/v4/core/schemas.ts:1285 ($ZodNumber).
    const r = classify([
      'inst._zod.parse = (payload, _ctx) => {',
      '  if (def.coerce)',
      '    try {',
      '      payload.value = Number(payload.value);',
      '    } catch (_) {}',
      '  const input = payload.value;',
      '  if (typeof input === "number" && !Number.isNaN(input)) return payload;',
      '  payload.issues.push({ expected: "number", code: "invalid_type" });',
      '  return payload;',
      '};',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'checked-target');
    assert.strictEqual(r.target, 'payload.value');
  });

  it('reads the check one block out, past the `if (def.coerce) { ... }` wrapper', () => {
    // zod schemas.ts:1752 ($ZodDate) — the catch is the last statement inside
    // an `if` body, so the statement that inspects the result is outside it.
    const r = classify([
      'inst._zod.parse = (payload, _ctx) => {',
      '  if (def.coerce) {',
      '    try {',
      '      payload.value = new Date(payload.value);',
      '    } catch (_err) {}',
      '  }',
      '  const input = payload.value;',
      '  const isDate = input instanceof Date;',
      '  if (isDate) return payload;',
      '  payload.issues.push({ expected: "date" });',
      '  return payload;',
      '};',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'checked-target');
  });

  it('pessimistic default: try assigns a local the next `if` branches on', () => {
    // zod packages/zod/src/v4/core/compile.ts:223 — "treat can't tell as
    // recursive", and the branch below throws.
    const r = classify([
      'function compileFn(schema) {',
      '  let recursive = true;',
      '  try {',
      '    recursive = isRecursiveSchema(schema);',
      '  } catch {}',
      '  if (recursive) {',
      '    throw new ZodCompileUnsupportedError("reference cycle");',
      '  }',
      '  return build(schema);',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'checked-target');
    assert.strictEqual(r.target, 'recursive');
  });

  it('fallthrough: try returns on success and an alternative follows the catch', () => {
    // zod schemas.ts:354 (standardProps) — sync attempt, async fallback.
    const r = classify([
      'validate: (value) => {',
      '  try {',
      '    const r = inst._zod.run({ value, issues: [] }, ctx);',
      '    if (!(r instanceof Promise)) return toStandardResult(r, ctx);',
      '  } catch (_) {}',
      '  return validateAsync(inst, value);',
      '},',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'fallthrough');
  });
});

describe('guarded-catch — the genuine swallow still reports (positive controls)', () => {
  it('an effectful call with nothing observing it', () => {
    const r = classify([
      'async function checkout(order) {',
      '  try {',
      '    await db.commit();',
      '  } catch {}',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('an effectful call is not rescued by unrelated code following it', () => {
    const r = classify([
      'async function checkout(order, res) {',
      '  try {',
      '    await sendReceipt(order.email);',
      '  } catch {}',
      '  await db.markPaid(order.id);',
      '  return res.json({ ok: true });',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('a target that is READ afterwards but never TESTED', () => {
    // The caller cannot tell "no such user" from "the database is down".
    const r = classify([
      'async function load(id) {',
      '  let user = null;',
      '  try {',
      '    user = await db.users.find(id);',
      '  } catch {}',
      '  return user;',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('a same-named PROPERTY on another object does not count as the test', () => {
    // Regression control: measured on zod scripts/compile-fuzz.ts:370, target
    // `code` matched `(...).code ?? ""` three statements away because `\b` is
    // not a boundary between `.` and an identifier.
    const r = classify([
      'function report(schema) {',
      '  let code = "";',
      '  try {',
      '    code = compileFastpass(schema, { debug: true }).code;',
      '  } catch {}',
      '  const other = describe(schema);',
      '  return `${other.code ?? ""}: ${code}`;',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('a try body doing work as well as assigning is not an attempted value', () => {
    const r = classify([
      'function sync(row) {',
      '  let saved = null;',
      '  try {',
      '    audit.record(row);',
      '    saved = db.save(row);',
      '  } catch {}',
      '  if (saved) return saved;',
      '  return null;',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('a `return` inside a nested callback is not the try block exiting', () => {
    const r = classify([
      'function run(items) {',
      '  try {',
      '    items.forEach((i) => { return handle(i); });',
      '  } catch {}',
      '  finish();',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('does not read past the end of the enclosing FUNCTION for its check', () => {
    // `flushed` is tested in a *different* function. Leaving a function body
    // means the next line belongs to the caller, which we cannot see.
    const r = classify([
      'function flush(queue) {',
      '  let flushed = false;',
      '  try {',
      '    flushed = queue.flush();',
      '  } catch {}',
      '}',
      '',
      'function report(flushed) {',
      '  if (flushed) log("ok");',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('the `else` branch is not the code that runs after the attempt', () => {
    const r = classify([
      'function pick(input) {',
      '  let parsed = null;',
      '  if (input) {',
      '    try {',
      '      parsed = JSON.parse(input);',
      '    } catch {}',
      '  } else {',
      '    if (parsed) return parsed;',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });
});

describe('guarded-catch — the individual judgements', () => {
  it('maskNonCode keeps reading code after a regex literal that contains a quote', () => {
    // Fails toward SILENCE if wrong: `/["']/` carries an unbalanced quote, and
    // a masker without regex handling blanks the whole rest of the file — so
    // every catch below it reads as prose and is dropped.
    const src = 'const re = /["\']/;\nfunction f() { try { g(); } catch {} }\n';
    const masked = stripStringsAndComments(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(masked.includes('catch'), 'code after the regex must stay visible');
    assert.ok(!masked.includes('"'), 'the regex body must be blanked');
  });

  it('maskNonCode still treats a division slash as division', () => {
    const src = 'const ratio = total / count;\nconst s = "keep";\n';
    const masked = stripStringsAndComments(src);
    assert.ok(masked.includes('total / count'));
    assert.ok(!masked.includes('keep'));
  });

  it('maskNonCode blanks string and comment contents but keeps offsets', () => {
    const src = 'const a = "} catch {"; // } catch {\nconst b = 1;';
    const masked = stripStringsAndComments(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(!masked.includes('catch'));
    assert.ok(masked.includes('const b = 1;'));
  });

  it('hasTopLevelExit ignores exits nested inside a closure', () => {
    assert.strictEqual(hasTopLevelExit(' return x; '), true);
    assert.strictEqual(hasTopLevelExit(' xs.map((x) => { return x; }); '), false);
  });

  it('assignedTargets returns null when the body is not purely assignment', () => {
    assert.deepStrictEqual(assignedTargets(' a.b = f(); '), ['a.b']);
    assert.strictEqual(assignedTargets(' f(); '), null);
    assert.strictEqual(assignedTargets(' const a = f(); '), null);
  });

  it('isTestedAfter wants a test, not a mention', () => {
    assert.strictEqual(isTestedAfter('x', 'if (x) return 1;'), true);
    assert.strictEqual(isTestedAfter('x', 'return x;'), false);
    assert.strictEqual(isTestedAfter('x', 'return other.x ?? 1;'), false);
  });
});

/*
 * Shapes measured 2026-09-05 on prisma/prisma, trpc/trpc and nestjs/nest
 * (scratchpad corpus, `--suite full --all`): 30 blocking `errorSwallow`
 * findings, of which 25 were one of three shapes the classifier could not
 * see. Each negative control below is the repo's idiom (file:line in the
 * comment); each positive control is the swallow that idiom is one edit
 * away from, and it must keep blocking.
 */
describe('guarded-catch — cleanup and rethrow shapes (negative controls)', () => {
  it('an empty catch inside a `finally` is cleanup, not a swallow', () => {
    // prisma scripts/lint-casts.mjs:107 (and lint-throws.mjs:117) — the
    // worktree removal is best-effort; the rmSync after it is the fallback,
    // and a throw here would replace the primary result of the try.
    const r = classify([
      'function main() {',
      '  const tmpDir = mkdtempSync(join(tmpdir(), "lint-casts-"));',
      '  let baseResult;',
      '  try {',
      '    git("worktree", "add", "--detach", tmpDir, mergeBase);',
      '    baseResult = countCastsInDir(tmpDir);',
      '  } finally {',
      '    try {',
      '      git("worktree", "remove", "--force", tmpDir);',
      '    } catch {}',
      '    rmSync(tmpDir, { recursive: true, force: true });',
      '  }',
      '  return baseResult;',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'cleanup');
    assert.strictEqual(r.context, 'finally');
  });

  it('an empty catch inside a function named as teardown is cleanup', () => {
    // The `try { await client.quit() } catch {}` question: inside `close()`
    // the resource is being discarded by contract, so a failure to discard
    // it has no consumer. Still reported — as a warning.
    const r = classify([
      'class RedisCache {',
      '  async close() {',
      '    try {',
      '      await this.client.quit();',
      '    } catch {}',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'cleanup');
    assert.strictEqual(r.context, 'close');
  });

  it('reaches the teardown function through a callback and an `if`', () => {
    // prisma sqlite.ts:348 — `close()` wraps its body in an async IIFE.
    const r = classify([
      'const db = {',
      '  close(): Promise<void> {',
      '    if (closePromise) return closePromise;',
      '    closePromise = (async () => {',
      '      if (connectPromise) {',
      '        try {',
      '          await connectPromise;',
      '        } catch {}',
      '      }',
      '      await ownedDispose?.();',
      '    })();',
      '    return closePromise;',
      '  },',
      '};',
    ].join('\n'));
    assert.strictEqual(r.guarded, true);
    assert.strictEqual(r.shape, 'cleanup');
    assert.strictEqual(r.context, 'close');
  });

  it('an empty catch followed by a `throw` is subsumed by the primary cause', () => {
    // prisma postgres-serverless.ts:177 has this shape with `.catch(() =>
    // undefined)`; the empty-catch form is one edit away.
    const r = classify([
      'async function create(options) {',
      '  try {',
      '    return await build(options);',
      '  } catch (err) {',
      '    try {',
      '      await driver.close();',
      '    } catch {}',
      '    throw err;',
      '  }',
      '}',
    ].join('\n'));
    // The first catch in the fixture is the outer one; classify the inner.
    const raw = [
      'async function create(options) {',
      '  try {',
      '    return await build(options);',
      '  } catch (err) {',
      '    try {',
      '      await driver.close();',
      '    } catch {}',
      '    throw err;',
      '  }',
      '}',
    ];
    const masked = stripStringsAndComments(raw.join('\n')).split('\n');
    const inner = classifyEmptyCatch(masked, 6, raw[6].indexOf('catch'));
    assert.strictEqual(inner.guarded, true);
    assert.strictEqual(inner.shape, 'rethrow');
    assert.ok(r); // the outer catch is not empty; its classification is not under test
  });
});

describe('guarded-catch — cleanup and rethrow shapes (positive controls)', () => {
  it('the same `quit()` catch inside `save()` still blocks', () => {
    const r = classify([
      'class RedisCache {',
      '  async save(key, value) {',
      '    try {',
      '      await this.client.set(key, value);',
      '    } catch {}',
      '  }',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('`closeAccount()` is a business operation, not teardown', () => {
    const r = classify([
      'async function closeAccount(id) {',
      '  try {',
      '    await db.accounts.update(id, { status: "closed" });',
      '  } catch {}',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('an `onClose` handler is not teardown either', () => {
    const r = classify([
      'const onClose = async () => {',
      '  try {',
      '    await flushPendingWrites();',
      '  } catch {}',
      '};',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('cleanup in the try block does not rescue a catch outside a finally', () => {
    const r = classify([
      'async function run(tmpDir) {',
      '  try {',
      '    git("worktree", "remove", "--force", tmpDir);',
      '  } catch {}',
      '  rmSync(tmpDir, { recursive: true, force: true });',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });

  it('a `throw` that is not the next statement does not count as rethrow', () => {
    const r = classify([
      'async function checkout(order) {',
      '  try {',
      '    await db.commit();',
      '  } catch {}',
      '  await sendReceipt(order.email);',
      '  if (!order.paid) throw new Error("unpaid");',
      '}',
    ].join('\n'));
    assert.strictEqual(r.guarded, false);
  });
});

describe('guarded-catch — enclosingContext and isTeardownName', () => {
  const ctx = (src) => {
    const lines = src.split('\n');
    const masked = stripStringsAndComments(src).split('\n');
    const at = lines.findIndex((l) => l.includes('HERE'));
    return enclosingContext(masked, at, lines[at].indexOf('HERE'));
  };

  it('names teardown by verb, verb + resource noun, or a teardown tail word', () => {
    for (const name of ['close', 'end', 'destroy', 'dispose', 'quit', 'destroyDatabasePool', 'closeDb', 'ownedDispose', 'ngOnDestroy', 'cleanupWorkspaces', 'destroyConnection']) {
      assert.strictEqual(isTeardownName(name), true, name);
    }
    for (const name of ['save', 'commit', 'open', 'connect', 'closeAccount', 'closeOrder', 'endTransaction', 'onClose', 'handleClose', 'constructor', '']) {
      assert.strictEqual(isTeardownName(name), false, name);
    }
  });

  it('stops at the first named function, walking through control flow and callbacks', () => {
    const r = ctx([
      'class C {',
      '  public async close() {',
      '    for await (const row of rows) {',
      '      if (row.ok) {',
      '        items.forEach((x) => {',
      '          HERE',
      '        });',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n'));
    assert.deepStrictEqual(r, { finally: false, fn: 'close', teardown: true });
  });

  it('is not fooled by an `if (` earlier in the method into reading the method as a loop body', () => {
    // trpc wsClient.ts:144 — `public async close()` follows a method with
    // `if (...)` conditions; the greedy `\([\s\S]*\)` read those parens
    // through to `close()` and called the method body an `if` body.
    const r = ctx([
      'class C {',
      '  private tick() {',
      '    if (this.reconnecting && this.state === "open") { return; }',
      '  }',
      '  public async close() {',
      '    HERE',
      '  }',
      '}',
    ].join('\n'));
    assert.deepStrictEqual(r, { finally: false, fn: 'close', teardown: true });
  });

  it('recognises arrow assignment, object property and function expression heads', () => {
    assert.strictEqual(ctx('const destroyConnection = async (reason: unknown): Promise<void> => {\n  HERE\n};').fn, 'destroyConnection');
    assert.strictEqual(ctx('const api = {\n  close: async () => {\n    HERE\n  },\n};').fn, 'close');
    assert.strictEqual(ctx('exports.shutdown = function (signal) {\n  HERE\n};').fn, 'shutdown');
    assert.strictEqual(ctx('function main() {\n  try {\n    x();\n  } finally {\n    HERE\n  }\n}').finally, true);
  });

  it('returns nothing at top level or when the enclosing function is anonymous all the way up', () => {
    assert.deepStrictEqual(ctx('HERE'), { finally: false, fn: null, teardown: false });
    assert.deepStrictEqual(ctx('setTimeout(() => {\n  HERE\n}, 10);'), { finally: false, fn: null, teardown: false });
  });
});
