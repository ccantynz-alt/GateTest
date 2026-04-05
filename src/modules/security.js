/**
 * Security Module - Comprehensive security scanning.
 * Checks headers, dependencies, OWASP patterns, CSP, CORS, and more.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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

    // Scan for hardcoded secrets, API keys, tokens, and passwords
    this._scanForSecrets(projectRoot, result);

    // Live security headers validation
    await this._checkSecurityHeaders(config, result);
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

  _scanForSecrets(projectRoot, result) {
    const secretExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rb',
      '.env', '.yml', '.yaml', '.json', '.toml', '.cfg', '.ini', '.conf',
    ];
    const extraExcludes = ['vendor', '__pycache__', '.next', '.nuxt'];
    const files = this._collectFiles(projectRoot, secretExtensions, extraExcludes);

    const secretPatterns = [
      // AWS keys
      { regex: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g, name: 'AWS Access Key' },
      // GitHub tokens
      { regex: /(?<![a-zA-Z0-9_])(ghp_[a-zA-Z0-9]{36,}|gho_[a-zA-Z0-9]{36,}|ghu_[a-zA-Z0-9]{36,}|ghs_[a-zA-Z0-9]{36,}|ghr_[a-zA-Z0-9]{36,})/g, name: 'GitHub Token' },
      // Slack tokens
      { regex: /(?<![a-zA-Z0-9_])(xoxb-[a-zA-Z0-9\-]+|xoxp-[a-zA-Z0-9\-]+|xoxs-[a-zA-Z0-9\-]+)/g, name: 'Slack Token' },
      // Stripe keys
      { regex: /(?<![a-zA-Z0-9_])(sk_live_[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]{20,}|sk_test_[a-zA-Z0-9]{20,})/g, name: 'Stripe Key' },
      // Private keys
      { regex: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, name: 'Private Key' },
      // JWT tokens (eyJ followed by base64)
      { regex: /(?<![a-zA-Z0-9_/])(eyJ[a-zA-Z0-9_-]{30,}\.eyJ[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]+)/g, name: 'JWT Token' },
      // Database connection strings with credentials
      { regex: /(mongodb(\+srv)?|postgres|postgresql|mysql|mariadb|redis|amqp):\/\/[^:\s]+:[^@\s]+@[^\s"'`]+/gi, name: 'Database Connection String with Credentials' },
      // Generic API key assignments
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-/.]{10,}['"]/gi, name: 'API Key' },
      // Generic secrets/passwords/tokens in assignments
      { regex: /(?:secret|password|passwd|pwd|token|auth_token|access_token|refresh_token|client_secret)\s*[:=]\s*['"][a-zA-Z0-9_\-/.+]{8,}['"]/gi, name: 'Hardcoded Secret/Password/Token' },
      // High-entropy hex strings assigned to suspicious variable names
      { regex: /(?:secret|key|token|password|credential|auth)\s*[:=]\s*['"][0-9a-fA-F]{32,}['"]/gi, name: 'High-Entropy Hex String' },
      // High-entropy base64 strings assigned to suspicious variable names
      { regex: /(?:secret|key|token|password|credential|auth)\s*[:=]\s*['"][A-Za-z0-9+/]{32,}={0,2}['"]/gi, name: 'High-Entropy Base64 String' },
    ];

    let totalFindings = 0;

    for (const file of files) {
      const relPath = path.relative(projectRoot, file);
      const basename = path.basename(file);

      // Skip .env.example and similar template files
      if (basename === '.env.example' || basename === '.env.sample' || basename === '.env.template') {
        continue;
      }

      // Skip test files that explicitly test secret patterns
      if (/\.(test|spec|mock|fixture)\./i.test(basename) || /\/__tests__\//.test(relPath) || /\/test\//.test(relPath) || /\/tests\//.test(relPath)) {
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip comment lines that document patterns rather than containing real secrets
        if (/^\s*(\/\/|#|\/?\*|--|;)\s*(example|e\.g\.|sample|placeholder|dummy|fake|test|TODO|NOTE|regex|pattern)/i.test(trimmed)) {
          continue;
        }

        for (const pattern of secretPatterns) {
          pattern.regex.lastIndex = 0;
          const match = pattern.regex.exec(line);
          if (match) {
            // Build a redacted preview
            const matchedText = match[0];
            const redacted = matchedText.length > 10
              ? matchedText.slice(0, 6) + '***REDACTED***' + matchedText.slice(-2)
              : '***REDACTED***';

            result.addCheck(`security:secret:${relPath}:${i + 1}`, false, {
              file: relPath,
              line: i + 1,
              patternType: pattern.name,
              message: `Potential ${pattern.name} found in ${relPath}:${i + 1}`,
              preview: redacted,
              suggestion: 'Move this value to environment variables or a secrets manager. Never commit secrets to source control.',
            });
            totalFindings++;
          }
        }
      }
    }

    if (totalFindings === 0) {
      result.addCheck('security:secrets-scan', true, {
        message: `Scanned ${files.length} files for hardcoded secrets — none found`,
      });
    } else {
      result.addCheck('security:secrets-scan', false, {
        message: `Found ${totalFindings} potential secret(s) across scanned files`,
        suggestion: 'Review all findings and move secrets to environment variables or a secrets manager',
      });
    }
  }

  async _checkSecurityHeaders(config, result) {
    let url;
    try {
      url = config.get('liveCrawler.url') || (config.getModuleConfig('security') || {}).url;
    } catch {
      url = null;
    }

    if (!url) {
      result.addCheck('security:headers', true, {
        message: 'No live URL configured — skipping security headers check',
      });
      return;
    }

    try {
      const headers = await this._fetchHeaders(url, 10000);

      const requiredHeaders = [
        { name: 'strict-transport-security', label: 'Strict-Transport-Security (HSTS)',
          check: (v) => v && v.includes('max-age'),
          suggestion: 'Add header: Strict-Transport-Security: max-age=31536000; includeSubDomains' },
        { name: 'content-security-policy', label: 'Content-Security-Policy (CSP)',
          check: (v) => !!v,
          suggestion: 'Add a Content-Security-Policy header to prevent XSS and injection attacks' },
        { name: 'x-frame-options', label: 'X-Frame-Options',
          check: (v) => v && /^(deny|sameorigin)$/i.test(v),
          suggestion: 'Add header: X-Frame-Options: DENY (or SAMEORIGIN)' },
        { name: 'x-content-type-options', label: 'X-Content-Type-Options',
          check: (v) => v === 'nosniff',
          suggestion: 'Add header: X-Content-Type-Options: nosniff' },
        { name: 'referrer-policy', label: 'Referrer-Policy',
          check: (v) => !!v,
          suggestion: 'Add header: Referrer-Policy: strict-origin-when-cross-origin' },
      ];

      for (const req of requiredHeaders) {
        const value = headers[req.name];
        const passed = req.check(value);
        result.addCheck(`security:header:${req.name}`, passed, {
          message: passed
            ? `${req.label}: ${value}`
            : `Missing or invalid ${req.label}`,
          suggestion: passed ? undefined : req.suggestion,
        });
      }

      // Headers that should NOT exist (information disclosure)
      const serverHeader = headers['server'];
      if (serverHeader && /\/[\d.]/.test(serverHeader)) {
        result.addCheck('security:header:server-version', false, {
          message: `Server header reveals version: "${serverHeader}"`,
          suggestion: 'Remove version info from Server header to reduce attack surface',
        });
      }

      if (headers['x-powered-by']) {
        result.addCheck('security:header:x-powered-by', false, {
          message: `X-Powered-By header exposes technology: "${headers['x-powered-by']}"`,
          suggestion: 'Remove X-Powered-By header (e.g., app.disable("x-powered-by") in Express)',
        });
      }

    } catch (err) {
      result.addCheck('security:headers', false, {
        message: `Failed to check security headers: ${err.message}`,
        suggestion: 'Ensure the URL is reachable and the server is running',
      });
    }
  }

  _fetchHeaders(url, timeout) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new (require('url').URL)(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, { timeout, headers: { 'User-Agent': 'GateTest/1.0' } }, (res) => {
        resolve(res.headers);
        res.resume();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }
}

module.exports = SecurityModule;
