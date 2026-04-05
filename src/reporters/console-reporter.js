/**
 * Console Reporter - Rich terminal output for GateTest results.
 */

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

class ConsoleReporter {
  constructor(runner) {
    this.runner = runner;
    this._attach();
  }

  _attach() {
    this.runner.on('suite:start', (data) => this._onSuiteStart(data));
    this.runner.on('module:start', (result) => this._onModuleStart(result));
    this.runner.on('module:end', (result) => this._onModuleEnd(result));
    this.runner.on('module:skip', (result) => this._onModuleSkip(result));
    this.runner.on('suite:end', (summary) => this._onSuiteEnd(summary));
  }

  _onSuiteStart(data) {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}  GATETEST - Quality Assurance Gate${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log(`${COLORS.dim}  Modules: ${data.modules.join(', ')}${COLORS.reset}`);
    console.log('');
  }

  _onModuleStart(result) {
    process.stdout.write(`  ${COLORS.blue}[RUN]${COLORS.reset} ${result.module} `);
  }

  _onModuleEnd(result) {
    if (result.status === 'passed') {
      const checkCount = result.checks.length;
      console.log(
        `${COLORS.green}[PASS]${COLORS.reset} ` +
        `${COLORS.dim}(${checkCount} checks, ${result.duration}ms)${COLORS.reset}`
      );
    } else {
      console.log(
        `${COLORS.red}[FAIL]${COLORS.reset} ` +
        `${COLORS.dim}(${result.duration}ms)${COLORS.reset}`
      );
      for (const check of result.failedChecks) {
        console.log(`    ${COLORS.red}x ${check.name}${COLORS.reset}`);
        if (check.expected !== undefined) {
          console.log(`      ${COLORS.dim}expected: ${check.expected}, got: ${check.actual}${COLORS.reset}`);
        }
        if (check.file) {
          console.log(`      ${COLORS.dim}file: ${check.file}:${check.line || ''}${COLORS.reset}`);
        }
        if (check.suggestion) {
          console.log(`      ${COLORS.yellow}fix: ${check.suggestion}${COLORS.reset}`);
        }
      }
    }
  }

  _onModuleSkip(result) {
    console.log(`  ${COLORS.yellow}[SKIP]${COLORS.reset} ${result.module} — ${result.error}`);
  }

  _onSuiteEnd(summary) {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}----------------------------------------${COLORS.reset}`);

    if (summary.gateStatus === 'PASSED') {
      console.log(`${COLORS.bold}${COLORS.bgGreen}${COLORS.white}  GATE: PASSED  ${COLORS.reset}`);
    } else {
      console.log(`${COLORS.bold}${COLORS.bgRed}${COLORS.white}  GATE: BLOCKED  ${COLORS.reset}`);
    }

    console.log('');
    console.log(`  Modules: ${summary.modules.passed}/${summary.modules.total} passed`);
    console.log(`  Checks:  ${summary.checks.passed}/${summary.checks.total} passed`);
    console.log(`  Time:    ${summary.duration}ms`);

    if (summary.failedModules.length > 0) {
      console.log('');
      console.log(`${COLORS.red}  Failed modules:${COLORS.reset}`);
      for (const fm of summary.failedModules) {
        console.log(`    ${COLORS.red}- ${fm.module}: ${fm.error}${COLORS.reset}`);
      }
    }

    console.log('');
    console.log(`${COLORS.dim}  Report generated at ${summary.timestamp}${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log('');
  }
}

module.exports = { ConsoleReporter };
