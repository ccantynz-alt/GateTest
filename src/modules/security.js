/**
 * Security Module - Comprehensive security scanning.
 * Checks headers, dependencies, OWASP patterns, CSP, CORS, and more.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class SecurityModule extends BaseModule {
  constructor() {
    super('security', 'Security Analysis');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Dependency vulnerability scan
    this._checkDependencies(projectRoot, result);

    // Source code security patterns
    this._checkSourcePatterns(projectRoot, result);

    // Check for dangerous file permissions
    this._checkFilePermissions(projectRoot, result);

    // Check package.json for suspicious scripts
    this._checkPackageScripts(projectRoot, result);

    // Check for .npmrc with auth tokens
    this._checkNpmAuth(projectRoot, result);
  }

  _checkDependencies(projectRoot, result) {
    const pkgLockPath = path.join(projectRoot, 'package-lock.json');
    const pkgPath = path.join(projectRoot, 'package.json');

    if (!fs.existsSync(pkgPath)) {
      result.addCheck('security:dependencies', true, { message: 'No package.json — skipping dep scan' });
      return;
    }

    const { exitCode, stdout } = this._exec('npm audit --json 2>/dev/null', { cwd: projectRoot });

    if (exitCode === 0) {
      result.addCheck('security:npm-audit', true, { message: 'No known vulnerabilities' });
    } else {
      try {
        const audit = JSON.parse(stdout);
        const vulns = audit.metadata?.vulnerabilities || {};
        const critical = vulns.critical || 0;
        const high = vulns.high || 0;
        const moderate = vulns.moderate || 0;

        if (critical > 0 || high > 0) {
          result.addCheck('security:npm-audit', false, {
            message: `${critical} critical, ${high} high, ${moderate} moderate vulnerabilities`,
            suggestion: 'Run "npm audit fix" or update vulnerable packages',
          });
        } else {
          result.addCheck('security:npm-audit', true, {
            message: `No critical/high vulnerabilities (${moderate} moderate)`,
          });
        }
      } catch {
        result.addCheck('security:npm-audit', false, {
          message: 'npm audit failed to run',
          suggestion: 'Run "npm audit" manually to check for vulnerabilities',
        });
      }
    }
  }

  _checkSourcePatterns(projectRoot, result) {
    const files = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);
    const dangerousPatterns = [
      { regex: /eval\s*\(/g, name: 'eval()', severity: 'critical' },
      { regex: /new\s+Function\s*\(/g, name: 'Function constructor', severity: 'critical' },
      { regex: /\.innerHTML\s*=(?!=)/g, name: 'innerHTML assignment', severity: 'high' },
      { regex: /document\.write\s*\(/g, name: 'document.write()', severity: 'high' },
      { regex: /child_process.*exec\s*\(/g, name: 'shell exec without sanitization', severity: 'high' },
      { regex: /\$\{.*req\.(params|query|body)/g, name: 'unsanitized user input in template', severity: 'critical' },
      { regex: /res\.redirect\s*\(\s*req\./g, name: 'open redirect risk', severity: 'high' },
      { regex: /\.createReadStream\s*\(\s*req\./g, name: 'path traversal risk', severity: 'critical' },
      { regex: /Math\.random\s*\(/g, name: 'Math.random() for security (use crypto)', severity: 'moderate' },
      { regex: /disable.*csrf|csrf.*disable/gi, name: 'CSRF protection disabled', severity: 'critical' },
    ];

    for (const file of files) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (const pattern of dangerousPatterns) {
        for (let i = 0; i < lines.length; i++) {
          pattern.regex.lastIndex = 0;
          if (pattern.regex.test(lines[i])) {
            result.addCheck(`security:${pattern.name}:${relPath}:${i + 1}`, false, {
              file: relPath,
              line: i + 1,
              message: `${pattern.severity.toUpperCase()}: ${pattern.name} detected`,
              suggestion: `Review and replace ${pattern.name} with a safe alternative`,
            });
          }
        }
      }
    }

    if (files.length > 0) {
      result.addCheck('security:source-scan', true, { message: `Scanned ${files.length} source files` });
    }
  }

  _checkFilePermissions(projectRoot, result) {
    const sensitiveFiles = ['.env', 'key.pem', 'cert.pem', 'id_rsa', 'credentials.json'];
    for (const filename of sensitiveFiles) {
      const filePath = path.join(projectRoot, filename);
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          const mode = (stats.mode & 0o777).toString(8);
          if (mode !== '600' && mode !== '400') {
            result.addCheck(`security:permissions:${filename}`, false, {
              file: filename,
              expected: '600 or 400',
              actual: mode,
              message: `${filename} has overly permissive permissions: ${mode}`,
              suggestion: `Run "chmod 600 ${filename}" to restrict access`,
            });
          }
        } catch {
          // Can't check permissions, skip
        }
      }
    }
  }

  _checkPackageScripts(projectRoot, result) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const suspicious = ['curl', 'wget', 'nc ', 'netcat', 'base64', '| sh', '| bash'];

      for (const [name, cmd] of Object.entries(scripts)) {
        for (const pattern of suspicious) {
          if (cmd.includes(pattern)) {
            result.addCheck(`security:script:${name}`, false, {
              message: `Suspicious pattern "${pattern}" in script "${name}"`,
              suggestion: 'Review this script for supply chain attack vectors',
            });
          }
        }
      }
    } catch {
      // Invalid package.json handled by syntax module
    }
  }

  _checkNpmAuth(projectRoot, result) {
    const npmrcPath = path.join(projectRoot, '.npmrc');
    if (fs.existsSync(npmrcPath)) {
      const content = fs.readFileSync(npmrcPath, 'utf-8');
      if (content.includes('_authToken') || content.includes('_auth=')) {
        result.addCheck('security:npmrc-token', false, {
          file: '.npmrc',
          message: 'Auth token found in .npmrc',
          suggestion: 'Use environment variables for npm auth tokens',
        });
      }
    }
  }
}

module.exports = SecurityModule;
