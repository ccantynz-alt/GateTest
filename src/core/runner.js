/**
 * GateTest Runner - Orchestrates test module execution.
 * Enforces zero-tolerance: any single error blocks the entire pipeline.
 * Supports severity levels: error (blocks), warning (reports), info (informational).
 */

const { EventEmitter } = require('events');

/** Severity levels — only 'error' blocks the gate. */
const Severity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

class TestResult {
  constructor(moduleName) {
    this.module = moduleName;
    this.status = 'pending';  // pending | running | passed | failed | skipped
    this.checks = [];
    this.fixes = [];          // auto-fix records
    this.startTime = null;
    this.endTime = null;
    this.duration = 0;
    this.error = null;
  }

  start() {
    this.status = 'running';
    this.startTime = Date.now();
  }

  /**
   * Add a check result.
   * @param {string} name - Check identifier
   * @param {boolean} passed - Whether the check passed
   * @param {object} details - Additional details
   * @param {string} [details.severity='error'] - Severity: 'error', 'warning', or 'info'
   * @param {string} [details.fix] - Human-readable fix suggestion
   * @param {Function} [details.autoFix] - Function that auto-fixes the issue. Returns { fixed: boolean, description: string }
   */
  addCheck(name, passed, details = {}) {
    const severity = details.severity || (passed ? Severity.INFO : Severity.ERROR);
    this.checks.push({
      name,
      passed,
      severity,
      timestamp: Date.now(),
      ...details,
    });
  }

  /**
   * Record an applied auto-fix.
   */
  addFix(checkName, description, filesChanged = []) {
    this.fixes.push({
      check: checkName,
      description,
      filesChanged,
      timestamp: Date.now(),
    });
  }

  pass() {
    this.status = 'passed';
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
  }

  fail(error) {
    this.status = 'failed';
    this.error = error;
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
  }

  skip(reason) {
    this.status = 'skipped';
    this.error = reason;
  }

  /** Checks that failed with severity 'error' — these block the gate. */
  get errorChecks() {
    return this.checks.filter(c => !c.passed && c.severity === Severity.ERROR);
  }

  /** Checks that failed with severity 'warning' — reported but don't block. */
  get warningChecks() {
    return this.checks.filter(c => !c.passed && c.severity === Severity.WARNING);
  }

  /** Informational checks. */
  get infoChecks() {
    return this.checks.filter(c => c.severity === Severity.INFO);
  }

  get failedChecks() {
    return this.checks.filter(c => !c.passed);
  }

  get passedChecks() {
    return this.checks.filter(c => c.passed);
  }

  toJSON() {
    return {
      module: this.module,
      status: this.status,
      duration: this.duration,
      totalChecks: this.checks.length,
      passedChecks: this.passedChecks.length,
      failedChecks: this.failedChecks.length,
      errors: this.errorChecks.length,
      warnings: this.warningChecks.length,
      fixes: this.fixes.length,
      checks: this.checks,
      appliedFixes: this.fixes,
      error: this.error ? String(this.error) : null,
    };
  }
}

class GateTestRunner extends EventEmitter {
  constructor(config, options = {}) {
    super();
    this.config = config;
    this.modules = new Map();
    this.results = [];
    this.options = {
      stopOnFirstFailure: false,
      parallel: false,
      autoFix: false,           // --fix: automatically apply safe fixes
      diffOnly: false,          // --diff: only scan git-changed files
      changedFiles: null,       // list of changed files (populated by diff mode)
      ...options,
    };
  }

  register(name, moduleInstance) {
    this.modules.set(name, moduleInstance);
  }

  async run(moduleNames) {
    const startTime = Date.now();
    this.results = [];

    // If diff mode, resolve changed files before running modules
    if (this.options.diffOnly && !this.options.changedFiles) {
      this.options.changedFiles = this._getChangedFiles();
    }

    const modulesToRun = moduleNames || Array.from(this.modules.keys());

    this.emit('suite:start', { modules: modulesToRun, diffOnly: this.options.diffOnly });

    if (this.options.parallel) {
      await this._runParallel(modulesToRun);
    } else {
      await this._runSequential(modulesToRun);
    }

    // Auto-fix pass: if enabled, run fixable checks
    if (this.options.autoFix) {
      await this._runAutoFixes();
    }

    const endTime = Date.now();
    const summary = this._buildSummary(startTime, endTime);

    this.emit('suite:end', summary);

    return summary;
  }

  async _runSequential(moduleNames) {
    for (const name of moduleNames) {
      const result = await this._runModule(name);
      this.results.push(result);

      if (result.status === 'failed' && this.options.stopOnFirstFailure) {
        break;
      }
    }
  }

  async _runParallel(moduleNames) {
    const promises = moduleNames.map(name => this._runModule(name));
    this.results = await Promise.all(promises);
  }

  async _runModule(name) {
    const mod = this.modules.get(name);
    const result = new TestResult(name);

    if (!mod) {
      result.skip(`Module "${name}" not registered`);
      this.emit('module:skip', result);
      return result;
    }

    result.start();
    this.emit('module:start', result);

    try {
      // Pass diff-mode context to module
      const moduleConfig = Object.create(this.config);
      moduleConfig._runnerOptions = this.options;
      await mod.run(result, moduleConfig);

      // Only errors block — warnings are allowed through
      if (result.errorChecks.length > 0) {
        result.fail(
          `${result.errorChecks.length} error(s): ${result.errorChecks.map(c => c.name).join(', ')}`
        );
      } else {
        result.pass();
      }
    } catch (err) {
      result.fail(err);
    }

    this.emit('module:end', result);
    return result;
  }

  /**
   * Run auto-fixes for all fixable failed checks.
   */
  async _runAutoFixes() {
    let totalFixed = 0;
    for (const result of this.results) {
      for (const check of result.failedChecks) {
        if (typeof check.autoFix === 'function') {
          try {
            const fixResult = await check.autoFix();
            if (fixResult && fixResult.fixed) {
              check.passed = true;
              check.autoFixed = true;
              result.addFix(check.name, fixResult.description, fixResult.filesChanged || []);
              totalFixed++;
            }
          } catch {
            // Fix failed — leave check as failed
          }
        }
      }

      // Re-evaluate module status after fixes
      if (result.status === 'failed' && result.errorChecks.length === 0) {
        result.status = 'passed';
        result.error = null;
      }
    }

    if (totalFixed > 0) {
      this.emit('autofix:complete', { totalFixed });
    }
  }

  /**
   * Get list of files changed relative to the merge-base with the default branch.
   */
  _getChangedFiles() {
    const { execSync } = require('child_process');
    try {
      // Get files changed vs merge-base with main/master
      const baseBranch = (() => {
        try {
          execSync('git rev-parse --verify main', { stdio: 'pipe' });
          return 'main';
        } catch {
          try {
            execSync('git rev-parse --verify master', { stdio: 'pipe' });
            return 'master';
          } catch {
            return 'HEAD~1';
          }
        }
      })();

      const mergeBase = execSync(`git merge-base HEAD ${baseBranch}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const diff = execSync(`git diff --name-only ${mergeBase}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // Also include staged and unstaged changes
      const staged = execSync('git diff --cached --name-only', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const unstaged = execSync('git diff --name-only', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const allChanged = new Set([
        ...diff.split('\n').filter(Boolean),
        ...staged.split('\n').filter(Boolean),
        ...unstaged.split('\n').filter(Boolean),
      ]);

      return Array.from(allChanged);
    } catch {
      return null; // Fall back to full scan
    }
  }

  _buildSummary(startTime, endTime) {
    const passed = this.results.filter(r => r.status === 'passed');
    const failed = this.results.filter(r => r.status === 'failed');
    const skipped = this.results.filter(r => r.status === 'skipped');

    const totalChecks = this.results.reduce((sum, r) => sum + r.checks.length, 0);
    const passedChecks = this.results.reduce((sum, r) => sum + r.passedChecks.length, 0);
    const failedChecks = this.results.reduce((sum, r) => sum + r.failedChecks.length, 0);
    const totalErrors = this.results.reduce((sum, r) => sum + r.errorChecks.length, 0);
    const totalWarnings = this.results.reduce((sum, r) => sum + r.warningChecks.length, 0);
    const totalFixes = this.results.reduce((sum, r) => sum + r.fixes.length, 0);

    // GATE DECISION: Failed modules or error-severity checks block the gate.
    const gateStatus = (failed.length === 0 && totalErrors === 0) ? 'PASSED' : 'BLOCKED';

    return {
      gateStatus,
      timestamp: new Date().toISOString(),
      duration: endTime - startTime,
      diffOnly: this.options.diffOnly,
      changedFiles: this.options.changedFiles,
      modules: {
        total: this.results.length,
        passed: passed.length,
        failed: failed.length,
        skipped: skipped.length,
      },
      checks: {
        total: totalChecks,
        passed: passedChecks,
        failed: failedChecks,
        errors: totalErrors,
        warnings: totalWarnings,
      },
      fixes: {
        total: totalFixes,
        details: this.results.flatMap(r => r.fixes),
      },
      results: this.results.map(r => r.toJSON()),
      failedModules: failed.map(r => ({
        module: r.module,
        error: String(r.error),
        failedChecks: r.failedChecks,
      })),
    };
  }
}

module.exports = { GateTestRunner, TestResult, Severity };
