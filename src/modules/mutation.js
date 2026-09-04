/**
 * Mutation Testing Module - Verifies tests actually catch bugs.
 *
 * Applies real code mutations (operator swaps, boundary changes, return value flips)
 * and verifies that at least one test fails for each mutation. If all tests still pass
 * after a mutation, the test suite has a gap.
 *
 * This is the most aggressive testing technique available — it tests the tests themselves.
 */

const BaseModule = require('./base-module');
const { JS_SOURCE_EXTS_NO_JSX } = require('../core/source-extensions');
const fs = require('fs');
const path = require('path');
// Mutation operators extracted to a testable engine module so they can
// be unit-tested independently of the test-runner orchestration.
const { MUTATIONS, shouldSkipLine } = require('../core/mutation-engine');

// ─────────────────────────────────────────────────────────────────────────────
// Crash-safe restore.
//
// This module writes a mutant into the user's REAL source file, runs their
// tests against it, and restores the original in a `finally`. `finally`
// covers a thrown exception. It does not cover the process being killed —
// and that is the common case, not the exotic one: a CI step that times out
// gets SIGTERM, a developer who hits Ctrl-C sends SIGINT, and either lands
// inside the window where the file on disk is corrupt.
//
// Observed three times in one session: `a - b` left as `a + b` in
// arena-scaffold/src/math.js, a `+` flipped to `-` inside a string literal
// in arena-scaffold/scripts/inject-bug.js, and a mutant in
// benchmarks/bench-target/config/default.js. A scanner that silently edits
// your working tree is worse than one that misses a bug.
//
// So every in-flight mutation is registered here and replayed on any exit
// path Node can observe. SIGKILL still cannot be caught — nothing can fix
// that — but SIGTERM/SIGINT/SIGHUP and a plain process.exit() now restore.
// ─────────────────────────────────────────────────────────────────────────────
const IN_FLIGHT = new Map(); // absPath -> original contents

function restoreAllInFlight() {
  for (const [file, original] of IN_FLIGHT) {
    // error-ok: we are on an exit path with nowhere left to report to, and a
    // failed restore must not stop us restoring the remaining files.
    try { fs.writeFileSync(file, original); } catch { /* best effort on the way out */ }
  }
  IN_FLIGHT.clear();
}

let handlersInstalled = false;
function installRestoreHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', restoreAllInFlight);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    try {
      process.on(sig, () => {
        restoreAllInFlight();
        // Re-raise with the conventional exit code so callers still see
        // that we were signalled rather than that we exited cleanly.
        process.exit(sig === 'SIGINT' ? 130 : 143);
      });
      // error-ok: SIGBREAK is Windows-only and SIGHUP is absent on some
      // platforms; an unknown signal name is expected, not a failure.
    } catch { /* platform does not have this signal */ }
  }
}

class MutationModule extends BaseModule {
  constructor() {
    super('mutation', 'Mutation Testing — Tests the Tests');
    // Opt out of incremental: mutation testing needs to mutate source
    // and re-run the FULL test suite per mutation. Restricting to the
    // changed file's source mutations is fine, but most projects need
    // the full corpus to get a meaningful score, and CI already runs
    // mutation nightly (not on every PR) so the speedup isn't needed.
    this._respectsIncremental = false;
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const mutationConfig = config.getModuleConfig ? config.getModuleConfig('mutation') : {};
    const threshold = (mutationConfig && mutationConfig.threshold) || 80;
    const maxMutants = (mutationConfig && mutationConfig.maxMutants) || 50;

    // Detect test command
    const testCmd = this._detectTestCommand(projectRoot);
    if (!testCmd) {
      result.addCheck('mutation:detect', true, {
        message: 'No test framework detected — skipping mutation testing',
        severity: 'info',
      });
      return;
    }

    // Find source files (non-test files)
    const sourceFiles = this._findSourceFiles(projectRoot);
    if (sourceFiles.length === 0) {
      result.addCheck('mutation:sources', true, {
        message: 'No source files found for mutation testing',
        severity: 'info',
      });
      return;
    }

    // Mutation testing needs an INSTALLED, GREEN suite to be meaningful. A
    // repo whose deps are not installed here (fresh clone, no node_modules)
    // cannot be mutated — that is our environment, not the customer's
    // defect. Reported as an info skip; unitTests owns "your tests fail".
    // (2026-08-18 audit: this was a blocking error on express, NodeGoat and
    // this repo, and on a Python repo it mutated docs JS with `node --test`.)
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath) && !fs.existsSync(path.join(projectRoot, 'node_modules'))) {
      result.addCheck('mutation:baseline', true, {
        severity: 'info',
        message: 'Skipped — dependencies are not installed, so the suite cannot run as a mutation baseline',
        suggestion: 'Run "npm ci" before scanning, or run mutation testing in CI',
      });
      return;
    }
    if (!fs.existsSync(pkgPath)) {
      result.addCheck('mutation:baseline', true, {
        severity: 'info',
        message: 'Skipped — mutation testing supports Node.js projects (package.json) only',
      });
      return;
    }

    // Verify tests pass before mutating.
    //
    // The baseline is also the MEASUREMENT that makes the rest of this module
    // honest. A mutant run used to get a hardcoded 30s; on any project whose
    // suite takes longer than that, every mutant timed out, every timeout was
    // read as a non-zero exit, and a non-zero exit was counted as "killed" —
    // so the module reported a perfect score without a single test ever
    // having finished. Measured on a fixture whose suite takes 35s:
    // "Mutation score: 100% (3/3 killed, 0 survived)", all three from
    // timeouts. That is the most dangerous number this engine can print: a
    // team reads it as "our tests are bulletproof".
    const baselineStart = Date.now();
    const baseline = this._exec(testCmd, { cwd: projectRoot, timeout: 120000 });
    const baselineMs = Date.now() - baselineStart;
    if (baseline.exitCode !== 0) {
      result.addCheck('mutation:baseline', true, {
        message: 'Skipped — the suite does not pass, so mutants cannot be measured (see unitTests for the failure)',
        severity: 'info',
        suggestion: 'Fix failing tests first, then re-run mutation testing',
      });
      return;
    }

    result.addCheck('mutation:baseline', true, {
      message: `Baseline tests pass. Generating mutants from ${sourceFiles.length} source files...`,
      severity: 'info',
    });

    // A mutant gets three times what the clean suite needed, floored at the
    // old 30s and capped so one pathological run cannot eat the budget.
    const mutantTimeout = Math.min(Math.max(baselineMs * 2, 30000), 90000);

    // Wall-clock budget for the whole module. maxMutants alone bounds the
    // COUNT, not the TIME: 50 mutants against a 30s suite is 25 minutes, and
    // a full self-scan of this repo hit `timeout 1200` (exit 124) still
    // inside this module, against the 60s bar in CLAUDE.md section 9.
    // Sampling fewer mutants and saying so beats a scan that never returns.
    const timeBudgetMs = (mutationConfig && mutationConfig.timeBudgetMs) || 120000;
    const deadline = Date.now() + timeBudgetMs;

    // Generate and test mutants
    let killed = 0;
    let survived = 0;
    let inconclusive = 0;
    let budgetExhausted = false;
    let totalMutants = 0;
    const survivors = [];

    for (const file of sourceFiles) {
      if (totalMutants >= maxMutants || budgetExhausted) break;
      if (Date.now() > deadline) { budgetExhausted = true; break; }

      const relPath = path.relative(projectRoot, file);
      const original = fs.readFileSync(file, 'utf-8');
      const lines = original.split('\n');

      for (const mutation of MUTATIONS) {
        if (totalMutants >= maxMutants || budgetExhausted) break;

        // Find lines where this mutation can apply
        for (let i = 0; i < lines.length; i++) {
          if (totalMutants >= maxMutants || budgetExhausted) break;

          const line = lines[i];
          // Skip comments, imports, requires — delegated to mutation-engine
          // helper so the rule lives in one place (tested in isolation).
          if (shouldSkipLine(line)) continue;

          mutation.pattern.lastIndex = 0;
          if (!mutation.pattern.test(line)) continue;

          // Apply mutation
          mutation.pattern.lastIndex = 0;
          const mutatedLine = line.replace(mutation.pattern, mutation.replace);
          if (mutatedLine === line) continue;

          const mutated = [...lines];
          mutated[i] = mutatedLine;
          const mutatedSource = mutated.join('\n');

          totalMutants++;

          // Write mutant, run tests, restore original
          // The bound has to sit where the cost is. Every other check above
          // is a convenience; this is the one that stops a single file from
          // running a full set of mutants past the deadline.
          if (Date.now() > deadline) { budgetExhausted = true; break; }

          try {
            installRestoreHandlers();
            IN_FLIGHT.set(file, original);
            fs.writeFileSync(file, mutatedSource);
            const testResult = this._exec(testCmd, { cwd: projectRoot, timeout: mutantTimeout });

            if (testResult.timedOut) {
              // We learned nothing. The suite did not finish, so it neither
              // caught the mutant nor missed it. Counting this as a kill is
              // how a 100% score gets manufactured out of slow tests.
              inconclusive++;
            } else if (testResult.exitCode !== 0) {
              killed++;
            } else {
              survived++;
              survivors.push({
                file: relPath,
                line: i + 1,
                mutation: mutation.name,
                description: mutation.desc,
                original: line.trim(),
                mutated: mutatedLine.trim(),
              });
            }
          } finally {
            // Always restore original
            fs.writeFileSync(file, original);
            IN_FLIGHT.delete(file);
          }

          // Only test first match per mutation per file to keep runtime reasonable
          break;
        }
      }
    }

    if (totalMutants === 0) {
      result.addCheck('mutation:none', true, {
        message: 'No applicable mutations found in source files',
        severity: 'info',
      });
      return;
    }

    // Score over mutants we actually learned something from. An inconclusive
    // mutant is excluded from both halves of the fraction rather than
    // silently improving it.
    const conclusive = killed + survived;

    if (conclusive === 0) {
      result.addCheck('mutation:score', true, {
        message:
          `Mutation score: not measured — all ${totalMutants} mutant run(s) exceeded ` +
          `${Math.round(mutantTimeout / 1000)}s and were inconclusive. The suite takes ` +
          `~${Math.round(baselineMs / 1000)}s clean; raise modules.mutation.timeBudgetMs ` +
          'or speed the suite up.',
        severity: 'info',
      });
      return;
    }

    const score = Math.round((killed / conclusive) * 100);
    const caveats = [];
    if (inconclusive > 0) caveats.push(`${inconclusive} inconclusive (timed out, not counted)`);
    if (budgetExhausted) caveats.push(`stopped at the ${Math.round(timeBudgetMs / 1000)}s budget`);
    const caveat = caveats.length ? ` — ${caveats.join('; ')}` : '';

    // A truncated run is a SAMPLE, not a measurement. On this repo the budget
    // stops it after 4 mutants, and failing a build on "0% of 4" is the kind
    // of unreliable verdict that teaches people to ignore the gate — the
    // number is real but it cannot carry a build decision. Blocking is
    // reserved for a run that finished; a truncated one reports the same
    // number as a warning, says it is a sample, and says why it stopped.
    const truncated = budgetExhausted || totalMutants >= maxMutants;
    const failing = score < threshold;
    const blocks = failing && !truncated;

    result.addCheck('mutation:score', !failing || truncated, {
      message:
        `Mutation score: ${score}% (${killed}/${conclusive} killed, ${survived} survived)` +
        `${caveat}${truncated ? ' — SAMPLE, not a full measurement' : ''}`,
      expected: `>= ${threshold}%`,
      actual: `${score}%`,
      severity: !failing ? 'info' : (blocks ? 'error' : 'warning'),
      suggestion: failing
        ? (truncated
          ? 'Add tests for the survivors below. This sample did not cover the whole repo — ' +
            'raise modules.mutation.timeBudgetMs / maxMutants for a verdict that can block.'
          : 'Add tests that detect the surviving mutations listed below')
        : undefined,
    });

    // Report survivors as individual warnings
    for (const s of survivors.slice(0, 20)) {
      result.addCheck(`mutation:survivor:${s.file}:${s.line}:${s.mutation}`, false, {
        file: s.file,
        line: s.line,
        severity: 'warning',
        message: `${s.description} at line ${s.line} — tests did not catch this`,
        suggestion: `Add a test that would fail when "${s.original}" becomes "${s.mutated}"`,
      });
    }

    if (survivors.length > 20) {
      result.addCheck('mutation:survivors-truncated', true, {
        severity: 'info',
        message: `${survivors.length - 20} more surviving mutants not shown. Run with --verbose for full list.`,
      });
    }

    // Write mutation report
    this._writeReport(projectRoot, { score, killed, survived, totalMutants, threshold, survivors });
  }

  _detectTestCommand(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test && !pkg.scripts.test.includes('no test specified')) {
          return 'npm test 2>&1';
        }
      } catch { /* ignore */ }
    }

    const testDirs = ['tests', 'test', '__tests__'];
    for (const dir of testDirs) {
      if (fs.existsSync(path.join(projectRoot, dir))) {
        return 'node --test 2>&1';
      }
    }

    return null;
  }

  _findSourceFiles(projectRoot) {
    const sourceFiles = this._collectFiles(projectRoot, JS_SOURCE_EXTS_NO_JSX, [
      'node_modules', '.git', '.claude', 'dist', 'build', 'coverage', '.gatetest',
      '.next', 'website', 'test', 'tests', '__tests__', 'spec',
    ]);

    // Exclude test files and config files
    return sourceFiles.filter(f => {
      const base = path.basename(f);
      return !base.includes('.test.') && !base.includes('.spec.') &&
             !base.includes('.config.') && base !== 'jest.config.js' &&
             !base.startsWith('.');
    });
  }

  _writeReport(projectRoot, data) {
    const reportDir = path.join(projectRoot, '.gatetest', 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const report = {
      type: 'mutation-testing',
      timestamp: new Date().toISOString(),
      score: data.score,
      threshold: data.threshold,
      mutants: {
        total: data.totalMutants,
        killed: data.killed,
        survived: data.survived,
      },
      survivors: data.survivors,
    };

    fs.writeFileSync(
      path.join(reportDir, 'mutation-report.json'),
      JSON.stringify(report, null, 2)
    );
  }
}

module.exports = MutationModule;
