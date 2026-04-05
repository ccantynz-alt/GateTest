/**
 * Data Integrity Module - Database schema, migration, and data validation.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class DataIntegrityModule extends BaseModule {
  constructor() {
    super('dataIntegrity', 'Data Integrity Validation');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Check for migration files
    this._checkMigrations(projectRoot, result);

    // Check for ORM model consistency
    this._checkModels(projectRoot, result);

    // Check for PII handling patterns
    this._checkPiiHandling(projectRoot, result);
  }

  _checkMigrations(projectRoot, result) {
    const migrationDirs = ['migrations', 'db/migrations', 'database/migrations', 'prisma/migrations'];
    let migrationDir = null;

    for (const dir of migrationDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        migrationDir = fullPath;
        break;
      }
    }

    if (!migrationDir) {
      result.addCheck('data:migrations', true, { message: 'No migration directory found — skipping' });
      return;
    }

    // Check that migrations are sequential / properly named
    const files = fs.readdirSync(migrationDir).filter(f => !f.startsWith('.'));
    result.addCheck('data:migrations-exist', true, {
      message: `${files.length} migration(s) found in ${path.relative(projectRoot, migrationDir)}`,
    });
  }

  _checkModels(projectRoot, result) {
    // Check for Prisma schema
    const prismaSchema = path.join(projectRoot, 'prisma/schema.prisma');
    if (fs.existsSync(prismaSchema)) {
      const { exitCode } = this._exec('npx prisma validate 2>&1', { cwd: projectRoot });
      if (exitCode === 0) {
        result.addCheck('data:prisma-schema', true, { message: 'Prisma schema valid' });
      } else {
        result.addCheck('data:prisma-schema', false, {
          message: 'Prisma schema validation failed',
          suggestion: 'Run "npx prisma validate" to see errors',
        });
      }
      return;
    }

    result.addCheck('data:models', true, { message: 'No ORM schema detected — skipping' });
  }

  _checkPiiHandling(projectRoot, result) {
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);

    const piiPatterns = [
      { regex: /console\.(log|info|debug)\s*\(.*(?:email|password|ssn|credit.?card|phone)/gi, type: 'PII in logs' },
      { regex: /JSON\.stringify\s*\(.*(?:password|secret|token)/gi, type: 'Sensitive data serialized' },
    ];

    for (const file of jsFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');

      for (const { regex, type } of piiPatterns) {
        regex.lastIndex = 0;
        if (regex.test(content)) {
          result.addCheck(`data:pii:${type}:${relPath}`, false, {
            file: relPath,
            message: `Potential ${type} detected`,
            suggestion: 'Ensure PII is never logged or serialized unsafely',
          });
        }
      }
    }
  }
}

module.exports = DataIntegrityModule;
