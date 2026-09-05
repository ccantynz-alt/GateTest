'use strict';
/**
 * scripts/run-tests.js — the runner that cannot report success while doing
 * nothing. Control pairs: a passing file passes; a failing file fails the
 * suite with its `not ok` shown; a file that leaks a timer still finishes
 * (the runner ends it after the summary — this is what --test-force-exit
 * was for, and where it dropped tests); a file that exits before its summary
 * is a FAILURE, not a silent zero; a file with no tests is a failure.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNNER = path.join(__dirname, '..', 'scripts', 'run-tests.js');
let root;
function write(rel, body) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return f; }
function run(files, extra = []) {
  const r = spawnSync(process.execPath, [RUNNER, '--timeout', '5000', '--file-timeout', '20000', ...extra, ...files], { cwd: root, encoding: 'utf-8' });
  return { code: r.status, out: r.stdout + r.stderr };
}
const line = (out, key) => { const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(out); return m ? Number(m[1]) : null; };

describe('scripts/run-tests.js — every file must report its summary', () => {
  let passing, failing, leaking, exiting, empty;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-runner-'));
    passing = write('t/pass.test.js', "const { test } = require('node:test'); const assert = require('node:assert');\ntest('one', () => assert.ok(true));\ntest('two', () => assert.ok(true));\n");
    failing = write('t/fail.test.js', "const { test } = require('node:test'); const assert = require('node:assert');\ntest('good', () => assert.ok(true));\ntest('bad', () => assert.strictEqual(1, 2));\n");
    // A leaked interval keeps the child's event loop alive: Node then cancels
    // the file itself after --test-timeout and prints the summary; the runner
    // ends the child after that summary instead of waiting on the leak.
    leaking = write('t/leak.test.js', "const { test } = require('node:test'); const assert = require('node:assert');\nsetInterval(() => {}, 1000);\ntest('leaky but green', () => assert.ok(true));\n");
    // A file whose `node --test` parent never reaches its summary within the
    // runner's file timeout: the runner kills it and reports it as NOT
    // finished — the shape --test-force-exit produced silently, from the
    // other side (it exited the parent early, and counted what it had).
    exiting = write('t/hang.test.js', "const { test } = require('node:test');\ntest('first', () => {});\ntest('slow', async () => { await new Promise((r) => setTimeout(r, 30000)); });\n");
    empty = write('t/empty.test.js', "'use strict';\nmodule.exports = 1;\n");
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('POSITIVE CONTROL — a passing file: exit 0, its tests counted, SUITE: PASSED', () => {
    const { code, out } = run([passing]);
    assert.strictEqual(code, 0, out);
    assert.strictEqual(line(out, 'tests'), 2);
    assert.strictEqual(line(out, 'pass'), 2);
    assert.match(out, /SUITE: PASSED/);
  });

  it('a failing file fails the suite and its `not ok` is shown', () => {
    const { code, out } = run([passing, failing]);
    assert.strictEqual(code, 1, out);
    assert.strictEqual(line(out, 'fail'), 1);
    assert.match(out, /not ok 2 - bad/);
    assert.match(out, /SUITE: FAILED — 1 of 2 file\(s\)/);
  });

  it('a file that leaks a timer is reported as cancelled — a failure with the leak named — and the runner does not hang on it', () => {
    const t0 = Date.now();
    const { code, out } = run([leaking]);
    assert.strictEqual(code, 1, out);
    assert.strictEqual(line(out, 'pass'), 1, 'the green test inside it is still counted');
    assert.strictEqual(line(out, 'cancelled'), 1);
    assert.strictEqual(line(out, 'files that did not finish'), 0, 'its summary was read');
    assert.match(out, /leaked timer, socket or child/);
    assert.ok(Date.now() - t0 < 15000, `must not wait for the leaked interval (${Date.now() - t0}ms)`);
  });

  it('NEGATIVE CONTROL — a file whose runner never reaches its summary within the file timeout is a failure, not a silent partial count', () => {
    const t0 = Date.now();
    const { code, out } = run([passing, exiting], ['--timeout', '60000', '--file-timeout', '3000']);
    assert.strictEqual(code, 1, out);
    assert.strictEqual(line(out, 'files that did not finish'), 1);
    assert.match(out, /hang\.test\.js: did not finish within the file timeout/);
    assert.ok(Date.now() - t0 < 20000, `killed at the file timeout (${Date.now() - t0}ms)`);
  });

  it('a file that reports zero tests is a failure', () => {
    const { code, out } = run([empty]);
    assert.strictEqual(code, 1, out);
    assert.match(out, /reported zero tests/);
  });
});
