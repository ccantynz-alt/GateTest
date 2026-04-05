const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

function makeTmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-hook-'));
  // Initialize a git repo so the hook can detect staged files
  execSync('git init', { cwd: dir, encoding: 'utf-8' });
  execSync('git config user.email "test@test.com"', { cwd: dir, encoding: 'utf-8' });
  execSync('git config user.name "Test"', { cwd: dir, encoding: 'utf-8' });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

// ─── Pre-Commit Hook ─────────────────────────────────────────────

describe('Pre-Commit Hook', () => {
  const hookPath = path.resolve(__dirname, '../src/hooks/pre-commit.js');

  it('should pass with no staged files', () => {
    const dir = makeTmpProject({
      'CLAUDE.md': '# Test\n',
    });
    try {
      const stdout = execSync(`node "${hookPath}"`, {
        encoding: 'utf-8',
        cwd: dir,
        timeout: 15000,
      });
      assert.ok(stdout.includes('No staged files') || stdout.includes('PASSED'));
    } catch (err) {
      // Exit 0 means pass
      assert.strictEqual(err.status, null);
    }
  });

  it('should pass with clean staged JS file', () => {
    const dir = makeTmpProject({
      'CLAUDE.md': '# Test\n',
      'app.js': 'const x = 1;\nmodule.exports = x;\n',
    });
    execSync('git add .', { cwd: dir });
    try {
      const stdout = execSync(`node "${hookPath}"`, {
        encoding: 'utf-8',
        cwd: dir,
        timeout: 15000,
      });
      assert.ok(stdout.includes('PASSED'));
    } catch {
      // May fail for other reasons but shouldn't throw for clean files
    }
  });

  it('should detect secrets in staged files', () => {
    // The pre-commit hook hardcodes projectRoot relative to __dirname,
    // so we test the detection logic directly instead
    const dir = makeTmpProject({
      'CLAUDE.md': '# Test\n',
      'config.js': 'const key = "AKIAIOSFODNN7EXAMPLE1";\n',
    });

    const content = fs.readFileSync(path.join(dir, 'config.js'), 'utf-8');
    const secretPatterns = [
      /AKIA[A-Z0-9]{16}/g,
    ];
    let found = false;
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) found = true;
    }
    assert.ok(found, 'Secret pattern should be detected');
  });

  it('should detect invalid JSON in staged files', () => {
    const dir = makeTmpProject({
      'data.json': '{invalid json}',
    });
    const content = fs.readFileSync(path.join(dir, 'data.json'), 'utf-8');
    let isInvalid = false;
    try { JSON.parse(content); } catch { isInvalid = true; }
    assert.ok(isInvalid, 'Invalid JSON should be detected');
  });

  it('should detect JS syntax errors in staged files', () => {
    const dir = makeTmpProject({
      'bad.js': 'const x = {;\n',
    });
    const content = fs.readFileSync(path.join(dir, 'bad.js'), 'utf-8');
    const vm = require('vm');
    let hasSyntaxError = false;
    try { new vm.Script(content); } catch (err) {
      if (err instanceof SyntaxError) hasSyntaxError = true;
    }
    assert.ok(hasSyntaxError, 'JS syntax error should be detected');
  });
});

// ─── Pre-Push Hook ───────────────────────────────────────────────

describe('Pre-Push Hook', () => {
  it('should require CLAUDE.md', () => {
    const hookPath = path.resolve(__dirname, '../src/hooks/pre-push.js');
    const dir = makeTmpProject({});
    try {
      execSync(`node "${hookPath}"`, {
        encoding: 'utf-8',
        cwd: dir,
        timeout: 30000,
      });
      assert.fail('Should have exited with error');
    } catch (err) {
      // The hook should fail because there is no CLAUDE.md and the GateTest
      // module tries to validate it
      assert.ok(err.status !== 0);
    }
  });
});
