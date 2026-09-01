/**
 * `console.log` severity is context-sensitive — the Bible's rule is "no
 * console.log IN LIBRARY CODE", and the module used to drop that qualifier.
 *
 * Neutral-repo audit 2026-08-12: on expressjs/express this one rule produced
 * 37 of 50 error-severity findings, every one of them a demo in `examples/`
 * printing its own banner, a verbose-guarded log, or a test diagnostic.
 *
 * The negative controls matter as much as the downgrades: a real console.log
 * left in the library source of a published package must still be an error,
 * and `debugger` / `eval` / `innerHTML =` must stay unconditional regardless
 * of where they appear.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CodeQualityModule = require('../src/modules/code-quality');

/** Build a project root with a package.json and the given files. */
function scaffold(tmp, pkg, files) {
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify(pkg));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

const PUBLISHED = { name: 'lib', version: '1.0.0', main: 'lib/index.js' };
const APP = { name: 'app', version: '1.0.0', private: true };

describe('codeQuality: console.* severity by context', () => {
  let tmp, mod;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cq-'));
    mod = new CodeQualityModule();
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const sev = (relFwd, line, root) => mod._severityForForbidden('console\\.(log|debug|info)\\(', relFwd, line, root);

  it('NEGATIVE CONTROL: errors in library source of a published package', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(
      sev('lib/response.js', "  console.log('oops');", tmp),
      undefined,
      'undefined keeps the module default (error) — a stray log shipped to consumers',
    );
  });

  // REVISED 2026-09-01, warning -> info, for the three NON-LIBRARY-PATH cases
  // only. This file's 2026-08-12 fix moved them error -> warning, which was
  // right and is not being undone: the question then was "must this block?"
  // and the answer is still no.
  //
  // The new evidence is warning VOLUME. Measured on axios @81df7a5 (org
  // axios): 79 of its 82 codeQuality warnings were console.log, all 79 in
  // tests/ (70), sandbox/ (5) and examples/ (4), none in lib/ — 24% of the
  // repo's entire warning output. Across the corpus the change moves axios
  // 335 -> 256 warnings, express 119 -> 82, fastify 211 -> 184.
  //
  // The titles above already argued for it: "a CLI talking to the user is its
  // job", "a diagnostic is deliberate". If the use is the file's job, a
  // WARNING asserts a violation that this very function has already decided
  // does not exist. Info is disclosed and counted; the finding moves out of
  // the warning wall, not out of the report.
  //
  // The two `warning` cases below are deliberately untouched, because they
  // are library-path judgements rather than scope ones.
  it('info in examples/ — a demo printing its own banner is not a defect', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(sev('examples/auth/index.js', "console.log('Express started');", tmp), 'info');
  });

  it('info in bin/ and scripts/ — a CLI talking to the user is its job', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(sev('bin/cli.js', "console.log('done');", tmp), 'info');
    assert.strictEqual(sev('scripts/release.js', "console.log('done');", tmp), 'info');
  });

  it('info in tests — a diagnostic is deliberate', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(sev('test/res.location.js', "console.log(err);", tmp), 'info');
    assert.strictEqual(sev('src/__tests__/a.test.js', "console.log(err);", tmp), 'info');
  });

  it('warns when the log is guarded by a verbose flag', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(sev('lib/boot.js', "  verbose && console.log('mounted');", tmp), 'warning');
    assert.strictEqual(sev('lib/boot.js', "  if (options.verbose) console.log('x');", tmp), 'warning');
  });

  it('warns in an application repo — console.log in an app is not a defect', () => {
    scaffold(tmp, APP, {});
    assert.strictEqual(sev('src/server.js', "console.log('listening');", tmp), 'warning');
  });

  it('NEGATIVE CONTROL: debugger/eval/innerHTML stay unconditional errors', () => {
    scaffold(tmp, APP, {});
    // Non-console patterns return undefined (= default error) even in the
    // most "excusable" location there is.
    assert.strictEqual(mod._severityForForbidden('\\bdebugger\\b', 'examples/demo.js', 'debugger;', tmp), undefined);
    assert.strictEqual(mod._severityForForbidden('eval\\s*\\(', 'examples/demo.js', 'eval(x);', tmp), undefined);
    assert.strictEqual(mod._severityForForbidden('\\.innerHTML\\s*=', 'test/a.js', 'el.innerHTML = x;', tmp), undefined);
  });

  it('_isLibraryPath distinguishes library source from demos and tooling', () => {
    assert.strictEqual(mod._isLibraryPath('lib/response.js'), true);
    assert.strictEqual(mod._isLibraryPath('src/core/runner.js'), true);
    assert.strictEqual(mod._isLibraryPath('examples/a.js'), false);
    assert.strictEqual(mod._isLibraryPath('packages/x/test/a.js'), false, 'nested test dir counts');
    assert.strictEqual(mod._isLibraryPath('Examples/a.js'), false, 'case-insensitive');
  });

  it('_publishesPackage: main/exports/bin count, private does not', () => {
    scaffold(tmp, PUBLISHED, {});
    assert.strictEqual(mod._publishesPackage(tmp), true);

    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cq2-'));
    scaffold(tmp2, APP, {});
    assert.strictEqual(mod._publishesPackage(tmp2), false, 'private:true is not published');
    fs.rmSync(tmp2, { recursive: true, force: true });

    const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cq3-'));
    assert.strictEqual(mod._publishesPackage(tmp3), false, 'no package.json at all');
    fs.rmSync(tmp3, { recursive: true, force: true });
  });

  it('end-to-end: a demo log warns while a library log errors, in one scan', async () => {
    scaffold(tmp, PUBLISHED, {
      'lib/index.js': "function f() {\n  console.log('leaked');\n}\nmodule.exports = f;\n",
      'examples/demo.js': "console.log('Server started on 3000');\n",
    });

    const checks = [];
    const result = { checks, addCheck(name, passed, d = {}) { checks.push({ name, passed, ...d }); } };
    const config = {
      projectRoot: tmp,
      getModuleConfig: () => ({ excludePaths: [], forbiddenPatterns: [
        { pattern: /console\.(log|debug|info)\(/g, message: 'console.log/debug/info found' },
      ] }),
      config: { thresholds: { maxFunctionLength: 50, maxFileLength: 300 } },
    };

    await mod.run(result, config);

    const hits = checks.filter(c => !c.passed && /console\.log/.test(c.name));
    const lib = hits.find(c => c.file && c.file.replace(/\\/g, '/').startsWith('lib/'));
    const demo = hits.find(c => c.file && c.file.replace(/\\/g, '/').startsWith('examples/'));

    assert.ok(lib, 'library log must still be reported');
    // "downgraded, not hidden" is the assertion that matters and it is
    // unchanged — the demo finding is still emitted. Only its severity moved
    // warning -> info, for the reasons above.
    assert.ok(demo, 'demo log must still be reported — downgraded, not hidden');
    assert.strictEqual(lib.severity, undefined, 'library log keeps default error severity');
    assert.strictEqual(demo.severity, 'info');
  });
});
