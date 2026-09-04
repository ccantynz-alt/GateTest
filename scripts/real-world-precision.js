#!/usr/bin/env node
/**
 * Real-world precision gate — scan pinned third-party repos, hold the line.
 *
 * On 2026-09-04 the "known-good corpus must stay clean" job was green while
 * every real repository it had never seen was BLOCKED: express 2, flask 2,
 * fastify 6, got 20, zod 51, hono 55. The corpus meant to guarantee precision
 * held two synthetic fixtures — `empty-js-module` and `modern-node-idioms`.
 *
 * That is not a gap in coverage, it is a gap in KIND. Every rule in this
 * engine was written and tuned against this repository, so this repository is
 * the one codebase on which their false-positive rate cannot be measured. The
 * only honest test is code we did not write and cannot quietly adjust.
 *
 * Ceilings ratchet DOWN. Raising one to make a build pass is how the engine
 * goes back to blocking express, so a raise should arrive with the same
 * scrutiny as any other regression.
 *
 * Usage:
 *   node scripts/real-world-precision.js                  # all repos
 *   node scripts/real-world-precision.js --repo express   # one repo
 *   node scripts/real-world-precision.js --update         # print measured counts
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'reliability-corpus', 'real-world.json');
const GATETEST = path.join(ROOT, 'bin', 'gatetest.js');

// Strip SGR colour sequences before parsing the summary line.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function parseArgs(argv) {
  const opts = { repo: null, update: false, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') { opts.repo = argv[i + 1]; i += 1; }
    else if (argv[i] === '--update') opts.update = true;
    else if (argv[i] === '--keep') opts.keep = true;
  }
  return opts;
}

/** Shallow-clone one commit. Fails loudly — a skipped repo must never read as a pass. */
function clone(repo, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const run = (args) => spawnSync('git', args, { cwd: dest, encoding: 'utf8', stdio: 'pipe' });
  let r = run(['init', '-q']);
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr || r.stdout}`);
  r = run(['remote', 'add', 'origin', repo.url]);
  if (r.status !== 0) throw new Error(`git remote add failed: ${r.stderr || r.stdout}`);
  r = run(['fetch', '--depth', '1', '-q', 'origin', repo.sha]);
  if (r.status !== 0) throw new Error(`git fetch of ${repo.sha.slice(0, 8)} failed: ${r.stderr || r.stdout}`);
  r = run(['checkout', '-q', 'FETCH_HEAD']);
  if (r.status !== 0) throw new Error(`git checkout failed: ${r.stderr || r.stdout}`);
}

/**
 * Blocking count for one repo.
 *
 * Read from the summary line the runner prints:
 *   "  Errors:   2 blocking, 13 soft (low confidence)"  -> 2
 *   "  Errors:   0"                                      -> 0
 * Exit code is deliberately NOT used: a repo is allowed to block (NodeGoat
 * must), so the number is the signal, not pass/fail.
 */
function scan(dir) {
  const res = spawnSync(process.execPath, [GATETEST, 'scan', '--suite', 'full', '--project', dir], {
    encoding: 'utf8',
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`.replace(ANSI_RE, '');
  const m = out.match(/^\s*Errors:\s*(\d+)\s*(?:blocking)?/m);
  if (!m) {
    throw new Error(
      'could not read a blocking count from the scan output — the summary format may have changed.\n' +
      `Last 40 lines:\n${out.split('\n').slice(-40).join('\n')}`,
    );
  }
  return Number(m[1]);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const repos = opts.repo ? manifest.repos.filter((r) => r.name === opts.repo) : manifest.repos;
  if (repos.length === 0) {
    console.error(`No repo named "${opts.repo}" in ${path.relative(ROOT, MANIFEST)}`);
    process.exit(2);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-realworld-'));
  const failures = [];
  const measured = [];

  try {
    for (const repo of repos) {
      const dest = path.join(tmp, repo.name);
      process.stdout.write(`\n--- ${repo.name} @ ${repo.sha.slice(0, 8)}\n    ${repo.why}\n`);
      let blocking;
      try {
        clone(repo, dest);
        blocking = scan(dest);
      } catch (err) {
        // A repo we could not measure is a failure, never a silent pass —
        // that confusion is the whole reason this file exists.
        failures.push(`${repo.name}: could not be measured — ${err.message}`);
        console.log(`    ERROR  ${err.message}`);
        continue;
      }

      measured.push({ name: repo.name, blocking });

      if (typeof repo.maxBlocking === 'number') {
        const ok = blocking <= repo.maxBlocking;
        console.log(`    ${ok ? 'ok  ' : 'FAIL'}   ${blocking} blocking (ceiling ${repo.maxBlocking})`);
        if (!ok) {
          failures.push(
            `${repo.name}: ${blocking} blocking findings, ceiling is ${repo.maxBlocking}. ` +
            'Something started over-firing on code we do not control. Fix the rule — ' +
            'do not raise the ceiling.',
          );
        }
      } else if (typeof repo.minBlocking === 'number') {
        const ok = blocking >= repo.minBlocking;
        console.log(`    ${ok ? 'ok  ' : 'FAIL'}   ${blocking} blocking (floor ${repo.minBlocking})`);
        if (!ok) {
          failures.push(
            `${repo.name}: only ${blocking} blocking findings, floor is ${repo.minBlocking}. ` +
            'Recall dropped — a deliberately vulnerable app stopped failing. A quieter ' +
            'scanner is not a better one.',
          );
        }
      }
    }
  } finally {
    if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (opts.update) {
    console.log('\nMeasured counts (for updating the manifest deliberately):');
    for (const m of measured) console.log(`  ${m.name.padEnd(10)} ${m.blocking}`);
  }

  console.log('');
  if (failures.length) {
    console.log('REAL-WORLD PRECISION GATE: FAILED\n');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log(`REAL-WORLD PRECISION GATE: PASSED (${measured.length} repo(s))\n`);
}

main();
