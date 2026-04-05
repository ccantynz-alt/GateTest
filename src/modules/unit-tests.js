/**
 * Unit Tests Module - Validates that the project's test suite passes.
 * Detects test framework and runs the appropriate test command.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class UnitTestsModule extends BaseModule {
  constructor() {
    super('unitTests', 'Unit Test Execution');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Detect test framework and run tests
    const testCommand = this._detectTestCommand(projectRoot);

    if (!testCommand) {
      result.addCheck('unit-tests:detect', false, {
        message: 'No test framework detected',
        suggestion: 'Add a test script to package.json or install a test framework (jest, vitest, mocha)',
      });
      return;
    }

    result.addCheck('unit-tests:framework', true, { message: `Detected: ${testCommand.name}` });

    const { exitCode, stdout, stderr } = this._exec(testCommand.command, {
      cwd: projectRoot,
      timeout: 300000, // 5 minutes
    });

    if (exitCode === 0) {
      result.addCheck('unit-tests:run', true, { message: 'All unit tests passed' });
    } else {
      result.addCheck('unit-tests:run', false, {
        message: 'Unit tests failed',
        details: (stdout + stderr).split('\n').slice(-20),
        suggestion: 'Fix failing tests before committing',
      });
    }

    // Check for test coverage
    this._checkCoverage(projectRoot, config, result);
  }

  _detectTestCommand(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          return { name: 'npm test', command: 'npm test 2>&1' };
        }
      } catch { /* invalid package.json */ }
    }

    // Check for common test configs
    const frameworks = [
      { files: ['jest.config.js', 'jest.config.ts', 'jest.config.cjs'], name: 'Jest', command: 'npx jest 2>&1' },
      { files: ['vitest.config.js', 'vitest.config.ts'], name: 'Vitest', command: 'npx vitest run 2>&1' },
      { files: ['.mocharc.yml', '.mocharc.json', '.mocharc.js'], name: 'Mocha', command: 'npx mocha 2>&1' },
      { files: ['pytest.ini', 'pyproject.toml', 'setup.cfg'], name: 'pytest', command: 'python -m pytest 2>&1' },
    ];

    for (const fw of frameworks) {
      if (fw.files.some(f => fs.existsSync(path.join(projectRoot, f)))) {
        return { name: fw.name, command: fw.command };
      }
    }

    // Check for test directories
    const testDirs = ['tests', 'test', '__tests__', 'spec'];
    for (const dir of testDirs) {
      if (fs.existsSync(path.join(projectRoot, dir))) {
        return { name: 'Node.js test runner', command: 'node --test 2>&1' };
      }
    }

    return null;
  }

  _checkCoverage(projectRoot, config, result) {
    const coveragePaths = ['coverage/coverage-summary.json', 'coverage/lcov.info'];
    let coveragePath = null;

    for (const cp of coveragePaths) {
      const full = path.join(projectRoot, cp);
      if (fs.existsSync(full)) {
        coveragePath = full;
        break;
      }
    }

    if (!coveragePath) {
      result.addCheck('unit-tests:coverage', true, {
        message: 'No coverage report found — run tests with --coverage for coverage checks',
      });
      return;
    }

    if (coveragePath.endsWith('.json')) {
      try {
        const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
        const total = coverage.total;
        const threshold = config.getThreshold('unitTestCoverage');

        if (total?.lines?.pct < threshold) {
          result.addCheck('unit-tests:coverage', false, {
            expected: `>= ${threshold}%`,
            actual: `${total.lines.pct}%`,
            message: `Line coverage ${total.lines.pct}% is below threshold ${threshold}%`,
            suggestion: 'Add tests to improve coverage',
          });
        } else {
          result.addCheck('unit-tests:coverage', true, {
            message: `Line coverage: ${total?.lines?.pct || 'N/A'}%`,
          });
        }
      } catch {
        result.addCheck('unit-tests:coverage', true, { message: 'Could not parse coverage report' });
      }
    }
  }
}

module.exports = UnitTestsModule;
