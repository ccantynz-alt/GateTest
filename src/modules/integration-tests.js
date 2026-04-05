/**
 * Integration Tests Module - Runs integration test suites.
 * Checks API endpoints, database operations, and service integrations.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class IntegrationTestsModule extends BaseModule {
  constructor() {
    super('integrationTests', 'Integration Test Execution');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Look for integration test files
    const integrationDirs = [
      'tests/integration',
      'test/integration',
      '__tests__/integration',
      'tests/e2e',
      'integration-tests',
    ];

    let testDir = null;
    for (const dir of integrationDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        testDir = fullPath;
        break;
      }
    }

    if (!testDir) {
      // Also check for files with .integration. or .int. in name
      const allTestFiles = this._collectFiles(projectRoot, ['.test.js', '.spec.js', '.test.ts', '.spec.ts']);
      const integrationFiles = allTestFiles.filter(f =>
        f.includes('integration') || f.includes('.int.') || f.includes('.api.')
      );

      if (integrationFiles.length === 0) {
        result.addCheck('integration-tests:detect', true, {
          message: 'No integration tests found — create tests/integration/ directory',
        });
        return;
      }
    }

    // Run integration tests
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const testIntCmd = pkg.scripts?.['test:integration'] || pkg.scripts?.['test:int'];
        if (testIntCmd) {
          const { exitCode, stdout, stderr } = this._exec('npm run test:integration 2>&1', {
            cwd: projectRoot,
            timeout: 300000,
          });

          if (exitCode === 0) {
            result.addCheck('integration-tests:run', true, { message: 'Integration tests passed' });
          } else {
            result.addCheck('integration-tests:run', false, {
              message: 'Integration tests failed',
              details: (stdout + stderr).split('\n').slice(-20),
            });
          }
          return;
        }
      } catch { /* ignore */ }
    }

    result.addCheck('integration-tests:detect', true, {
      message: 'No integration test script found — add "test:integration" to package.json',
    });
  }
}

module.exports = IntegrationTestsModule;
