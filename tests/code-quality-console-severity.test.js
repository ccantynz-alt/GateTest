// =============================================================================
// CODE QUALITY — console.log severity follows the rule's own scope
// =============================================================================
// The rule is "no console.log in LIBRARY code" — code a consumer imports,
// whose console it pollutes. `_severityForForbidden` already establishes
// whether a path is library code, and then emitted a WARNING either way.
//
// A warning asserts that something is wrong. In a test file, an example or a
// build script, nothing is being violated — and the function has already
// decided that by the time it returns. The module was reporting a defect it
// did not itself believe in.
//
// Measured on axios @81df7a5 (org axios): 79 of its 82 codeQuality warnings
// were console.log, and ALL 79 were in tests/ (70), sandbox/ (5) and
// examples/ (4). Zero in lib/. That is 24% of the repo's entire warning
// volume spent on a rule that does not apply where it fired.
//
// Info is disclosed and counted separately — the finding moves out of the
// warning wall, not out of the report. That distinction is the whole change,
// and these tests exist so a later pass cannot quietly extend it into the
// cases where the rule DOES apply.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CodeQualityModule = require('../src/modules/code-quality');
const { GateTestConfig } = require('../src/core/config');

async function severityFor(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-clog-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    // Pass the root to the CONSTRUCTOR. `new GateTestConfig()` defaults to
    // `process.cwd()` and loads THAT directory's .gatetest.json — so a test
    // run from the repo root silently inherits GateTest's own config, whose
    // codeQuality `excludePaths` contains `tests/`. Assigning projectRoot
    // afterwards does not undo the config already loaded.
    //
    // That cost me a debugging detour today: findings for `tests/**` fixtures
    // vanished, which looked exactly like a defect in the change under test
    // and was the harness reading the host repo's exclusions.
    const config = new GateTestConfig(root);
    await new CodeQualityModule().run(result, config);
    const out = {};
    for (const c of checks) {
      if (c.passed || !/console\.log/.test(c.id)) continue;
      // severity undefined means the module left it at the default (error).
      out[c.id.replace(/\\/g, '/')] = c.meta.severity || 'error';
    }
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const PUBLISHED = '{"name":"pkg","version":"1.0.0","main":"lib/index.js"}\n';
const PRIVATE_APP = '{"name":"app","private":true}\n';
const LOG = 'console.log("x");\n';

describe('console.log — the rule applies to library code', () => {
  it('a published package logging from lib/ is an error', async () => {
    const sev = await severityFor({
      'package.json': PUBLISHED,
      'lib/index.js': `function f(){ ${LOG.trim()} }\nmodule.exports=f;\n`,
    });
    const hit = Object.entries(sev).find(([k]) => k.includes('lib/index.js'));
    assert.ok(hit, 'console.log in published library code was not reported at all');
    assert.strictEqual(hit[1], 'error', 'library logging must stay blocking');
  });

  it("a private app's src/ stays a warning", async () => {
    // Not a library — nobody imports it — so this is a style question, not a
    // consumer-facing defect. Unchanged by this fix.
    const sev = await severityFor({
      'package.json': PRIVATE_APP,
      'src/index.js': LOG,
    });
    const hit = Object.entries(sev).find(([k]) => k.includes('src/index.js'));
    assert.ok(hit, 'console.log in app source was not reported');
    assert.strictEqual(hit[1], 'warning');
  });
});

describe('console.log — where the rule does not apply, it is info', () => {
  const NON_LIBRARY = {
    'tests/a.test.js': 'test("t", () => { console.log("x"); });\n',
    'examples/demo.js': LOG,
    'sandbox/client.js': LOG,
    'benchmark/run.js': LOG,
    // NOT scripts/ — see the separate assertion below. It is excluded from
    // codeQuality scanning entirely by the shipped default `excludePaths`,
    // so there is no finding to have a severity. Asserting `info` there would
    // have been asserting something the module never emits.
  };

  for (const [rel, content] of Object.entries(NON_LIBRARY)) {
    it(`${rel} is info, not a warning`, async () => {
      const sev = await severityFor({ 'package.json': PUBLISHED, [rel]: content });
      const hit = Object.entries(sev).find(([k]) => k.includes(rel));
      assert.ok(hit, `${rel}: finding disappeared entirely — it must still be disclosed`);
      assert.strictEqual(
        hit[1], 'info',
        `${rel} is not library code, so a warning asserts a violation that does not exist`,
      );
    });
  }

  it('the finding is still emitted, not suppressed', async () => {
    // The load-bearing assertion. "Reduce the warning count" would also be
    // satisfied by dropping these on the floor, which is not what this is.
    const sev = await severityFor({
      'package.json': PUBLISHED,
      'tests/a.test.js': 'test("t", () => { console.log("x"); });\n',
    });
    assert.strictEqual(Object.keys(sev).length, 1, 'the finding must still be reported');
  });
});

describe('code-quality — scripts/ is excluded from scanning entirely', () => {
  // Not a severity question: `scripts` is in the shipped default
  // `excludePaths`, so codeQuality never opens those files. Pinned because I
  // briefly wrote a test asserting `info` there, which would have been
  // asserting a severity for a finding that is never emitted.
  it('emits no console.log finding for scripts/', async () => {
    const sev = await severityFor({ 'package.json': PUBLISHED, 'scripts/build.js': LOG });
    assert.deepStrictEqual(Object.keys(sev), []);
  });

  it('the default excludePaths still lists scripts', () => {
    const { DEFAULT_CONFIG } = require('../src/core/config');
    assert.ok(
      DEFAULT_CONFIG.modules.codeQuality.excludePaths.includes('scripts'),
      'scripts left the default exclude list — the test above no longer means what it says',
    );
  });
});
