const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { SessionLedger } = require('../src/core/session-ledger');

// Use a temp directory for tests
const TEST_ROOT = path.join(__dirname, '..', '.test-tmp-ledger');

function setup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  // Init a git repo so git commands work
  execSync('git init', { cwd: TEST_ROOT, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: TEST_ROOT, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: TEST_ROOT, stdio: 'pipe' });
  // Create an initial commit
  fs.writeFileSync(path.join(TEST_ROOT, 'README.md'), '# Test');
  execSync('git add . && git commit -m "Initial commit"', { cwd: TEST_ROOT, stdio: 'pipe' });
}

function cleanup() {
  if (fs.existsSync(TEST_ROOT)) {
    fs.rmSync(TEST_ROOT, { recursive: true });
  }
}

describe('SessionLedger', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('should create a snapshot with git state', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    const state = ledger.snapshot();

    assert.ok(state.timestamp);
    assert.ok(state.sessionId.startsWith('gts-'));
    assert.ok(state.git);
    assert.ok(state.git.branch);
    assert.strictEqual(state.git.lastCommit.message, 'Initial commit');
    assert.strictEqual(state.git.uncommittedCount, 0);
  });

  it('should detect uncommitted files', () => {
    fs.writeFileSync(path.join(TEST_ROOT, 'dirty.js'), 'const x = 1;');
    const ledger = new SessionLedger(TEST_ROOT);
    const state = ledger.snapshot();

    assert.strictEqual(state.git.uncommittedCount, 1);
    assert.ok(state.git.uncommittedFiles[0].includes('dirty.js'));
  });

  it('should save and load ledger state', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    const saved = ledger.snapshot();
    const loaded = ledger.load();

    assert.strictEqual(loaded.sessionId, saved.sessionId);
    assert.strictEqual(loaded.timestamp, saved.timestamp);
  });

  it('should return null when no ledger exists', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    const loaded = ledger.load();
    assert.strictEqual(loaded, null);
  });

  it('should include scan state when provided', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    const mockSummary = {
      gateStatus: 'BLOCKED',
      checks: { passed: 10, total: 12, failed: 2 },
      modules: { passed: 3, total: 4, failed: 1 },
      duration: 1234,
      failedModules: [{ module: 'security', error: 'Found secrets' }],
    };

    const state = ledger.snapshot(mockSummary);
    assert.strictEqual(state.scan.gateStatus, 'BLOCKED');
    assert.strictEqual(state.scan.checksPassed, 10);
    assert.strictEqual(state.scan.failedCount, 2);
    assert.strictEqual(state.scan.failures[0].module, 'security');
  });

  it('should build session history', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    ledger.snapshot();
    ledger.snapshot();
    ledger.snapshot();

    const history = ledger.loadHistory();
    assert.strictEqual(history.length, 3);
    // Newest first
    assert.ok(new Date(history[0].timestamp) >= new Date(history[2].timestamp));
  });

  it('should prune history beyond max', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    ledger.maxHistory = 3;

    for (let i = 0; i < 5; i++) {
      ledger.snapshot();
    }

    const history = ledger.loadHistory();
    assert.strictEqual(history.length, 3);
  });

  it('should generate a resume briefing', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    ledger.snapshot({
      gateStatus: 'PASSED',
      checks: { passed: 20, total: 20, failed: 0 },
      modules: { passed: 5, total: 5 },
      duration: 500,
      failedModules: [],
    });

    const briefing = ledger.generateResumeBriefing();
    assert.ok(briefing.text.includes('Session Resume'));
    assert.ok(briefing.text.includes('Initial commit'));
    assert.ok(briefing.text.includes('PASSED'));
    assert.ok(briefing.state);
  });

  it('should return fallback briefing when no state exists', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    const briefing = ledger.generateResumeBriefing();

    assert.ok(briefing.text.includes('No previous session'));
    assert.strictEqual(briefing.state, null);
  });

  it('should generate CLAUDE.md section', () => {
    const ledger = new SessionLedger(TEST_ROOT);
    ledger.snapshot({
      gateStatus: 'BLOCKED',
      checks: { passed: 8, total: 10, failed: 2 },
      modules: { passed: 3, total: 4 },
      duration: 1000,
      failedModules: [{ module: 'links', error: '2 broken links' }],
    });

    const section = ledger.generateClaudeMdSection();
    assert.ok(section.includes('SESSION CONTINUITY'));
    assert.ok(section.includes('BLOCKED'));
    assert.ok(section.includes('links'));
  });

  it('should inject into CLAUDE.md', () => {
    // Create a CLAUDE.md
    const claudeMd = path.join(TEST_ROOT, 'CLAUDE.md');
    fs.writeFileSync(claudeMd, '# Project\n\nSome content.\n\n---\n\n## Footer\n');

    const ledger = new SessionLedger(TEST_ROOT);
    ledger.snapshot();

    const injected = ledger.injectIntoClaudeMd();
    assert.strictEqual(injected, true);

    const content = fs.readFileSync(claudeMd, 'utf-8');
    assert.ok(content.includes('SESSION CONTINUITY'));
    assert.ok(content.includes('END SESSION CONTINUITY'));
  });

  it('should suggest next steps based on state', () => {
    // Create an uncommitted file
    fs.writeFileSync(path.join(TEST_ROOT, 'wip.js'), 'const y = 2;');

    const ledger = new SessionLedger(TEST_ROOT);
    ledger.snapshot({
      gateStatus: 'BLOCKED',
      checks: { passed: 5, total: 7, failed: 2 },
      modules: { passed: 2, total: 3, failed: 1 },
      duration: 800,
      failedModules: [{ module: 'syntax', error: 'Parse error in foo.js' }],
    });

    const briefing = ledger.generateResumeBriefing();
    assert.ok(briefing.text.includes('Suggested next steps'));
    assert.ok(briefing.text.includes('Commit'));
    assert.ok(briefing.text.includes('syntax'));
  });
});
