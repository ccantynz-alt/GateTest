// ============================================================================
// CROSS-FIX SYNTAX GATE TEST — Phase 1.2 of THE FIX-FIRST BUILD PLAN
// ============================================================================
// Covers website/app/lib/cross-fix-syntax-gate.js — the gate that sits
// between the per-file iterative fix loop and PR creation. Catches the
// failure mode where Claude returns plausible-looking but syntactically
// invalid content. Without this gate, a broken-brackets fix could ship
// to a customer's PR and break their build.
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFixesSyntax,
  summariseSyntaxGate,
  checkJsSyntax,
  checkJsonSyntax,
  pickChecker,
} = require('../website/app/lib/cross-fix-syntax-gate.js');

// ---------- Single-file checkers ----------

test('checkJsSyntax — accepts valid JavaScript', () => {
  assert.equal(checkJsSyntax('const x = 1; function f() { return x + 2; }').ok, true);
  assert.equal(checkJsSyntax('class Foo { constructor() { this.x = 1; } }').ok, true);
  assert.equal(checkJsSyntax('async function f() { return await Promise.resolve(1); }').ok, true);
});

test('checkJsSyntax — rejects unbalanced braces', () => {
  const result = checkJsSyntax('function f() { return 1;');
  assert.equal(result.ok, false);
  assert.match(result.reason, /syntax error/);
});

test('checkJsSyntax — rejects stray tokens', () => {
  const result = checkJsSyntax('const x = ;;;');
  assert.equal(result.ok, false);
  assert.match(result.reason, /syntax error/);
});

test('checkJsSyntax — rejects empty source', () => {
  assert.equal(checkJsSyntax('').ok, false);
  assert.equal(checkJsSyntax('').reason, 'empty source');
  assert.equal(checkJsSyntax(null).ok, false);
});

test('checkJsSyntax — handles ESM imports/exports without false-rejecting', () => {
  // import / export aren't valid in a function body, so we strip them
  // before validating. The body still has to parse.
  const esm = `import foo from './foo.js';\nimport { bar } from './bar.js';\nexport function f() { return foo + bar; }\nexport default f;`;
  assert.equal(checkJsSyntax(esm).ok, true);
});

test('checkJsSyntax — catches broken syntax even with imports present', () => {
  const broken = `import foo from './foo.js';\nfunction f() { return foo +`;
  assert.equal(checkJsSyntax(broken).ok, false);
});

test('checkJsonSyntax — accepts valid JSON', () => {
  assert.equal(checkJsonSyntax('{"a":1,"b":[2,3]}').ok, true);
  assert.equal(checkJsonSyntax('[1,2,3]').ok, true);
  assert.equal(checkJsonSyntax('"string"').ok, true);
  assert.equal(checkJsonSyntax('null').ok, true);
});

test('checkJsonSyntax — rejects trailing commas', () => {
  const result = checkJsonSyntax('{"a":1,}');
  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid JSON/);
});

test('checkJsonSyntax — rejects single quotes', () => {
  const result = checkJsonSyntax("{'a':1}");
  assert.equal(result.ok, false);
});

test('checkJsonSyntax — rejects empty source', () => {
  assert.equal(checkJsonSyntax('').ok, false);
  assert.equal(checkJsonSyntax(null).ok, false);
});

// ---------- Extension dispatch ----------

test('pickChecker — JSON extension routes to JSON checker', () => {
  assert.equal(pickChecker('package.json'), checkJsonSyntax);
  assert.equal(pickChecker('config/foo.json'), checkJsonSyntax);
  assert.equal(pickChecker('PACKAGE.JSON'), checkJsonSyntax);
});

test('pickChecker — JS family routes to JS checker', () => {
  assert.equal(pickChecker('foo.js'), checkJsSyntax);
  assert.equal(pickChecker('bar.mjs'), checkJsSyntax);
  assert.equal(pickChecker('baz.cjs'), checkJsSyntax);
});

test('pickChecker — TS family returns null (unchecked)', () => {
  assert.equal(pickChecker('foo.ts'), null);
  assert.equal(pickChecker('foo.tsx'), null);
  assert.equal(pickChecker('foo.mts'), null);
  assert.equal(pickChecker('foo.cts'), null);
  assert.equal(pickChecker('foo.jsx'), null);
});

test('pickChecker — unknown extensions return null', () => {
  assert.equal(pickChecker('README.md'), null);
  assert.equal(pickChecker('Dockerfile'), null);
  assert.equal(pickChecker('foo.yaml'), null);
});

// ---------- Gate orchestrator ----------

test('validateFixesSyntax — accepts valid fixes, rejects invalid ones', () => {
  const fixes = [
    { file: 'app/server.js',     fixed: 'const x = 1;',          original: '', issues: ['i'] },
    { file: 'config/data.json',  fixed: '{"ok": true}',          original: '', issues: ['i'] },
    { file: 'app/broken.js',     fixed: 'function f() {',        original: '', issues: ['i'] },
    { file: 'config/bad.json',   fixed: '{"a":1,}',              original: '', issues: ['i'] },
    { file: 'app/component.tsx', fixed: 'definitely <not> JSX;', original: '', issues: ['i'] },
  ];
  const result = validateFixesSyntax({ fixes });

  assert.equal(result.accepted.length, 3, 'js + json + tsx (passes through unchecked)');
  assert.equal(result.rejected.length, 2, 'broken.js + bad.json');

  const acceptedFiles = result.accepted.map((a) => a.file).sort();
  assert.deepEqual(acceptedFiles, ['app/component.tsx', 'app/server.js', 'config/data.json']);

  const rejectedFiles = result.rejected.map((r) => r.file).sort();
  assert.deepEqual(rejectedFiles, ['app/broken.js', 'config/bad.json']);

  const brokenJs = result.rejected.find((r) => r.file === 'app/broken.js');
  assert.equal(brokenJs.language, 'js');
  assert.match(brokenJs.reason, /syntax error/);

  const badJson = result.rejected.find((r) => r.file === 'config/bad.json');
  assert.equal(badJson.language, 'json');
  assert.match(badJson.reason, /invalid JSON/);

  const tsx = result.accepted.find((a) => a.file === 'app/component.tsx');
  assert.equal(tsx.language, 'unchecked');
});

test('validateFixesSyntax — empty fixes array returns empty result', () => {
  const result = validateFixesSyntax({ fixes: [] });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 0);
});

test('validateFixesSyntax — malformed fix entries are rejected, not crashed', () => {
  const result = validateFixesSyntax({
    fixes: [
      null,
      { file: 'good.js', fixed: 'const x = 1;', original: '', issues: ['i'] },
      { file: 'no-fixed.js', original: '', issues: ['i'] },
      { fixed: 'no-file', original: '', issues: ['i'] },
    ],
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 3);
  result.rejected.forEach((r) => assert.match(r.reason || '', /malformed fix entry/));
});

test('validateFixesSyntax — checkers can be injected for tests', () => {
  let jsCalls = 0;
  let jsonCalls = 0;
  const result = validateFixesSyntax({
    fixes: [
      { file: 'a.js',   fixed: 'irrelevant', original: '', issues: ['i'] },
      { file: 'b.json', fixed: 'irrelevant', original: '', issues: ['i'] },
    ],
    checkers: {
      js: () => { jsCalls++; return { ok: false, reason: 'forced fail' }; },
      json: () => { jsonCalls++; return { ok: true }; },
    },
  });
  assert.equal(jsCalls, 1);
  assert.equal(jsonCalls, 1);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, 'forced fail');
});

test('validateFixesSyntax — input validation', () => {
  assert.throws(() => validateFixesSyntax({ fixes: 'not an array' }), /fixes must be an array/);
  assert.throws(() => validateFixesSyntax({}), /fixes must be an array/);
});

// ---------- Summary helper ----------

test('summariseSyntaxGate — empty', () => {
  assert.equal(summariseSyntaxGate(null), 'syntax gate: not run');
  assert.equal(summariseSyntaxGate({ accepted: [], rejected: [] }), 'syntax gate: 0 fixes');
});

test('summariseSyntaxGate — all clean', () => {
  const result = {
    accepted: [
      { file: 'a.js',   language: 'js' },
      { file: 'b.json', language: 'json' },
    ],
    rejected: [],
  };
  assert.equal(summariseSyntaxGate(result), 'syntax gate: 2 fixes validated, all clean');
});

test('summariseSyntaxGate — partial reject', () => {
  const result = {
    accepted: [{ file: 'a.js', language: 'js' }],
    rejected: [{ file: 'b.json', language: 'json', reason: 'invalid JSON' }],
  };
  const summary = summariseSyntaxGate(result);
  assert.match(summary, /1\/2 clean/);
  assert.match(summary, /1 rejected/);
  assert.match(summary, /b\.json/);
});
