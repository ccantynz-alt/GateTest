/**
 * E2E Module - End-to-end test execution.
 * Integrates with Playwright, Cypress, or Puppeteer.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class E2eModule extends BaseModule {
  constructor() {
    super('e2e', 'End-to-End Test Execution');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Detect E2E framework
    const framework = this._detectFramework(projectRoot);

    if (!framework) {
      result.addCheck('e2e:detect', true, {
        message: 'No E2E framework detected — install Playwright: npm init playwright@latest',
      });
      return;
    }

    result.addCheck('e2e:framework', true, { message: `Detected: ${framework.name}` });

    const { exitCode, stdout, stderr } = this._exec(framework.command, {
      cwd: projectRoot,
      timeout: 600000, // 10 minutes for E2E
    });

    if (exitCode === 0) {
      result.addCheck('e2e:run', true, { message: `${framework.name} E2E tests passed` });
    } else {
      result.addCheck('e2e:run', false, {
        message: `${framework.name} E2E tests failed`,
        details: (stdout + stderr).split('\n').slice(-30),
        suggestion: 'Fix failing E2E tests — check screenshots/traces for details',
      });
    }
  }

  _detectFramework(projectRoot) {
    const frameworks = [
      {
        name: 'Playwright',
        configs: ['playwright.config.ts', 'playwright.config.js'],
        command: 'npx playwright test 2>&1',
      },
      {
        name: 'Cypress',
        configs: ['cypress.config.ts', 'cypress.config.js', 'cypress.json'],
        command: 'npx cypress run 2>&1',
      },
      {
        name: 'Puppeteer',
        configs: ['.puppeteerrc.cjs', '.puppeteerrc.js'],
        command: 'npx jest --config jest.puppeteer.config.js 2>&1',
      },
    ];

    for (const fw of frameworks) {
      if (fw.configs.some(c => fs.existsSync(path.join(projectRoot, c)))) {
        return fw;
      }
    }

    // Check package.json for E2E scripts
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.['test:e2e'] || pkg.scripts?.e2e) {
          return {
            name: 'Custom E2E',
            command: pkg.scripts['test:e2e'] ? 'npm run test:e2e 2>&1' : 'npm run e2e 2>&1',
          };
        }
      } catch { /* ignore */ }
    }

    return null;
  }
}

module.exports = E2eModule;
