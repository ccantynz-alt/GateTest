/**
 * Lint Module - Runs linters across the project.
 * Integrates with ESLint, Stylelint, and Markdownlint.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class LintModule extends BaseModule {
  constructor() {
    super('lint', 'Linting Checks');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Check if ESLint is available
    const eslintConfigExists = this._hasConfig(projectRoot, [
      '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
      '.eslintrc.yaml', '.eslintrc.cjs',
    ]) || this._hasPackageJsonField(projectRoot, 'eslintConfig');

    if (eslintConfigExists) {
      this._runEslint(projectRoot, result);
    } else {
      result.addCheck('lint:eslint-config', false, {
        message: 'No ESLint configuration found',
        suggestion: 'Initialize ESLint: npx eslint --init',
      });
    }

    // Check if Stylelint is available
    const cssFiles = this._collectFiles(projectRoot, ['.css', '.scss', '.less']);
    if (cssFiles.length > 0) {
      const stylelintConfigExists = this._hasConfig(projectRoot, [
        '.stylelintrc', '.stylelintrc.js', '.stylelintrc.json', '.stylelintrc.yml',
      ]);
      if (stylelintConfigExists) {
        this._runStylelint(projectRoot, result);
      } else {
        result.addCheck('lint:stylelint-config', false, {
          message: 'CSS files found but no Stylelint configuration',
          suggestion: 'Install and configure Stylelint for CSS quality',
        });
      }
    }

    // Check Markdown files
    const mdFiles = this._collectFiles(projectRoot, ['.md']);
    if (mdFiles.length > 0) {
      for (const file of mdFiles) {
        this._lintMarkdown(file, projectRoot, result);
      }
    }
  }

  _hasConfig(projectRoot, filenames) {
    return filenames.some(f => fs.existsSync(path.join(projectRoot, f)));
  }

  _hasPackageJsonField(projectRoot, field) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return !!pkg[field];
    } catch {
      return false;
    }
  }

  _runEslint(projectRoot, result) {
    const { exitCode, stdout, stderr } = this._exec(
      'npx eslint . --format json --max-warnings 0 2>/dev/null',
      { cwd: projectRoot, timeout: 120000 }
    );

    if (exitCode === 0) {
      result.addCheck('lint:eslint', true, { message: 'ESLint passed with zero warnings' });
    } else {
      let errorCount = 0;
      let warningCount = 0;
      try {
        const results = JSON.parse(stdout);
        for (const fileResult of results) {
          errorCount += fileResult.errorCount;
          warningCount += fileResult.warningCount;
        }
      } catch {
        errorCount = -1; // Unknown
      }

      result.addCheck('lint:eslint', false, {
        message: `ESLint: ${errorCount} error(s), ${warningCount} warning(s)`,
        suggestion: 'Run "npx eslint . --fix" to auto-fix, then manually resolve remaining issues',
        autoFix: () => {
          const fix = this._exec('npx eslint . --fix 2>/dev/null', { cwd: projectRoot, timeout: 120000 });
          return {
            fixed: fix.exitCode === 0,
            description: fix.exitCode === 0
              ? 'ESLint auto-fixed all issues'
              : 'ESLint --fix applied partial fixes (some issues remain)',
            filesChanged: [],
          };
        },
      });
    }
  }

  _runStylelint(projectRoot, result) {
    const { exitCode } = this._exec(
      'npx stylelint "**/*.{css,scss,less}" --formatter json 2>/dev/null',
      { cwd: projectRoot, timeout: 60000 }
    );

    if (exitCode === 0) {
      result.addCheck('lint:stylelint', true);
    } else {
      result.addCheck('lint:stylelint', false, {
        message: 'Stylelint found issues',
        suggestion: 'Run "npx stylelint --fix" to auto-fix',
        autoFix: () => {
          const fix = this._exec('npx stylelint "**/*.{css,scss,less}" --fix 2>/dev/null', { cwd: projectRoot, timeout: 60000 });
          return {
            fixed: fix.exitCode === 0,
            description: 'Stylelint auto-fixed CSS issues',
            filesChanged: [],
          };
        },
      });
    }
  }

  _lintMarkdown(file, projectRoot, result) {
    const relPath = path.relative(projectRoot, file);
    const content = fs.readFileSync(file, 'utf-8');
    const issues = [];

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Check for trailing whitespace
      if (lines[i] !== lines[i].trimEnd() && !lines[i].endsWith('  ')) {
        issues.push({ line: i + 1, message: 'Trailing whitespace' });
      }
      // Check for multiple consecutive blank lines
      if (i > 0 && lines[i].trim() === '' && lines[i - 1].trim() === '' &&
          i > 1 && lines[i - 2].trim() === '') {
        issues.push({ line: i + 1, message: 'Multiple consecutive blank lines' });
      }
    }

    if (issues.length > 0) {
      result.addCheck(`lint:markdown:${relPath}`, false, {
        file: relPath,
        message: `${issues.length} markdown issue(s)`,
        details: issues.slice(0, 5),
        autoFix: () => {
          try {
            const raw = fs.readFileSync(file, 'utf-8');
            let fixed = raw.split('\n').map(l => l.trimEnd()).join('\n');
            // Remove triple+ blank lines
            fixed = fixed.replace(/\n{3,}/g, '\n\n');
            fs.writeFileSync(file, fixed, 'utf-8');
            return { fixed: true, description: `Fixed markdown whitespace in ${relPath}`, filesChanged: [relPath] };
          } catch { return { fixed: false }; }
        },
      });
    } else {
      result.addCheck(`lint:markdown:${relPath}`, true);
    }
  }
}

module.exports = LintModule;
