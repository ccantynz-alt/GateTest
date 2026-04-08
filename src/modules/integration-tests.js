/**
 * Integration Tests Module - Validates integration test infrastructure and execution.
 * Detects API endpoints, database operations, and external service integrations,
 * then verifies they have corresponding integration tests.
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

    // Detect integration test files
    const testInfo = this._findIntegrationTests(projectRoot);

    // Detect what NEEDS integration tests
    const endpoints = this._detectApiEndpoints(projectRoot);
    const dbOps = this._detectDatabaseOperations(projectRoot);
    const externalServices = this._detectExternalServices(projectRoot);

    // Report what was detected
    if (endpoints.length > 0) {
      result.addCheck('integration:endpoints-detected', true, {
        severity: 'info',
        message: `${endpoints.length} API endpoint(s) detected`,
      });
    }

    if (dbOps.length > 0) {
      result.addCheck('integration:db-ops-detected', true, {
        severity: 'info',
        message: `${dbOps.length} database operation pattern(s) detected`,
      });
    }

    if (externalServices.length > 0) {
      result.addCheck('integration:services-detected', true, {
        severity: 'info',
        message: `External services: ${externalServices.join(', ')}`,
      });
    }

    // If no integration points found, skip
    if (endpoints.length === 0 && dbOps.length === 0 && externalServices.length === 0) {
      result.addCheck('integration-tests:not-needed', true, {
        severity: 'info',
        message: 'No API endpoints, database ops, or external services detected — skipping',
      });
      return;
    }

    // Run integration tests if available
    if (testInfo.testDir || testInfo.testFiles.length > 0) {
      result.addCheck('integration-tests:found', true, {
        severity: 'info',
        message: `${testInfo.testFiles.length} integration test file(s) found`,
      });

      const ran = await this._runTests(projectRoot, testInfo, result);
      if (!ran) {
        result.addCheck('integration-tests:run', false, {
          severity: 'warning',
          message: 'Could not execute integration tests — no test:integration script found',
          suggestion: 'Add "test:integration" script to package.json',
        });
      }
    } else {
      // Integration points exist but no tests — this is a real problem
      result.addCheck('integration-tests:missing', false, {
        severity: 'warning',
        message: `${endpoints.length + dbOps.length} integration points found but no integration tests`,
        suggestion: 'Create tests/integration/ directory with tests for API endpoints and database operations',
      });
    }

    // Coverage gap analysis
    this._analyzeCoverageGaps(endpoints, testInfo.testFiles, projectRoot, result);
  }

  _findIntegrationTests(projectRoot) {
    const integrationDirs = [
      'tests/integration', 'test/integration', '__tests__/integration',
      'integration-tests', 'tests/api', 'test/api',
    ];

    let testDir = null;
    for (const dir of integrationDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        testDir = fullPath;
        break;
      }
    }

    // Also find files with integration/api patterns
    const allTestFiles = this._collectFiles(projectRoot, ['.test.js', '.spec.js', '.test.ts', '.spec.ts']);
    const testFiles = allTestFiles.filter(f => {
      const base = path.basename(f).toLowerCase();
      return base.includes('integration') || base.includes('.int.') ||
             base.includes('.api.') || base.includes('endpoint');
    });

    return { testDir, testFiles };
  }

  async _runTests(projectRoot, testInfo, result) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const testCmd = pkg.scripts?.['test:integration'] || pkg.scripts?.['test:int'] || pkg.scripts?.['test:api'];

      if (testCmd) {
        const scriptName = pkg.scripts['test:integration'] ? 'test:integration' :
                          pkg.scripts['test:int'] ? 'test:int' : 'test:api';
        const { exitCode, stdout, stderr } = this._exec(`npm run ${scriptName} 2>&1`, {
          cwd: projectRoot,
          timeout: 300000,
        });

        if (exitCode === 0) {
          result.addCheck('integration-tests:run', true, { message: 'Integration tests passed' });
        } else {
          result.addCheck('integration-tests:run', false, {
            message: 'Integration tests failed',
            details: (stdout + stderr).split('\n').slice(-20),
            suggestion: 'Fix failing integration tests',
          });
        }
        return true;
      }
    } catch { /* ignore */ }

    return false;
  }

  _detectApiEndpoints(projectRoot) {
    const endpoints = [];
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);

    for (const file of jsFiles) {
      const relPath = path.relative(projectRoot, file);
      if (relPath.includes('test') || relPath.includes('node_modules')) continue;

      const content = fs.readFileSync(file, 'utf-8');

      // Express/Fastify style routes
      const routePatterns = [
        /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g,
        /(?:app|router)\.(use)\s*\(\s*['"]([^'"]+)['"]/g,
      ];

      for (const pattern of routePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          endpoints.push({ method: match[1].toUpperCase(), path: match[2], file: relPath });
        }
      }

      // Next.js API routes
      if (relPath.includes('api/') && (relPath.endsWith('route.ts') || relPath.endsWith('route.js'))) {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        for (const method of methods) {
          if (content.includes(`export async function ${method}`) || content.includes(`export function ${method}`)) {
            endpoints.push({ method, path: relPath, file: relPath });
          }
        }
      }
    }

    return endpoints;
  }

  _detectDatabaseOperations(projectRoot) {
    const ops = [];
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.ts']);

    for (const file of jsFiles) {
      const relPath = path.relative(projectRoot, file);
      if (relPath.includes('test') || relPath.includes('node_modules')) continue;

      const content = fs.readFileSync(file, 'utf-8');

      const dbPatterns = [
        { pattern: /prisma\.\w+\.(findMany|findFirst|create|update|delete|upsert)/g, type: 'Prisma' },
        { pattern: /\.query\s*\(\s*['"`]/g, type: 'SQL query' },
        { pattern: /mongoose\.\w+|\.findById|\.findOne/g, type: 'Mongoose' },
        { pattern: /knex\s*\(\s*['"`]\w+['"`]\s*\)/g, type: 'Knex' },
        { pattern: /sequelize\.define|Model\.findAll/g, type: 'Sequelize' },
      ];

      for (const { pattern, type } of dbPatterns) {
        if (pattern.test(content)) {
          ops.push({ type, file: relPath });
          break; // One per file per type
        }
      }
    }

    return ops;
  }

  _detectExternalServices(projectRoot) {
    const services = new Set();
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);

    const servicePatterns = [
      { pattern: /stripe/i, name: 'Stripe' },
      { pattern: /sendgrid|@sendgrid/i, name: 'SendGrid' },
      { pattern: /twilio/i, name: 'Twilio' },
      { pattern: /aws-sdk|@aws-sdk/i, name: 'AWS' },
      { pattern: /firebase|@firebase/i, name: 'Firebase' },
      { pattern: /supabase|@supabase/i, name: 'Supabase' },
      { pattern: /redis/i, name: 'Redis' },
      { pattern: /elasticsearch/i, name: 'Elasticsearch' },
      { pattern: /cloudflare/i, name: 'Cloudflare' },
      { pattern: /openai/i, name: 'OpenAI' },
      { pattern: /anthropic/i, name: 'Anthropic' },
    ];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const { pattern, name } of servicePatterns) {
        if (pattern.test(content)) services.add(name);
      }
    }

    return Array.from(services);
  }

  _analyzeCoverageGaps(endpoints, testFiles, projectRoot, result) {
    if (endpoints.length === 0) return;

    const testContent = testFiles.map(f => {
      try { return fs.readFileSync(f, 'utf-8'); } catch { return ''; }
    }).join('\n');

    let untestedEndpoints = 0;
    for (const ep of endpoints) {
      // Check if any test references this endpoint path
      if (!testContent.includes(ep.path)) {
        untestedEndpoints++;
        if (untestedEndpoints <= 5) {
          result.addCheck(`integration:untested:${ep.method}:${ep.path}`, false, {
            file: ep.file,
            severity: 'warning',
            message: `${ep.method} ${ep.path} has no integration test`,
            suggestion: `Add integration test covering ${ep.method} ${ep.path}`,
          });
        }
      }
    }

    if (untestedEndpoints > 5) {
      result.addCheck('integration:untested-count', false, {
        severity: 'warning',
        message: `${untestedEndpoints} endpoints lack integration tests (showing first 5)`,
      });
    }
  }
}

module.exports = IntegrationTestsModule;
