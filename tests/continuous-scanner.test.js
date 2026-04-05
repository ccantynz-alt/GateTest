const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { ContinuousScanner } = require('../src/scanners/continuous-scanner');

function makeTmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-scan-'));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

describe('ContinuousScanner', () => {
  let scanner;

  afterEach(() => {
    if (scanner && scanner.running) {
      scanner.stop();
    }
  });

  it('should initialize with config', () => {
    const config = { projectRoot: '/tmp' };
    scanner = new ContinuousScanner(config);
    assert.ok(scanner);
    assert.strictEqual(scanner.running, false);
    assert.strictEqual(scanner.results.length, 0);
  });

  it('should emit scanner:started on start', (_, done) => {
    const dir = makeTmpProject({ 'package.json': '{"name":"test"}' });
    scanner = new ContinuousScanner({ projectRoot: dir });
    scanner.on('scanner:started', () => {
      assert.strictEqual(scanner.running, true);
      scanner.stop();
      done();
    });
    scanner.start();
  });

  it('should emit scanner:stopped on stop', (_, done) => {
    const dir = makeTmpProject({ 'package.json': '{"name":"test"}' });
    scanner = new ContinuousScanner({ projectRoot: dir });
    scanner.on('scanner:stopped', () => {
      assert.strictEqual(scanner.running, false);
      done();
    });
    scanner.start();
    // Give it a moment to start, then stop
    setTimeout(() => scanner.stop(), 100);
  });

  it('should not start twice', () => {
    const dir = makeTmpProject({ 'package.json': '{"name":"test"}' });
    scanner = new ContinuousScanner({ projectRoot: dir });
    scanner.start();
    const timerCount = scanner.timers.length;
    scanner.start(); // Should be no-op
    assert.strictEqual(scanner.timers.length, timerCount);
    scanner.stop();
  });

  it('should report status', () => {
    const dir = makeTmpProject({ 'package.json': '{"name":"test"}' });
    scanner = new ContinuousScanner({ projectRoot: dir });
    scanner.start();
    const status = scanner.getStatus();
    assert.strictEqual(status.running, true);
    assert.ok(status.scanners.length > 0);
    assert.ok(status.scanners.includes('dependency-audit'));
    assert.ok(status.scanners.includes('link-check'));
    scanner.stop();
  });

  it('should collect scan results', async () => {
    const dir = makeTmpProject({ 'package.json': '{"name":"test"}' });
    scanner = new ContinuousScanner({ projectRoot: dir });

    // Manually run a scan
    await scanner._runScan('test-scan', async () => []);
    assert.strictEqual(scanner.results.length, 1);
    assert.strictEqual(scanner.results[0].scanner, 'test-scan');
    assert.strictEqual(scanner.results[0].status, 'clean');
  });

  it('should emit scan:alert for findings', async () => {
    const dir = makeTmpProject({});
    scanner = new ContinuousScanner({ projectRoot: dir });

    let alerted = false;
    scanner.on('scan:alert', (result) => {
      alerted = true;
      assert.strictEqual(result.status, 'findings');
    });

    await scanner._runScan('test-scan', async () => [
      { severity: 'warning', message: 'test finding' },
    ]);

    assert.ok(alerted);
  });

  it('should handle scan errors', async () => {
    const dir = makeTmpProject({});
    scanner = new ContinuousScanner({ projectRoot: dir });

    let errorEmitted = false;
    scanner.on('scan:error', (data) => {
      errorEmitted = true;
      assert.strictEqual(data.scanner, 'failing-scan');
    });

    await scanner._runScan('failing-scan', async () => {
      throw new Error('scan failed');
    });

    assert.ok(errorEmitted);
  });

  it('should return latest results', async () => {
    const dir = makeTmpProject({});
    scanner = new ContinuousScanner({ projectRoot: dir });

    for (let i = 0; i < 5; i++) {
      await scanner._runScan(`scan-${i}`, async () => []);
    }

    const latest = scanner.getLatestResults();
    assert.strictEqual(latest.length, 5);
  });

  it('should limit latest results to 50', async () => {
    const dir = makeTmpProject({});
    scanner = new ContinuousScanner({ projectRoot: dir });

    for (let i = 0; i < 60; i++) {
      scanner.results.push({ scanner: `scan-${i}`, status: 'clean' });
    }

    const latest = scanner.getLatestResults();
    assert.strictEqual(latest.length, 50);
  });
});

// ─── Scanner Function Tests ──────────────────────────────────────

describe('Scanner Functions', () => {
  it('_scanLinks should return findings for broken internal links', async () => {
    const dir = makeTmpProject({
      'index.html': '<a href="missing.html">Link</a>',
    });
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanLinks();
    assert.ok(findings.length > 0);
    assert.ok(findings[0].message.includes('Broken internal link'));
    scanner.stop();
  });

  it('_scanLinks should return empty for valid links', async () => {
    const dir = makeTmpProject({
      'index.html': '<a href="about.html">About</a>',
      'about.html': '<h1>About</h1>',
    });
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanLinks();
    assert.strictEqual(findings.length, 0);
  });

  it('_scanSecurityHeaders should report missing config', async () => {
    const dir = makeTmpProject({
      'index.html': '<html><body>Hello</body></html>',
    });
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanSecurityHeaders();
    assert.ok(findings.length > 0);
  });

  it('_scanPerformance should return empty for project with no build dir', async () => {
    const dir = makeTmpProject({
      'app.js': 'const x = 1;\n',
    });
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanPerformance();
    // No build dir and no large images = no findings
    assert.strictEqual(findings.length, 0);
  });

  it('_scanTechUpdates should handle projects without package.json', async () => {
    const dir = makeTmpProject({});
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanTechUpdates();
    assert.strictEqual(findings.length, 0);
  });

  it('_scanCveDatabase should handle projects without package.json', async () => {
    const dir = makeTmpProject({});
    const scanner = new ContinuousScanner({ projectRoot: dir });
    const findings = await scanner._scanCveDatabase();
    assert.strictEqual(findings.length, 0);
  });
});
