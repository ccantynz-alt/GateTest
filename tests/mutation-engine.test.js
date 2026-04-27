// ============================================================================
// MUTATION-ENGINE TEST — Phase 3.3 of THE FIX-FIRST BUILD PLAN
// ============================================================================
// Covers src/core/mutation-engine.js — the mutation operators extracted
// from the mutation-testing module so they can be unit-tested without
// shelling out to a real test runner. Each operator is a regex pattern;
// these tests assert the patterns transform source the way we expect
// AND don't fire on excluded contexts (comments, imports).
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MUTATIONS,
  shouldSkipLine,
  applyMutation,
  generateMutations,
  applyCandidate,
} = require('../src/core/mutation-engine');

function findOp(name) {
  const op = MUTATIONS.find((m) => m.name === name);
  if (!op) throw new Error(`mutation operator not found: ${name}`);
  return op;
}

// ---------- MUTATIONS catalogue ----------

test('MUTATIONS — exposes the canonical operator set', () => {
  // The 19-operator catalogue — bumping this number means a deliberate
  // expansion of the engine, which should land with new tests for the
  // new operators.
  assert.equal(MUTATIONS.length, 19);
  // Every entry must have name / pattern / replace / desc
  for (const m of MUTATIONS) {
    assert.ok(typeof m.name === 'string' && m.name.length > 0, `${m.name}: name`);
    assert.ok(m.pattern instanceof RegExp, `${m.name}: pattern is RegExp`);
    assert.ok(typeof m.replace === 'string', `${m.name}: replace string`);
    assert.ok(typeof m.desc === 'string' && m.desc.length > 0, `${m.name}: desc`);
    // All patterns use the global flag (we rely on lastIndex resets)
    assert.ok(m.pattern.flags.includes('g'), `${m.name}: pattern uses /g flag`);
  }
});

test('MUTATIONS — operator names are unique', () => {
  const names = MUTATIONS.map((m) => m.name);
  const unique = new Set(names);
  assert.equal(unique.size, names.length);
});

// ---------- shouldSkipLine ----------

test('shouldSkipLine — empty / blank / falsy', () => {
  assert.equal(shouldSkipLine(''), true);
  assert.equal(shouldSkipLine('   '), true);
  assert.equal(shouldSkipLine(null), true);
  assert.equal(shouldSkipLine(undefined), true);
});

test('shouldSkipLine — single-line comments', () => {
  assert.equal(shouldSkipLine('// a comment'), true);
  assert.equal(shouldSkipLine('  // indented comment'), true);
  assert.equal(shouldSkipLine('# python comment'), true);
  assert.equal(shouldSkipLine('  # indented python comment'), true);
});

test('shouldSkipLine — block-comment inner lines', () => {
  assert.equal(shouldSkipLine(' * jsdoc inner'), true);
  assert.equal(shouldSkipLine('/* block-open'), true);
});

test('shouldSkipLine — require / import lines', () => {
  assert.equal(shouldSkipLine("const x = require('./foo');"), true);
  assert.equal(shouldSkipLine("import x from './foo';"), true);
  assert.equal(shouldSkipLine("from foo import bar"), true);
  assert.equal(shouldSkipLine("  import { y } from 'mod';"), true);
});

test('shouldSkipLine — real source code is NOT skipped', () => {
  assert.equal(shouldSkipLine("if (a < b) return true;"), false);
  assert.equal(shouldSkipLine("const total = a + b;"), false);
  assert.equal(shouldSkipLine("for (let i = 0; i < n; i++) {"), false);
  assert.equal(shouldSkipLine("return obj === target;"), false);
});

// ---------- applyMutation ----------

test('applyMutation — negate-conditional swaps === for !==', () => {
  const op = findOp('negate-conditional');
  assert.equal(applyMutation('return a === b;', op), 'return a !== b;');
});

test('applyMutation — negate-conditional-eq swaps !== for ===', () => {
  const op = findOp('negate-conditional-eq');
  assert.equal(applyMutation('if (a !== b) return;', op), 'if (a === b) return;');
});

test('applyMutation — boundary-lt swaps < for <=', () => {
  const op = findOp('boundary-lt');
  assert.equal(applyMutation('if (i < n) {', op), 'if (i <= n) {');
});

test('applyMutation — boundary-gt swaps > for >=', () => {
  const op = findOp('boundary-gt');
  assert.equal(applyMutation('if (n > 0) doThing();', op), 'if (n >= 0) doThing();');
});

test('applyMutation — math-add swaps + for - (but not in +=)', () => {
  const op = findOp('math-add');
  assert.equal(applyMutation('const sum = a + b;', op), 'const sum = a - b;');
  // Negative-lookahead protects += from being mutated
  assert.equal(applyMutation('total += amount;', op), null);
});

test('applyMutation — return-true flips literal return true', () => {
  const op = findOp('return-true');
  assert.equal(applyMutation('return true;', op), 'return false;');
  // Should not match return that happens to contain "true" elsewhere
  assert.equal(applyMutation('return trueish;', op), null);
});

test('applyMutation — return-false flips literal return false', () => {
  const op = findOp('return-false');
  assert.equal(applyMutation('return false;', op), 'return true;');
});

test('applyMutation — increment-swap converts ++ to --', () => {
  const op = findOp('increment-swap');
  assert.equal(applyMutation('i++;', op), 'i--;');
  assert.equal(applyMutation('for (let i = 0; i < n; i++)', op), 'for (let i = 0; i < n; i--)');
});

test('applyMutation — and-to-or swaps && for ||', () => {
  const op = findOp('and-to-or');
  assert.equal(applyMutation('if (a && b) return;', op), 'if (a || b) return;');
});

test('applyMutation — or-to-and swaps || for &&', () => {
  const op = findOp('or-to-and');
  assert.equal(applyMutation('return x || fallback;', op), 'return x && fallback;');
});

test('applyMutation — zero-constant zeroes return literals', () => {
  const op = findOp('zero-constant');
  assert.equal(applyMutation('return 42;', op), 'return 0;');
});

test('applyMutation — empty-string empties return strings', () => {
  const op = findOp('empty-string');
  assert.equal(applyMutation('return "hello";', op), 'return "";');
  assert.equal(applyMutation("return 'world';", op), 'return "";');
});

test('applyMutation — returns null when operator does not match', () => {
  const op = findOp('return-true');
  assert.equal(applyMutation('const x = 1;', op), null);
  assert.equal(applyMutation('// return true is mentioned in comment', op), null);
});

test('applyMutation — returns null on skipped lines', () => {
  const op = findOp('math-add');
  assert.equal(applyMutation('// const sum = a + b;', op), null);
  assert.equal(applyMutation("import x from './foo';", op), null);
});

test('applyMutation — handles malformed input gracefully', () => {
  assert.equal(applyMutation(null, findOp('return-true')), null);
  assert.equal(applyMutation('return true;', null), null);
  assert.equal(applyMutation('return true;', { pattern: /x/g, replace: '' }), null);
});

test('applyMutation — pattern.lastIndex is reset between calls (no state leak)', () => {
  const op = findOp('negate-conditional');
  // Call once — sets lastIndex
  applyMutation('return a === b;', op);
  // Call again on the SAME line — should still produce the mutation,
  // not return null because lastIndex was advanced
  assert.equal(applyMutation('return a === b;', op), 'return a !== b;');
});

// ---------- generateMutations (orchestrator) ----------

test('generateMutations — produces candidates with line numbers', () => {
  const source = [
    '// comment line',
    'function foo() {',
    '  return true;',
    '  if (a < b) return false;',
    '}',
  ].join('\n');

  const candidates = generateMutations(source);
  // At minimum: one for `return true;` and one for `<` (boundary)
  assert.ok(candidates.length >= 2);
  const lineNums = candidates.map((c) => c.lineNumber);
  // The comment line (1) and the closing brace (5) should not produce
  // candidates
  assert.ok(!lineNums.includes(1));
  assert.ok(!lineNums.includes(5));
});

test('generateMutations — includes original + mutated + mutation metadata', () => {
  const source = 'return true;';
  const candidates = generateMutations(source);
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.lineNumber, 1);
  assert.equal(c.original, 'return true;');
  assert.equal(c.mutated, 'return false;');
  assert.equal(c.mutation.name, 'return-true');
});

test('generateMutations — only first matching operator per line', () => {
  // This line has both `<` AND `===`. Two operators *could* apply but
  // generateMutations stops after the first — keeps the candidate set
  // diverse and runtime bounded.
  const source = 'if (i < 5 && a === b) return;';
  const candidates = generateMutations(source);
  assert.equal(candidates.length, 1);
});

test('generateMutations — respects maxPerFile cap', () => {
  // Many mutateable lines
  const source = Array.from({ length: 20 }, (_, i) => `if (i < ${i}) return true;`).join('\n');
  const candidates = generateMutations(source, { maxPerFile: 3 });
  assert.equal(candidates.length, 3);
});

test('generateMutations — empty / non-string input', () => {
  assert.deepEqual(generateMutations(''), []);
  assert.deepEqual(generateMutations(null), []);
  assert.deepEqual(generateMutations(undefined), []);
});

test('generateMutations — skipped lines do not produce candidates', () => {
  const source = [
    '// return true;',     // comment
    "import { x } from 'y';", // import
    "const m = require('m');", // require
  ].join('\n');
  assert.equal(generateMutations(source).length, 0);
});

// ---------- applyCandidate ----------

test('applyCandidate — replaces the named line in source', () => {
  const source = [
    'function f() {',
    '  return true;',
    '}',
  ].join('\n');
  const candidates = generateMutations(source);
  const mutated = applyCandidate(source, candidates[0]);
  const lines = mutated.split('\n');
  // Line 2 (index 1) should now be the mutated version
  assert.equal(lines[1].trim(), 'return false;');
  // Other lines unchanged
  assert.equal(lines[0], 'function f() {');
  assert.equal(lines[2], '}');
});

test('applyCandidate — out-of-range candidate returns source unchanged', () => {
  const source = 'return true;';
  const bad = { lineNumber: 99, original: 'x', mutated: 'y', mutation: { name: 'x' } };
  assert.equal(applyCandidate(source, bad), source);
});

test('applyCandidate — null candidate returns source unchanged', () => {
  assert.equal(applyCandidate('return true;', null), 'return true;');
});

// ---------- End-to-end: synthetic mutation cycle ----------

test('end-to-end — mutate, apply, verify the diff is exactly one line', () => {
  // Synthesise a typical source file with multiple mutateable lines.
  const original = [
    '// Calculator helpers',
    'function add(a, b) {',
    '  return a + b;',
    '}',
    '',
    'function gte(a, b) {',
    '  return a >= b;',
    '}',
    '',
    'module.exports = { add, gte };',
  ].join('\n');

  const candidates = generateMutations(original);
  // Should find at least one mutation (the math-add on line 3 OR the
  // boundary-gte on line 7)
  assert.ok(candidates.length >= 1);

  // Apply the first candidate
  const mutated = applyCandidate(original, candidates[0]);

  // Original and mutated should differ on exactly one line
  const oLines = original.split('\n');
  const mLines = mutated.split('\n');
  assert.equal(oLines.length, mLines.length);
  let diffCount = 0;
  for (let i = 0; i < oLines.length; i++) {
    if (oLines[i] !== mLines[i]) diffCount++;
  }
  assert.equal(diffCount, 1, 'exactly one line should differ post-mutation');
});
