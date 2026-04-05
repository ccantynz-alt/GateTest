/**
 * Continuous Scanner - Background scanning that never sleeps.
 * Monitors dependencies, uptime, security advisories, and performance baselines.
 * Runs independently of builds — always watching, always scanning.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class ContinuousScanner extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.timers = [];
    this.running = false;
    this.results = [];
  }

  start() {
    if (this.running) return;
    this.running = true;

    console.log('[GateTest Scanner] Starting continuous monitoring...');

    // Dependency vulnerability monitoring
    this._schedule('dependency-audit', () => this._scanDependencies(), 86400000); // daily

    // Broken link monitoring
    this._schedule('link-check', () => this._scanLinks(), 86400000); // daily

    // Security header monitoring
    this._schedule('security-headers', () => this._scanSecurityHeaders(), 3600000); // hourly

    // Performance baseline monitoring
    this._schedule('performance-baseline', () => this._scanPerformance(), 3600000); // hourly

    // Technology watch — scan for new tools and methodologies
    this._schedule('tech-watch', () => this._scanTechUpdates(), 86400000); // daily

    // CVE database monitoring
    this._schedule('cve-monitor', () => this._scanCveDatabase(), 43200000); // twice daily

    this.emit('scanner:started');
  }

  stop() {
    for (const timer of this.timers) {
      clearInterval(timer.interval);
    }
    this.timers = [];
    this.running = false;
    this.emit('scanner:stopped');
    console.log('[GateTest Scanner] Stopped.');
  }

  _schedule(name, fn, intervalMs) {
    // Run immediately on start
    this._runScan(name, fn);

    // Then schedule recurring
    const interval = setInterval(() => this._runScan(name, fn), intervalMs);
    this.timers.push({ name, interval });
  }

  async _runScan(name, fn) {
    const startTime = Date.now();
    try {
      const findings = await fn();
      const result = {
        scanner: name,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        status: findings.length === 0 ? 'clean' : 'findings',
        findings,
      };

      this.results.push(result);
      this.emit('scan:complete', result);

      if (findings.length > 0) {
        this.emit('scan:alert', result);
      }
    } catch (err) {
      this.emit('scan:error', { scanner: name, error: err.message });
    }
  }

  async _scanDependencies() {
    const findings = [];
    const projectRoot = this.config.projectRoot;

    // Check npm audit
    const { execSync } = require('child_process');
    try {
      execSync('npm audit --json 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (err) {
      if (err.stdout) {
        try {
          const audit = JSON.parse(err.stdout);
          const vulns = audit.metadata?.vulnerabilities || {};
          if (vulns.critical > 0 || vulns.high > 0) {
            findings.push({
              severity: 'critical',
              message: `${vulns.critical} critical, ${vulns.high} high vulnerabilities in dependencies`,
              action: 'Run "npm audit fix" immediately',
            });
          }
        } catch { /* parse error */ }
      }
    }

    return findings;
  }

  async _scanLinks() {
    const findings = [];
    const projectRoot = this.config.projectRoot;
    const htmlFiles = this._collectHtmlFiles(projectRoot);

    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const hrefRegex = /(?:href|src)\s*=\s*["']([^"'#]+)/gi;
      let match;

      while ((match = hrefRegex.exec(content)) !== null) {
        const link = match[1].trim();

        if (link.startsWith('http://') || link.startsWith('https://')) {
          try {
            const { request } = require('https');
            await new Promise((resolve) => {
              const url = new URL(link);
              const req = request(
                { hostname: url.hostname, path: url.pathname, method: 'HEAD', timeout: 5000 },
                (res) => {
                  if (res.statusCode >= 400) {
                    findings.push({
                      severity: 'warning',
                      message: `Broken external link: ${link} (HTTP ${res.statusCode})`,
                      file: path.relative(projectRoot, file),
                    });
                  }
                  resolve();
                }
              );
              req.on('error', () => resolve());
              req.on('timeout', () => { req.destroy(); resolve(); });
              req.end();
            });
          } catch {
            // Skip links that can't be checked
          }
        } else if (!link.startsWith('mailto:') && !link.startsWith('tel:') &&
                   !link.startsWith('data:') && !link.startsWith('javascript:')) {
          const resolved = path.resolve(path.dirname(file), link);
          if (!fs.existsSync(resolved)) {
            findings.push({
              severity: 'error',
              message: `Broken internal link: ${link}`,
              file: path.relative(projectRoot, file),
            });
          }
        }
      }
    }

    return findings;
  }

  async _scanSecurityHeaders() {
    const findings = [];
    const projectRoot = this.config.projectRoot;

    const requiredHeaders = [
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'strict-transport-security',
    ];

    // Check server config files for header definitions
    const configFiles = [
      'nginx.conf', '.htaccess', 'vercel.json', 'netlify.toml',
      'next.config.js', 'next.config.mjs',
    ];

    let headerConfigFound = false;
    for (const configFile of configFiles) {
      const filePath = path.join(projectRoot, configFile);
      if (fs.existsSync(filePath)) {
        headerConfigFound = true;
        const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();
        for (const header of requiredHeaders) {
          if (!content.includes(header)) {
            findings.push({
              severity: 'warning',
              message: `Security header "${header}" not found in ${configFile}`,
              action: `Add ${header} to your server configuration`,
            });
          }
        }
      }
    }

    // Check HTML files for meta http-equiv headers
    const htmlFiles = this._collectHtmlFiles(projectRoot);
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf-8').toLowerCase();
      if (content.includes('<meta') && content.includes('http-equiv')) {
        headerConfigFound = true;
      }
    }

    if (!headerConfigFound && htmlFiles.length > 0) {
      findings.push({
        severity: 'info',
        message: 'No server configuration found for security headers',
        action: 'Configure security headers in your web server or hosting platform',
      });
    }

    return findings;
  }

  async _scanPerformance() {
    const findings = [];
    const projectRoot = this.config.projectRoot;
    const zlib = require('zlib');

    // Check build output sizes
    const distDirs = ['dist', 'build', 'out', '.next', 'public'];
    for (const dir of distDirs) {
      const distPath = path.join(projectRoot, dir);
      if (!fs.existsSync(distPath)) continue;

      let totalJsSize = 0;
      let totalCssSize = 0;

      const files = this._collectFilesRecursive(distPath);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const content = fs.readFileSync(file);
        const gzipped = zlib.gzipSync(content);

        if (ext === '.js') totalJsSize += gzipped.length;
        if (ext === '.css') totalCssSize += gzipped.length;
      }

      const jsBudget = 200 * 1024; // 200KB
      const cssBudget = 50 * 1024;  // 50KB

      if (totalJsSize > jsBudget) {
        findings.push({
          severity: 'warning',
          message: `JS bundle size (${(totalJsSize / 1024).toFixed(1)}KB gzipped) exceeds ${(jsBudget / 1024).toFixed(0)}KB budget`,
          action: 'Analyze and reduce bundle size',
        });
      }

      if (totalCssSize > cssBudget) {
        findings.push({
          severity: 'warning',
          message: `CSS bundle size (${(totalCssSize / 1024).toFixed(1)}KB gzipped) exceeds ${(cssBudget / 1024).toFixed(0)}KB budget`,
          action: 'Remove unused CSS',
        });
      }

      break; // Only check first found dist dir
    }

    // Check for unoptimized images
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp'];
    const imageFiles = this._collectFilesRecursive(projectRoot)
      .filter(f => imageExts.includes(path.extname(f).toLowerCase()));

    const largeImages = imageFiles.filter(f => {
      try { return fs.statSync(f).size > 500 * 1024; } catch { return false; }
    });

    if (largeImages.length > 0) {
      findings.push({
        severity: 'warning',
        message: `${largeImages.length} image(s) over 500KB — consider optimizing`,
        action: 'Compress images or convert to WebP/AVIF',
      });
    }

    return findings;
  }

  async _scanTechUpdates() {
    const findings = [];
    const projectRoot = this.config.projectRoot;
    const pkgPath = path.join(projectRoot, 'package.json');

    if (!fs.existsSync(pkgPath)) return findings;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const { execSync } = require('child_process');

      // Check for outdated packages
      try {
        const output = execSync('npm outdated --json 2>/dev/null', {
          cwd: projectRoot,
          encoding: 'utf-8',
          timeout: 30000,
        });

        const outdated = JSON.parse(output || '{}');
        const majorUpdates = Object.entries(outdated).filter(([, info]) => {
          if (!info.current || !info.latest) return false;
          const currentMajor = parseInt(info.current.split('.')[0]);
          const latestMajor = parseInt(info.latest.split('.')[0]);
          return latestMajor > currentMajor;
        });

        if (majorUpdates.length > 0) {
          findings.push({
            severity: 'info',
            message: `${majorUpdates.length} package(s) have major version updates available`,
            details: majorUpdates.slice(0, 5).map(([name, info]) => `${name}: ${info.current} -> ${info.latest}`),
            action: 'Review and update dependencies',
          });
        }
      } catch {
        // npm outdated exits with code 1 when outdated packages exist
      }

      // Check Node.js engine requirement
      if (pkg.engines?.node) {
        const requiredVersion = pkg.engines.node.replace(/[^0-9.]/g, '').split('.')[0];
        const currentVersion = process.version.replace('v', '').split('.')[0];
        if (parseInt(requiredVersion) < parseInt(currentVersion) - 2) {
          findings.push({
            severity: 'info',
            message: `Node.js engine requirement (${pkg.engines.node}) may be outdated`,
            action: 'Consider updating the minimum Node.js version',
          });
        }
      }
    } catch {
      // Invalid package.json
    }

    return findings;
  }

  async _scanCveDatabase() {
    const findings = [];
    const projectRoot = this.config.projectRoot;
    const { execSync } = require('child_process');

    // Run npm audit for CVE detection
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) return findings;

    try {
      execSync('npm audit --json 2>/dev/null', {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (err) {
      if (err.stdout) {
        try {
          const audit = JSON.parse(err.stdout);
          const vulns = audit.metadata?.vulnerabilities || {};
          const advisories = audit.vulnerabilities || {};

          if (vulns.critical > 0) {
            findings.push({
              severity: 'critical',
              message: `${vulns.critical} critical CVE(s) found in dependencies`,
              action: 'Run "npm audit fix" or manually update affected packages',
            });
          }

          if (vulns.high > 0) {
            findings.push({
              severity: 'high',
              message: `${vulns.high} high-severity CVE(s) found in dependencies`,
              action: 'Run "npm audit fix" to resolve',
            });
          }

          // Report specific advisories
          for (const [pkg, info] of Object.entries(advisories).slice(0, 5)) {
            if (info.severity === 'critical' || info.severity === 'high') {
              findings.push({
                severity: info.severity,
                message: `${pkg}: ${info.via?.[0]?.title || info.via?.[0] || 'vulnerability detected'}`,
                action: info.fixAvailable ? `Fix available: update ${pkg}` : 'No automatic fix — manual review required',
              });
            }
          }
        } catch { /* parse error */ }
      }
    }

    // Check for known vulnerable file patterns
    const dangerousFiles = ['phpinfo.php', '.git/config', '.svn/entries', '.DS_Store'];
    for (const file of dangerousFiles) {
      const filePath = path.join(projectRoot, file);
      if (fs.existsSync(filePath)) {
        findings.push({
          severity: 'warning',
          message: `Potentially sensitive file found: ${file}`,
          action: `Remove or secure ${file}`,
        });
      }
    }

    return findings;
  }

  _collectHtmlFiles(dir) {
    const files = [];
    const excluded = ['node_modules', '.git', 'dist', 'build', '.gatetest', 'coverage'];
    const walk = (d) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (excluded.includes(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.html?$/.test(entry.name)) files.push(full);
      }
    };
    walk(dir);
    return files;
  }

  _collectFilesRecursive(dir) {
    const files = [];
    const excluded = ['node_modules', '.git', '.gatetest', 'coverage'];
    const walk = (d) => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (excluded.includes(entry.name)) continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    };
    walk(dir);
    return files;
  }

  getLatestResults() {
    return this.results.slice(-50);
  }

  getStatus() {
    return {
      running: this.running,
      scanners: this.timers.map(t => t.name),
      totalScans: this.results.length,
      lastScan: this.results.length > 0 ? this.results[this.results.length - 1] : null,
    };
  }
}

module.exports = { ContinuousScanner };
