// =============================================================================
// SYNTAX — JSONC config files are not JSON syntax errors
// =============================================================================
// Measured 2026-09-01 scanning axios @81df7a5: the syntax module emitted a
// BLOCKING "JSON syntax error" on `.devcontainer/devcontainer.json`, whose
// only irregularity was a trailing comma — which is legal in that format.
// devcontainer.json, tsconfig.json, jsconfig.json and everything under
// .vscode/ are JSONC by specification; the tools that own them parse comments
// and trailing commas without complaint.
//
// Any repo with a devcontainer or a commented tsconfig hit this, which is a
// large share of modern TypeScript projects, and it failed their build on a
// file that was correct.
//
// The knowledge already existed 200 lines away in the same module ("tsconfig
// is JSONC") and had not been applied to the check that needed it.
//
// The load-bearing half of these tests is the second and third groups: an
// ordinary data JSON with a trailing comma must STILL fail, and a tsconfig
// that is broken beyond legal JSONC must STILL fail. Otherwise this is not a
// fix, it is a way of never reporting bad JSON again.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { stripJsonc, isJsoncPath } = require('../src/core/jsonc');

describe('jsonc — recognising the formats that permit it', () => {
  const JSONC = [
    'tsconfig.json',
    'tsconfig.build.json',
    'jsconfig.json',
    '.devcontainer/devcontainer.json',
    'devcontainer.json',
    '.vscode/settings.json',
    '.vscode/launch.json',
    'packages/api/tsconfig.json',
  ];
  for (const p of JSONC) {
    it(`treats ${p} as JSONC`, () => assert.strictEqual(isJsoncPath(p), true));
  }

  const STRICT = [
    'package.json',
    'data/config.json',
    'src/fixtures/users.json',
    'composer.json',
    // Not a tsconfig — a file that merely mentions one.
    'docs/tsconfig-guide.json',
  ];
  for (const p of STRICT) {
    it(`treats ${p} as strict JSON`, () => assert.strictEqual(isJsoncPath(p), false));
  }
});

describe('jsonc — stripping is string-aware', () => {
  const parse = (t) => JSON.parse(stripJsonc(t));

  it('accepts a trailing comma in an object', () => {
    assert.deepStrictEqual(parse('{"a": 1,}'), { a: 1 });
  });

  it('accepts a trailing comma in an array', () => {
    assert.deepStrictEqual(parse('{"a": [1, 2,]}'), { a: [1, 2] });
  });

  it('accepts line and block comments', () => {
    assert.deepStrictEqual(
      parse('{\n // one\n "a": 1, /* two */\n "b": 2\n}'),
      { a: 1, b: 2 },
    );
  });

  it('does NOT eat // inside a string value', () => {
    // The regex version of this fix corrupts the URL and the file stops
    // parsing — turning a false positive into a different false positive.
    assert.deepStrictEqual(
      parse('{"url": "https://example.com/x"}'),
      { url: 'https://example.com/x' },
    );
  });

  it('does NOT strip a comma that only looks trailing inside a string', () => {
    assert.deepStrictEqual(parse('{"a": "x,}", "b": 1}'), { a: 'x,}', b: 1 });
  });

  it('does not corrupt an escaped quote before a comma', () => {
    assert.deepStrictEqual(parse('{"a": "he said \\"hi\\",", "b": 1}'), { a: 'he said "hi",', b: 1 });
  });

  it('reproduces the axios devcontainer shape exactly', () => {
    const src = [
      '{',
      '  "name": "axios",',
      '  "features": {',
      '    "ghcr.io/devcontainers/features/github-cli:1": {},',
      '  },',
      '  "postCreateCommand": "npm ci --ignore-scripts"',
      '}',
    ].join('\n');
    const parsed = parse(src);
    assert.strictEqual(parsed.name, 'axios');
    assert.deepStrictEqual(parsed.features['ghcr.io/devcontainers/features/github-cli:1'], {});
  });
});

describe('jsonc — genuinely broken input is still broken', () => {
  // Not a JSON5 parser. These must not start passing.
  const BROKEN = [
    ['unquoted key', '{a: 1}'],
    ['single-quoted string', "{'a': 1}"],
    ['missing closing brace', '{"a": 1'],
    ['missing comma between members', '{"a": 1 "b": 2}'],
    ['bare word value', '{"a": oops}'],
  ];

  for (const [why, src] of BROKEN) {
    it(`still rejects: ${why}`, () => {
      assert.throws(() => JSON.parse(stripJsonc(src)));
    });
  }
});

// =============================================================================
// The half that was missing (found 2026-09-04).
//
// Everything above tests `stripJsonc` and `isJsoncPath` as pure functions,
// and all of it passed. The module that CALLS them did not work: in
// `_checkJsonSyntax`, `content` was `const`-declared inside the `try`, so
// the JSONC retry in the `catch` referenced a variable that was not in
// scope. The resulting ReferenceError was then absorbed by the retry's own
// bare `catch {}`, so the failure was invisible — it simply fell through and
// reported the original JSON error.
//
// Net effect: the fix documented at the top of this file shipped, was
// unit-tested, and never once ran. A commented tsconfig.json — what
// `tsc --init` itself emits — was still reported as a syntax error.
//
// Unit tests on a helper cannot see that. These go through the module.
// =============================================================================
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SyntaxModule = require('../src/modules/syntax');

async function checkJson(rel, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-jsonc-e2e-'));
  try {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    const checks = [];
    const result = {
      checks,
      addCheck: (id, passed, meta) => checks.push({ id, passed, ...(meta || {}) }),
      addInfo() {},
    };
    await new SyntaxModule().run(result, { projectRoot: root });
    return checks.find((c) => c.id === `json:${rel}`) || null;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('jsonc — through the syntax module, not just the helper', () => {
  it('a commented tsconfig.json passes (what `tsc --init` emits)', async () => {
    const check = await checkJson(
      'tsconfig.json',
      '{\n  // Comments are legal here\n  "compilerOptions": { "strict": true, }\n}',
    );
    assert.ok(check, 'tsconfig.json must be checked at all');
    assert.strictEqual(check.passed, true, 'a commented tsconfig is not a syntax error');
  });

  it('a block-commented jsconfig.json passes', async () => {
    const check = await checkJson('jsconfig.json', '{ /* block */ "a": 1 }');
    assert.strictEqual(check.passed, true);
  });

  // The load-bearing half: tolerance must not become blindness.
  it('an ordinary data JSON with a trailing comma still FAILS', async () => {
    const check = await checkJson('data/config.json', '{ "a": 1, }');
    assert.strictEqual(check.passed, false, 'JSONC tolerance is scoped to config formats');
  });

  it('a tsconfig broken beyond legal JSONC still FAILS', async () => {
    const check = await checkJson('tsconfig.json', '{ "a": [1,2 }');
    assert.strictEqual(check.passed, false, 'the second parse must still be able to fail');
  });

  it('the JSONC retry does not swallow a programming error', async () => {
    // The bug was hidden because `catch {}` absorbed a ReferenceError. Pin
    // that a non-parse failure is no longer silently treated as "malformed".
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'syntax.js'),
      'utf8',
    );
    assert.ok(
      /catch \(retryErr\)[\s\S]{0,400}?instanceof ReferenceError/.test(src),
      'the JSONC retry must rethrow ReferenceError/TypeError rather than absorb it',
    );
  });
});
