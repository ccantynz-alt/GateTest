#!/usr/bin/env node
/**
 * Determinism gate — same tree, same findings.
 *
 * The Fifty, move 19. Non-determinism in a gate is indistinguishable from
 * flakiness, and flakiness is how gates get switched off: the first time a
 * re-run "fixes" a red build, every red build after it is a re-run away
 * from green. So the engine is scanned against the same tree twice and the
 * two finding sets must be identical — module, rule, file, line, severity,
 * confidence and message, order-independent.
 *
 * Measured 2026-09-05 before this existed: quick suite 1057 = 1057, full
 * suite identical too. The point of the script is that this stays true when
 * the next module ships a Date.now() in a message, a Set iterated in hash
 * order, or a worker-pool race.
 *
 * Usage:
 *   node scripts/determinism-check.js                       # this repo, full suite
 *   node scripts/determinism-check.js --project <dir>       # another tree
 *   node scripts/determinism-check.js --suite quick --runs 3
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATETEST = path.join(ROOT, 'bin', 'gatetest.js');
// Modules that need a CI runner or mutate the tree are not part of a
// determinism claim about the scanner itself (same skip list as the dogfood
// self-scan).
const SKIP = ['mutation', 'e2e', 'unitTests'];

function parseArgs(argv) {
  const opts = { project: ROOT, suite: 'full', runs: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project') { opts.project = path.resolve(argv[i + 1]); i += 1; }
    else if (argv[i] === '--suite') { opts.suite = argv[i + 1]; i += 1; }
    else if (argv[i] === '--runs') { opts.runs = Math.max(2, Number(argv[i + 1]) || 2); i += 1; }
  }
  return opts;
}

/** Run one scan and return its report object. Fails loudly on any problem. */
function scan(opts) {
  const args = [GATETEST, '--suite', opts.suite, '--all', '--parallel', '--project', opts.project];
  for (const m of SKIP) args.push('--skip-module', m);
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
    env: { ...process.env, GATETEST_NO_TELEMETRY: '1' },
  });
  if (res.error) throw new Error(`scan did not run: ${res.error.message}`);
  const reportPath = path.join(opts.project, '.gatetest', 'reports', 'gatetest-report-latest.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`no report at ${reportPath}\nLast 30 lines:\n${`${res.stdout}${res.stderr}`.split('\n').slice(-30).join('\n')}`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

/**
 * A finding's identity for comparison. Everything a user could see, nothing
 * that is allowed to differ between runs (timestamps, durations, ordering).
 */
function fingerprint(report) {
  const out = [];
  for (const m of report.results || []) {
    for (const c of m.checks || []) {
      if (c.passed) continue;
      out.push([
        m.module,
        c.name,
        c.file || '',
        c.line || '',
        c.severity || '',
        typeof c.confidence === 'number' ? c.confidence.toFixed(4) : '',
        c.suppressed ? 'suppressed' : '',
        String(c.message || '').slice(0, 200),
      ].join('|'));
    }
  }
  return out.sort();
}

/**
 * Compare run 1 against every later run. Returns the number of differing
 * findings and the lines to print. Pure, so the failure path can be tested
 * without a scan — a determinism gate that was never seen to fail is a
 * gate nobody has proven works.
 * @param {string[][]} runs  fingerprints per run
 */
function compareRuns(runs) {
  const base = new Set(runs[0]);
  let diffs = 0;
  const report = [];
  for (let i = 1; i < runs.length; i += 1) {
    const cur = new Set(runs[i]);
    const missing = runs[0].filter((f) => !cur.has(f));
    const extra = runs[i].filter((f) => !base.has(f));
    if (missing.length || extra.length) {
      diffs += missing.length + extra.length;
      report.push(`\n  run 1 vs run ${i + 1}: ${missing.length} finding(s) vanished, ${extra.length} appeared`);
      for (const f of missing.slice(0, 20)) report.push(`    - ${f}`);
      for (const f of extra.slice(0, 20)) report.push(`    + ${f}`);
    }
  }
  return { diffs, report };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`Determinism check: ${opts.runs} × --suite ${opts.suite} on ${path.relative(ROOT, opts.project) || '.'}`);

  const runs = [];
  for (let i = 0; i < opts.runs; i += 1) {
    const t0 = Date.now();
    const report = scan(opts);
    const fp = fingerprint(report);
    runs.push(fp);
    console.log(`  run ${i + 1}: ${fp.length} findings, gate ${report.gatetest && report.gatetest.gateStatus}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  const { diffs, report } = compareRuns(runs);
  for (const line of report) console.log(line);

  console.log('');
  if (diffs > 0) {
    console.log('DETERMINISM GATE: FAILED — the same tree produced different findings.');
    console.log('A gate that disagrees with itself will be re-run until it is green, and then ignored.');
    process.exit(1);
  }
  console.log(`DETERMINISM GATE: PASSED (${runs[0].length} findings identical across ${opts.runs} runs)`);
}

module.exports = { fingerprint, compareRuns };

if (require.main === module) main();
