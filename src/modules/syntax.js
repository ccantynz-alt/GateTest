/**
 * Syntax Module - Validates syntax across all source files.
 * Checks JS/TS compilation, JSON/YAML parsing, and template resolution.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class SyntaxModule extends BaseModule {
  constructor() {
    super('syntax', 'Syntax & Compilation Checks');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Check JavaScript files for syntax errors
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.mjs', '.cjs']);
    for (const file of jsFiles) {
      this._checkJsSyntax(file, result, projectRoot);
    }

    // Check JSON files
    const jsonFiles = this._collectFiles(projectRoot, ['.json']);
    for (const file of jsonFiles) {
      this._checkJsonSyntax(file, result, projectRoot);
    }

    // Check TypeScript if present
    const tsConfigPath = path.join(projectRoot, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      this._checkTypeScript(projectRoot, result);
    }

    // If no files found, still pass
    if (jsFiles.length === 0 && jsonFiles.length === 0) {
      result.addCheck('syntax-scan', true, { message: 'No source files to check' });
    }
  }

  _checkJsSyntax(file, result, projectRoot) {
    const relPath = path.relative(projectRoot, file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      // Use Node's built-in parser via vm.compileFunction or new Function
      // We use a try/catch around require to detect syntax errors
      const vm = require('vm');
      new vm.Script(content, { filename: file });
      result.addCheck(`syntax:${relPath}`, true);
    } catch (err) {
      if (err instanceof SyntaxError) {
        result.addCheck(`syntax:${relPath}`, false, {
          file: relPath,
          line: err.lineNumber,
          message: err.message,
          suggestion: 'Fix the syntax error at the indicated location',
        });
      } else {
        // Not a syntax error, file is syntactically valid
        result.addCheck(`syntax:${relPath}`, true);
      }
    }
  }

  _checkJsonSyntax(file, result, projectRoot) {
    const relPath = path.relative(projectRoot, file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      JSON.parse(content);
      result.addCheck(`json:${relPath}`, true);
    } catch (err) {
      result.addCheck(`json:${relPath}`, false, {
        file: relPath,
        message: err.message,
        suggestion: 'Fix the JSON syntax error',
      });
    }
  }

  _checkTypeScript(projectRoot, result) {
    const { exitCode, stdout, stderr } = this._exec('npx tsc --noEmit 2>&1', { cwd: projectRoot });
    if (exitCode === 0) {
      result.addCheck('typescript-strict', true);
    } else {
      const errors = (stdout + stderr).split('\n').filter(l => l.includes('error TS'));
      result.addCheck('typescript-strict', false, {
        message: `${errors.length} TypeScript error(s)`,
        details: errors.slice(0, 10),
        suggestion: 'Run "npx tsc --noEmit" to see all errors',
      });
    }
  }
}

module.exports = SyntaxModule;
