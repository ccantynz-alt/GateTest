// =============================================================================
// SOURCE EXTENSIONS — .mjs and .cjs are source files
// =============================================================================
// Twenty-one call sites across the modules collected
// `['.js', '.ts', '.jsx', '.tsx']`, and not one included `.mjs` or `.cjs`.
// Those are not exotic — `.mjs` is how Node marks an ES module, `.cjs` how it
// marks CommonJS inside an ESM package, and GateTest's own MCP server is
// `bin/gatetest-mcp.mjs`.
//
// In the security module the consequence was total: the entire
// dangerous-pattern scan — eval, Function constructor, shell exec with
// interpolated input, NoSQL injection, path traversal, open redirect,
// Math.random for secrets — never opened a `.mjs` file.
//
// FOUND BY A CROSS-ENGINE DIFF, NOT BY READING CODE. Running GateTest and
// Gluecron's scorer over the same tree (ccantynz/Gluecron.com @e168803 on
// gluecron.com), their scanner reported three `no-eval` findings we did not:
//
//   src/lib/hosted-claude-loop.ts:15    " - Sandboxed exec: we never `eval()`"   <- their FP
//   src/lib/workflow-conditionals.ts:6  " * NO eval(), NO Function constructor"  <- their FP
//   scripts/interaction-audit.mjs:180   return eval(checkSrc)(panel);            <- REAL, our miss
//
// We correctly suppressed both comments. We missed the live one because of a
// file extension. Their noisier rule saw what our more careful one could not:
// precision on files you never open is not precision.
//
// The knowledge already existed — src/core/confidence.js lists mjs/cjs/mts/cts
// in SOURCE_EXT_RE — and had not been generalised. Fourth instance of that
// pattern in one day.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SecurityModule = require('../src/modules/security');
const CodeQualityModule = require('../src/modules/code-quality');
const { JS_SOURCE_EXTS } = require('../src/core/source-extensions');
const GateTestConfig = require('../src/core/config').GateTestConfig;

async function scanSecurity(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ext-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, rel), content);
    }
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    await new SecurityModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('source-extensions — the shared list', () => {
  it('includes the ESM and CJS extensions', () => {
    for (const ext of ['.mjs', '.cjs', '.mts', '.cts']) {
      assert.ok(JS_SOURCE_EXTS.includes(ext), `${ext} missing from JS_SOURCE_EXTS`);
    }
  });

  it('still includes the originals', () => {
    for (const ext of ['.js', '.jsx', '.ts', '.tsx']) {
      assert.ok(JS_SOURCE_EXTS.includes(ext), `${ext} missing from JS_SOURCE_EXTS`);
    }
  });
});

describe('security — dangerous patterns are found in .mjs and .cjs', () => {
  // The regression, verbatim in shape from Gluecron's interaction-audit.mjs.
  it('finds eval() in a .mjs file', async () => {
    const found = await scanSecurity({
      'audit.mjs': 'export function run(src, panel) {\n  return eval(src)(panel);\n}\n',
    });
    assert.ok(
      found.some((f) => /eval/i.test(f.id) && /\.mjs/.test(f.id)),
      `eval() in a .mjs file was not reported:\n${found.map((f) => f.id).join('\n')}`,
    );
  });

  it('finds eval() in a .cjs file', async () => {
    const found = await scanSecurity({
      'legacy.cjs': 'module.exports = function (src) { return eval(src); };\n',
    });
    assert.ok(
      found.some((f) => /eval/i.test(f.id) && /\.cjs/.test(f.id)),
      'eval() in a .cjs file was not reported',
    );
  });

  it('still finds eval() in a plain .js file', async () => {
    const found = await scanSecurity({ 'a.js': 'const r = eval(src);\n' });
    assert.ok(found.some((f) => /eval/i.test(f.id)));
  });

  it('does NOT report prose about eval in a .mjs file', async () => {
    // The load-bearing negative: widening the file set must not also widen
    // what counts as a call. Both of Gluecron's false positives were comments
    // of exactly this shape, and our comment guard is what separated us.
    const found = await scanSecurity({
      'comment.mjs': '// Sandboxed exec: we never eval() here.\nexport const ok = 1;\n',
    });
    assert.deepStrictEqual(
      found.filter((f) => /eval/i.test(f.id)).map((f) => f.id), [],
      'a comment describing eval was reported as a call',
    );
  });
});

describe('code-quality — forbidden patterns reach .mjs and .cjs', () => {
  it('the module collects the shared extension list', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'code-quality.js'), 'utf8',
    );
    assert.match(
      src, /JS_SOURCE_EXTS/,
      'code-quality has gone back to a hand-written extension array',
    );
    assert.ok(
      !/\['\.js', '\.ts', '\.jsx', '\.tsx'\]/.test(src),
      'a hand-written JS/TS extension array is back in code-quality',
    );
  });

  it('config still exposes the innerHTML rule it needs', () => {
    // Guards against the extension change quietly disturbing rule wiring.
    // DEFAULT_CONFIG, not `new GateTestConfig()` — the latter defaults to
    // process.cwd() and loads THIS repo's .gatetest.json, so the assertion
    // would be about our own project settings rather than the shipped default.
    const { DEFAULT_CONFIG } = require('../src/core/config');
    const patterns = DEFAULT_CONFIG.modules.codeQuality.forbiddenPatterns;
    assert.ok(patterns.some((p) => /innerHTML/.test(p.pattern.source)));
  });
});
