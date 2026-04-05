const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const cliPath = path.resolve(__dirname, '../bin/gatetest.js');
const projectRoot = path.resolve(__dirname, '..');

function runCli(args, options = {}) {
  try {
    const stdout = execSync(`node "${cliPath}" ${args}`, {
      encoding: 'utf-8',
      cwd: options.cwd || projectRoot,
      timeout: 30000,
      env: { ...process.env, ...options.env },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status || 1,
    };
  }
}

describe('CLI', () => {
  it('should show help with --help', () => {
    const { stdout, exitCode } = runCli('--help');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('GateTest'));
    assert.ok(stdout.includes('USAGE'));
    assert.ok(stdout.includes('--suite'));
    assert.ok(stdout.includes('--module'));
  });

  it('should show help with -h', () => {
    const { stdout, exitCode } = runCli('-h');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('GateTest'));
  });

  it('should show version with --version', () => {
    const { stdout, exitCode } = runCli('--version');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('GateTest v'));
    assert.ok(stdout.includes('1.0.0'));
  });

  it('should show version with -v', () => {
    const { stdout, exitCode } = runCli('-v');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('1.0.0'));
  });

  it('should list modules with --list', () => {
    const { stdout, exitCode } = runCli('--list');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('syntax'));
    assert.ok(stdout.includes('secrets'));
    assert.ok(stdout.includes('security'));
    assert.ok(stdout.includes('accessibility'));
  });

  it('should validate CLAUDE.md with --validate', () => {
    const { stdout, exitCode } = runCli('--validate');
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('CLAUDE.md Validation'));
    assert.ok(stdout.includes('Valid: true'));
  });

  it('should initialize project with --init', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-init-'));
    const { stdout, exitCode } = runCli('--init', { cwd: tmpDir });
    assert.strictEqual(exitCode, 0);
    assert.ok(stdout.includes('initialized'));
    assert.ok(fs.existsSync(path.join(tmpDir, '.gatetest', 'config.json')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.gatetest', 'reports')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.gatetest', 'screenshots')));
  });

  it('should run with --project flag', () => {
    const { stdout } = runCli(`--validate --project "${projectRoot}"`);
    assert.ok(stdout.includes('CLAUDE.md Validation'));
  });
});
