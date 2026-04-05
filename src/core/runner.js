/**
 * GateTest Runner - Orchestrates test module execution.
 * Enforces zero-tolerance: any single failure blocks the entire pipeline.
 */

const { EventEmitter } = require('events');

class TestResult {
  constructor(moduleName) {
    this.module = moduleName;
    this.status = 'pending';  // pending | running | passed | failed | skipped
    this.checks = [];
    this.startTime = null;
    this.endTime = null;
    this.duration = 0;
    this.error = null;
  }

  start() {
    this.status = 'running';
    this.startTime = Date.now();
  }

  addCheck(name, passed, details = {}) {
    this.checks.push({
      name,
      passed,
      timestamp: Date.now(),
      ...details,
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
      checks: this.checks,
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
      ...options,
    };
  }

  register(name, moduleInstance) {
    this.modules.set(name, moduleInstance);
  }

  async run(moduleNames) {
    const startTime = Date.now();
    this.results = [];

    const modulesToRun = moduleNames || Array.from(this.modules.keys());

    this.emit('suite:start', { modules: modulesToRun });

    if (this.options.parallel) {
      await this._runParallel(modulesToRun);
    } else {
      await this._runSequential(modulesToRun);
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
      await mod.run(result, this.config);

      if (result.failedChecks.length > 0) {
        result.fail(
          `${result.failedChecks.length} check(s) failed: ${result.failedChecks.map(c => c.name).join(', ')}`
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

  _buildSummary(startTime, endTime) {
    const passed = this.results.filter(r => r.status === 'passed');
    const failed = this.results.filter(r => r.status === 'failed');
    const skipped = this.results.filter(r => r.status === 'skipped');

    const totalChecks = this.results.reduce((sum, r) => sum + r.checks.length, 0);
    const passedChecks = this.results.reduce((sum, r) => sum + r.passedChecks.length, 0);
    const failedChecks = this.results.reduce((sum, r) => sum + r.failedChecks.length, 0);

    // GATE DECISION: Zero tolerance. Any failure = blocked.
    const gateStatus = failed.length === 0 ? 'PASSED' : 'BLOCKED';

    return {
      gateStatus,
      timestamp: new Date().toISOString(),
      duration: endTime - startTime,
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

module.exports = { GateTestRunner, TestResult };
