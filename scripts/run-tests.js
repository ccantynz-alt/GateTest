#!/usr/bin/env node
'use strict';
/**
 * The test runner that cannot report success while doing nothing.
 *
 * `node --test --test-force-exit` was adopted (180bf7c) because one test file
 * left a handle open and the bare runner then hung for hours. Measured
 * 2026-09-05: the flag exits the runner as soon as the tests it has HEARD OF
 * are done — a child still streaming its later suites is cut off, its tests
 * are never counted, and the exit code is 0. Four files, three runs of the
 * same tree: 50, 77, 61 tests. One file alone: 63, 40, 33, 63 names. Every
 * `# fail 0` produced that way was evidence about the tests that happened to
 * finish first, not about the suite (Doctrine §1).
 *
 * This runner spawns one plain `node --test` per file (no force-exit), reads
 * its TAP stream, and ends the child only after the final summary line has
 * been read — so a leaked handle is killed on OUR terms, after every result
 * is in. A file whose stream ends without that summary (crash, `process.exit`
 * mid-run, the per-file wall clock) is a FAILURE, never a silent zero.
 *
 * Usage: node scripts/run-tests.js [--timeout ms] [--file-timeout ms]
 *          [--concurrency n] [--out path] <files…>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SUMMARY_RE = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/;
const END_RE = /^# duration_ms /;
const RESULT_RE = /^\s*(not )?ok \d+ - (.*)$/;

function parseArgs(argv) {
  const opts = { timeout: 60000, fileTimeout: 15 * 60 * 1000, concurrency: Math.max(1, Math.min(4, os.cpus().length)), out: null, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--file-timeout') opts.fileTimeout = Number(argv[++i]);
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else opts.files.push(a);
  }
  if (!opts.files.length) opts.files = fs.readdirSync('tests').filter((f) => f.endsWith('.test.js')).map((f) => path.join('tests', f));
  return opts;
}

/** One TAP line from the child: totals, named results, and the end marker. */
function absorbLine(res, self, line, child) {
  res.lines.push(line);
  const m = SUMMARY_RE.exec(line);
  if (m) res[m[1]] = Number(m[2]);
  // Node reports the FILE as a test of its own when it has no tests (or
  // when its event loop never drained) — a file with nothing in it says
  // `# tests 1 / # pass 1`. Count results that are not the file itself.
  const r = RESULT_RE.exec(line);
  if (r && !self.has(r[2].trim())) res.named += 1;
  if (END_RE.test(line)) {
    // Every result is in. A leaked timer / socket / child in the test
    // process is the runner's problem no longer — end it now.
    res.finished = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000).unref();
  }
}

/** Spawn one plain `node --test` for a file, TAP on stdout. */
function spawnTestFile(file, opts) {
  // NODE_TEST_CONTEXT is what a `node --test` parent stamps on its children;
  // inherited here it makes the child refuse to run ("called recursively").
  // Dropping it lets this runner be invoked from inside a test.
  const { NODE_TEST_CONTEXT, ...env } = process.env; // eslint-disable-line no-unused-vars
  return spawn(process.execPath, ['--test', `--test-timeout=${opts.timeout}`, '--test-reporter=tap', file], {
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
}

/** Run one file; resolve with its parsed result. Never rejects. */
function runFile(file, opts) {
  return new Promise((resolve) => {
    const res = { file, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, named: 0, finished: false, exitCode: null, lines: [] };
    const self = new Set([file, path.resolve(file)]);
    const child = spawnTestFile(file, opts);
    let buf = '';
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      res.why = why;
      resolve(res);
    };
    const timer = setTimeout(() => { res.timedOut = true; child.kill('SIGKILL'); }, opts.fileTimeout);
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) { absorbLine(res, self, buf.slice(0, nl), child); buf = buf.slice(nl + 1); }
    });
    child.stderr.on('data', (d) => { for (const l of String(d).split('\n')) if (l) res.lines.push(`stderr: ${l}`); });
    child.on('error', (err) => { res.lines.push(`spawn error: ${err.message}`); finish('spawn-error'); });
    child.on('close', (code, signal) => {
      if (buf) absorbLine(res, self, buf, child);
      res.exitCode = code;
      res.signal = signal;
      finish(res.finished ? 'summary' : (res.timedOut ? 'file-timeout' : 'ended-before-summary'));
    });
  });
}

function verdict(r) {
  if (!r.finished) return r.timedOut ? `did not finish within the file timeout` : `ended before its summary (exit ${r.exitCode}${r.signal ? `, ${r.signal}` : ''}) — its tests are NOT counted`;
  if (r.fail > 0 || r.cancelled > 0) return `${r.fail} failing, ${r.cancelled} cancelled${r.cancelled ? ' (Node cancels a file when --test-timeout elapses for the file itself: a leaked timer, socket or child kept its event loop alive, or its tests took longer than the timeout — run it alone to tell which)' : ''}`;
  if (r.tests === 0 || r.named === 0) return 'reported zero tests';
  return null;
}

function printFailure(r, reason) {
  process.stdout.write(`\n✗ ${r.file}: ${reason}\n`);
  const out = r.lines;
  for (let i = 0; i < out.length; i += 1) {
    if (/^\s*not ok /.test(out[i])) {
      for (let j = i; j < Math.min(out.length, i + 14); j += 1) process.stdout.write(`    ${out[j]}\n`);
    }
  }
  if (!r.finished) for (const l of out.slice(-12)) process.stdout.write(`    ${l}\n`);
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const results = await pool(opts.files, opts.concurrency, (f) => runFile(f, opts));
  const totals = { files: results.length, tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, unfinished: 0, failedFiles: 0 };
  let bad = 0;
  for (const r of results) {
    for (const k of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) totals[k] += r[k];
    if (!r.finished) totals.unfinished += 1;
    const reason = verdict(r);
    if (reason) { bad += 1; totals.failedFiles += 1; printFailure(r, reason); }
  }
  if (opts.out) fs.writeFileSync(opts.out, results.map((r) => `# ${r.file}\n${r.lines.join('\n')}\n`).join('\n'));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(`\n# files ${totals.files}\n# tests ${totals.tests}\n# pass ${totals.pass}\n# fail ${totals.fail}\n# cancelled ${totals.cancelled}\n# skipped ${totals.skipped}\n# todo ${totals.todo}\n# files that did not finish ${totals.unfinished}\n# duration_s ${secs}\n`);
  if (bad) {
    process.stdout.write(`\nSUITE: FAILED — ${bad} of ${totals.files} file(s) failed or did not finish\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`\nSUITE: PASSED — every one of ${totals.files} file(s) reported its summary\n`);
  }
}

if (require.main === module) main();
module.exports = { runFile, verdict, parseArgs };
