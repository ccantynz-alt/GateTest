/**
 * FP-residue sweep from the 2026-08-18 deep audit (docs/audits/2026-08-18-deep-audit.md).
 * One suite per residue item, each with a POSITIVE control (the rule still
 * fires on the real defect) and a NEGATIVE control (the measured false
 * positive no longer fires). Without the positive half, tightening a rule
 * until the bench repo goes quiet is indistinguishable from the rule working.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function failed(result, nameFragment) {
  // Check names embed OS-native paths — normalize so assertions are portable.
  return result.checks.filter(
    (c) => !c.passed && c.name.replace(/\\/g, '/').includes(nameFragment));
}

// ── 1. confidence: docs_src is sample code ─────────────────────────────────

describe('confidence — docs_src sample directories are example data', () => {
  const { isExampleDataFile } = require('../src/core/confidence')._signals;

  it('downweights source files under docs_src/ (fastapi tutorial snippets)', () => {
    const hit = isExampleDataFile('docs_src/security/tutorial004.py');
    assert.ok(hit, 'docs_src source file should be example data');
    assert.strictEqual(hit.multiplier, 0.4);
  });

  it('downweights doc-src spelling variants', () => {
    assert.ok(isExampleDataFile('doc_src/x.py'));
    assert.ok(isExampleDataFile('pkg/docs-src/y.js'));
  });

  it('POSITIVE: shipping source under docs/ routes keeps full weight', () => {
    assert.strictEqual(isExampleDataFile('website/app/docs/api/page.tsx'), null);
  });

  it('POSITIVE: an ordinary src/ file keeps full weight', () => {
    assert.strictEqual(isExampleDataFile('src/auth/login.py'), null);
  });
});

// ── 2. dead-code extractor: python multi-line imports + decorated defs ─────

describe('dead-code extractor — python residue', () => {
  const { extractPyImports, extractPyExports } = require('../src/modules/dead-code-extractor');

  it('sees every name in a parenthesized multi-line import', () => {
    const src = 'from app.utils import (\n    helper_one,\n    helper_two,  # used everywhere\n    helper_three as h3,\n)\n';
    const { names, paths } = extractPyImports(src);
    assert.ok(names.has('helper_one'));
    assert.ok(names.has('helper_two'));
    assert.ok(names.has('helper_three'));
    assert.ok(paths.has('app.utils'));
  });

  it('sees names in a backslash-continuation import', () => {
    const src = 'from app.utils import helper_one, \\\n    helper_two\n';
    const { names } = extractPyImports(src);
    assert.ok(names.has('helper_one'));
    assert.ok(names.has('helper_two'));
  });

  it('POSITIVE: single-line imports still parse', () => {
    const { names, paths } = extractPyImports('from x import a, b as c\nimport os\n');
    assert.ok(names.has('a') && names.has('b') && names.has('os'));
    assert.ok(paths.has('x'));
  });

  it('does not report decorated defs as exports (they are registered by the decorator)', () => {
    const src = '@app.get("/items")\ndef read_items():\n    pass\n\n@pytest.fixture\n@functools.wraps(f)\ndef client():\n    pass\n';
    const names = extractPyExports(src).map((e) => e.name);
    assert.deepStrictEqual(names, []);
  });

  it('handles a multi-line decorator call above the def', () => {
    const src = '@router.post(\n    "/users",\n    status_code=201,\n)\ndef create_user():\n    pass\n';
    assert.deepStrictEqual(extractPyExports(src), []);
  });

  it('POSITIVE: an undecorated def is still an export candidate', () => {
    const src = 'def plain_helper():\n    pass\n';
    assert.strictEqual(extractPyExports(src)[0].name, 'plain_helper');
  });
});

// ── 3. flaky-tests: real-clock fires only when the clock is asserted ───────

describe('flaky-tests — real-clock needs an assertion to be flaky', () => {
  const FlakyTestsModule = require('../src/modules/flaky-tests');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-clock-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new FlakyTestsModule().run(result, { projectRoot: root });
    return result;
  }

  it('NEGATIVE: a timestamped fixture id is not flagged', async () => {
    write(tmp, 'tests/a.test.js',
      'it("x", () => {\n  const id = `run-${Date.now()}`;\n  expect(makeThing(id).name).toBe(id);\n});\n');
    // `id` IS asserted, but as an opaque value compared with itself — the
    // stricter shape we accept as unavoidable; the pure-fixture case below
    // is the one the tautology used to catch.
    write(tmp, 'tests/b.test.js',
      'it("y", () => {\n  const dir = `/tmp/out-${Date.now()}`;\n  mkdir(dir);\n  expect(readConfig("/etc/app").port).toBe(8080);\n});\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'real-clock:tests/b.test.js').length, 0,
      'clock used only for a temp path must not be flagged');
  });

  it('POSITIVE: asserting against the clock inline is flagged', async () => {
    write(tmp, 'tests/c.test.js',
      'it("z", () => {\n  expect(record.createdAt).toBeGreaterThan(Date.now() - 1000);\n});\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'real-clock:tests/c.test.js').length, 1);
  });

  it('POSITIVE: asserting a variable that holds a clock reading is flagged', async () => {
    write(tmp, 'tests/d.test.js',
      'it("w", () => {\n  const t0 = Date.now();\n  doWork();\n  expect(Date.parse(log.time) - t0).toBeLessThan(50);\n});\n');
    const r = await run(tmp);
    assert.ok(failed(r, 'real-clock:tests/d.test.js').length >= 1);
  });

  it('NEGATIVE: fake timers still silence the rule', async () => {
    write(tmp, 'tests/e.test.js',
      'jest.useFakeTimers();\nit("v", () => {\n  expect(Date.now()).toBe(0);\n});\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'real-clock:tests/e.test.js').length, 0);
  });
});

// ── 4. error-swallow: classic function callbacks (Mongo style) ─────────────

describe('error-swallow — callback-err-ignored covers function-style callbacks', () => {
  const ErrorSwallowModule = require('../src/modules/error-swallow');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-es-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new ErrorSwallowModule().run(result, { projectRoot: root });
    return result;
  }

  it('POSITIVE: Mongo-style function(err, docs) that never reads err is flagged', async () => {
    write(tmp, 'src/db.js',
      'collection.find(query).toArray(function (err, docs) {\n  render(docs);\n  done(docs.length);\n});\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'callback-err-ignored:src/db.js').length, 1);
  });

  it('NEGATIVE: err handled beyond the old 5-line window is not flagged', async () => {
    write(tmp, 'src/late.js', [
      'db.connect(function (err, conn) {',
      '  const opts = defaults();',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  if (err) { return handle(err); }',
      '  use(conn, opts, a + b + c + d);',
      '});',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'callback-err-ignored:src/late.js').length, 0);
  });

  it('POSITIVE: arrow-callback detection is unchanged', async () => {
    write(tmp, 'src/arrow.js', 'fs.readFile(p, (err, data) => {\n  use(data);\n});\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'callback-err-ignored:src/arrow.js').length, 1);
  });
});

// ── 5. dependencies: maven parent-BOM managed versions ─────────────────────

describe('dependencies — maven versionless deps under central management', () => {
  const DependenciesModule = require('../src/modules/dependencies');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-mvn-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new DependenciesModule().run(result, { projectRoot: root });
    return result;
  }

  const dep = (artifact, version) =>
    `<dependency><groupId>g</groupId><artifactId>${artifact}</artifactId>${version ? `<version>${version}</version>` : ''}</dependency>`;

  it('NEGATIVE: parent POM (spring-boot style) suppresses missing-version warnings', async () => {
    write(tmp, 'pom.xml',
      `<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.3.0</version></parent><dependencies>${dep('spring-boot-starter-web')}</dependencies></project>`);
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'wildcard:maven').length, 0);
  });

  it('NEGATIVE: dependencyManagement entry suppresses the warning for that artifact', async () => {
    write(tmp, 'pom.xml',
      `<project><dependencyManagement><dependencies>${dep('guava', '33.0.0-jre')}</dependencies></dependencyManagement><dependencies>${dep('guava')}</dependencies></project>`);
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'wildcard:maven').length, 0);
  });

  it('POSITIVE: an unmanaged versionless dependency still warns', async () => {
    write(tmp, 'pom.xml', `<project><dependencies>${dep('commons-lang3')}</dependencies></project>`);
    const r = await run(tmp);
    const hits = failed(r, 'wildcard:maven:commons-lang3');
    assert.strictEqual(hits.length, 1);
  });
});

// ── 6. compatibility: browserslist only for browser-facing repos ───────────

describe('compatibility — browserslist gated on web signals', () => {
  const CompatibilityModule = require('../src/modules/compatibility');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-bl-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new CompatibilityModule().run(result, { projectRoot: root });
    return result;
  }

  it('NEGATIVE: a repo with no package.json (gin-gonic/gin) gets no browserslist warning', async () => {
    write(tmp, 'main.go', 'package main\n');
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'compat:browserslist').length, 0);
  });

  it('NEGATIVE: a pure Node server/CLI gets no browserslist warning', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'cli', dependencies: { commander: '^12.0.0' } }));
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'compat:browserslist').length, 0);
  });

  it('POSITIVE: a React app without browserslist config still warns', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }));
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'compat:browserslist').length, 1);
  });

  it('POSITIVE: config present passes regardless', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'web', browserslist: ['defaults'], dependencies: { react: '^19.0.0' } }));
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'compat:browserslist').length, 0);
  });
});

// ── 7. ai-hallucination: repo tsconfig path aliases are trusted ────────────

describe('ai-hallucination — tsconfig paths aliases are not hallucinations', () => {
  const AiHallucinationModule = require('../src/modules/ai-hallucination');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-aih-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new AiHallucinationModule().run(result, { projectRoot: root });
    return result;
  }

  it('NEGATIVE: imports through custom tsconfig aliases are not flagged', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'app', dependencies: {} }));
    write(tmp, 'tsconfig.json', JSON.stringify({
      compilerOptions: { paths: { '#internal/*': ['./src/internal/*'], '$core/*': ['./src/core/*'] } },
    }));
    write(tmp, 'src/a.ts', "import { x } from '#internal/utils';\nimport { y } from '$core/engine';\nexport const z = x + y;\n");
    const r = await run(tmp);
    const unknown = r.checks.filter((c) => !c.passed && /#internal|\$core/.test(String(c.message || c.name)));
    assert.strictEqual(unknown.length, 0);
  });

  it('tolerates JSONC tsconfig (comments + trailing commas)', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'app', dependencies: {} }));
    write(tmp, 'tsconfig.json', '{\n  // comment\n  "compilerOptions": {\n    "paths": {\n      "#x/*": ["./src/x/*"],\n    },\n  },\n}\n');
    write(tmp, 'src/a.ts', "import { x } from '#x/y';\nexport default x;\n");
    const r = await run(tmp);
    const unknown = r.checks.filter((c) => !c.passed && /#x\//.test(String(c.message || c.name)));
    assert.strictEqual(unknown.length, 0);
  });

  it('POSITIVE: a genuinely unknown package is still flagged', async () => {
    write(tmp, 'package.json', JSON.stringify({ name: 'app', dependencies: {} }));
    write(tmp, 'src/a.ts', "import { q } from 'left-padz-ultra';\nexport default q;\n");
    const r = await run(tmp);
    const unknown = r.checks.filter((c) => !c.passed && /left-padz-ultra/.test(String(c.message || c.name)));
    assert.ok(unknown.length >= 1, 'unknown package must still be reported');
  });
});

// ── 8. bash-safety: findings carry message + rel path + line ───────────────

describe('bash-safety — findings are consumable by the registry', () => {
  const BashSafetyModule = require('../src/modules/bash-safety');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-bs-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('shell-script finding has message, relative file, and line', async () => {
    write(tmp, 'scripts/deploy.sh', '#!/bin/sh\nmake build || true\n');
    const result = makeResult();
    await new BashSafetyModule().run(result, { projectRoot: tmp });
    const hit = result.checks.find((c) => !c.passed && c.name.includes('deploy.sh'));
    assert.ok(hit, 'swallow pattern must be found');
    assert.ok(typeof hit.message === 'string' && hit.message.length > 0, 'message must be set');
    assert.ok(!path.isAbsolute(hit.file), 'file must be repo-relative');
    assert.strictEqual(hit.line, 2);
  });

  it('package.json script finding has a message naming the script', async () => {
    write(tmp, 'package.json', JSON.stringify({ scripts: { test: 'jest 2>/dev/null || true' } }));
    const result = makeResult();
    await new BashSafetyModule().run(result, { projectRoot: tmp });
    const hit = result.checks.find((c) => !c.passed && c.name.includes('package.json'));
    assert.ok(hit && /scripts\.test/.test(hit.message));
  });
});

// ── 9. universal-checker ruby: integer interpolation downgrade ─────────────

describe('universal-checker — ruby system-interp integer downgrade', () => {
  const { runLanguageChecks } = require('../src/core/universal-checker');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-rb-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('NEGATIVE: kill -9 of a forked pid is a warning, not a blocking error', () => {
    write(tmp, 'server.rb', 'pid = fork\nsystem "kill -9 #{pid}"\n');
    const result = makeResult();
    runLanguageChecks('ruby', tmp, result);
    const hit = result.checks.find((c) => !c.passed && c.name.includes('system-interp'));
    assert.ok(hit, 'finding stays visible');
    assert.strictEqual(hit.severity, 'warning');
    assert.match(hit.message, /provable integer/);
  });

  it('POSITIVE: interpolating request input stays a blocking error', () => {
    write(tmp, 'app.rb', 'system "convert #{params[:file]} out.png"\n');
    const result = makeResult();
    runLanguageChecks('ruby', tmp, result);
    const hit = result.checks.find((c) => !c.passed && c.name.includes('system-interp'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('POSITIVE: a mixed line (integer + string interpolation) stays an error', () => {
    write(tmp, 'mix.rb', 'pid = fork\nsystem "kill -#{sig} #{pid}"\n');
    const result = makeResult();
    runLanguageChecks('ruby', tmp, result);
    const hit = result.checks.find((c) => !c.passed && c.name.includes('system-interp'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });
});

// ── 10. duplicate-code: data blocks + per-offset region reporting ──────────

describe('duplicate-code — data is not code, one region is one finding', () => {
  const DuplicateCode = require('../src/modules/duplicate-code');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fpres-dc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new DuplicateCode().run(result, { projectRoot: root });
    return result;
  }

  const LOGIC = [
    'function totalOf(items) {',
    '  let total = 0;',
    '  for (const item of items) {',
    '    if (!item.valid) continue;',
    '    total += item.price * item.qty;',
    '  }',
    '  if (total < 0) throw new Error("negative");',
    '  const rounded = Math.round(total * 100) / 100;',
    '  audit.log("total", rounded);',
    '  notify(rounded);',
    '  persist(rounded);',
    '  return rounded;',
    '}',
  ].join('\n');

  it('NEGATIVE: matching data tables in two files are not "duplicate code"', async () => {
    const data = (rows) => `module.exports = [\n${rows.map(([n, a]) => `  { name: "${n}", age: ${a}, active: true, region: "${n}-r" },`).join('\n')}\n];\n`;
    write(tmp, 'src/users-a.js', data([['Alice', 30], ['Bob', 41], ['Cara', 22], ['Dan', 35], ['Eve', 28], ['Fay', 31], ['Gus', 44]]));
    write(tmp, 'src/users-b.js', data([['Hal', 50], ['Ivy', 27], ['Jon', 33], ['Kim', 39], ['Lee', 25], ['Mia', 36], ['Ned', 47]]));
    const r = await run(tmp);
    assert.strictEqual(failed(r, 'duplicate-code:').length, 0,
      'string-collapsed data rows must not report as duplicated code');
  });

  it('POSITIVE: real duplicated logic across two files is still found — as ONE finding, not one per window offset', async () => {
    write(tmp, 'src/checkout.js', `${LOGIC}\n`);
    write(tmp, 'src/invoice.js', `${LOGIC}\n`);
    const r = await run(tmp);
    const hits = failed(r, 'duplicate-code:');
    assert.strictEqual(hits.length, 1,
      `a 13-line duplicated region must be exactly one finding, got ${hits.length}`);
  });
});

// ── 11. finding-registry: fastapi innerHTML cross-module dup stays folded ──

describe('finding-registry — security + codeQuality innerHTML at one line fold to one finding', () => {
  const { normalizeFindings } = require('../src/core/finding-registry');

  it('marks the codeQuality copy as a duplicate of the security finding', () => {
    const results = [
      { module: 'security', checks: [{ name: 'security:innerHTML assignment:docs/js/x.js:10', passed: false, severity: 'error', file: 'docs/js/x.js', line: 10, message: 'innerHTML assignment', confidence: 0.9 }] },
      { module: 'codeQuality', checks: [{ name: 'quality:innerHTML assignment detected:docs/js/x.js:10', passed: false, severity: 'error', file: 'docs/js/x.js', line: 10, message: 'innerHTML assignment detected — use textContent or sanitize at line 10', confidence: 0.9 }] },
    ];
    const findings = normalizeFindings(results);
    const dups = findings.filter((f) => f.duplicateOf);
    assert.strictEqual(dups.length, 1);
    assert.strictEqual(dups[0].module, 'codeQuality');
  });
});
