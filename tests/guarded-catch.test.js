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
const assert = require('node:assert');

const {
  classifyEmptyCatch,
  maskNonCode,
  hasTopLevelExit,
  assignedTargets,
  isTestedAfter,
} = require('../src/core/guarded-catch');

/** Classify the first `catch` in `src`. */
function classify(src) {
  const raw = src.split('\n');
  const masked = maskNonCode(src).split('\n');
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
    const masked = maskNonCode(src);
    assert.strictEqual(masked.length, src.length);
    assert.ok(masked.includes('catch'), 'code after the regex must stay visible');
    assert.ok(!masked.includes('"'), 'the regex body must be blanked');
  });

  it('maskNonCode still treats a division slash as division', () => {
    const src = 'const ratio = total / count;\nconst s = "keep";\n';
    const masked = maskNonCode(src);
    assert.ok(masked.includes('total / count'));
    assert.ok(!masked.includes('keep'));
  });

  it('maskNonCode blanks string and comment contents but keeps offsets', () => {
    const src = 'const a = "} catch {"; // } catch {\nconst b = 1;';
    const masked = maskNonCode(src);
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
