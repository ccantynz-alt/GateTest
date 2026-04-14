const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { MemoryStore } = require('../src/core/memory');

describe('MemoryStore', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-memory-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty snapshot for a fresh repo', () => {
    const store = new MemoryStore(tmpDir);
    const snap = store.load();
    assert.strictEqual(snap.fingerprint, null);
    assert.deepStrictEqual(snap.issues, []);
    assert.strictEqual(snap.scans.totalScans, 0);
    assert.deepStrictEqual(snap.falsePositives, {});
  });

  it('detects languages from file extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.js'), 'const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'b.ts'), 'const y: number = 2;');
    fs.writeFileSync(path.join(tmpDir, 'c.py'), 'x = 1');

    const store = new MemoryStore(tmpDir);
    const fp = store.detectFingerprint();
    assert.strictEqual(fp.languages.javascript, 1);
    assert.strictEqual(fp.languages.typescript, 1);
    assert.strictEqual(fp.languages.python, 1);
  });

  it('detects frameworks from package.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '^16.0.0', react: '^19.0.0' },
        devDependencies: { typescript: '^5.0.0', playwright: '^1.0.0' },
      }),
    );
    const store = new MemoryStore(tmpDir);
    const fp = store.detectFingerprint();
    assert.ok(fp.frameworks.includes('nextjs'));
    assert.ok(fp.frameworks.includes('react'));
    assert.ok(fp.frameworks.includes('typescript'));
    assert.ok(fp.frameworks.includes('playwright'));
  });

  it('appends issues and de-duplicates on identical keys', () => {
    const store = new MemoryStore(tmpDir);
    const issues = [
      { module: 'lint', name: 'no-unused-vars', file: 'a.js', line: 10, severity: 'warning', message: 'x' },
      { module: 'lint', name: 'no-unused-vars', file: 'a.js', line: 10, severity: 'warning', message: 'x' },
      { module: 'lint', name: 'no-unused-vars', file: 'b.js', line: 5, severity: 'warning', message: 'y' },
    ];
    const added = store.ingestIssues(issues);
    assert.strictEqual(added, 2, 'duplicate should be dropped, 2 unique issues added');

    // Second ingestion of the same issues adds nothing
    const addedAgain = store.ingestIssues(issues);
    assert.strictEqual(addedAgain, 0);
  });

  it('returns recurring issues above a threshold', () => {
    const store = new MemoryStore(tmpDir);
    // Simulate the same issue being appended across 4 "runs" by writing
    // directly to the jsonl (bypassing dedupe for this test).
    const memDir = path.join(tmpDir, '.gatetest', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const line = JSON.stringify({ _key: 'lint:no-unused-vars:a.js:10', module: 'lint' });
    fs.writeFileSync(path.join(memDir, 'issues.jsonl'), Array(4).fill(line).join('\n') + '\n');

    const recurring = store.getRecurringIssues(3);
    assert.strictEqual(recurring.length, 1);
    assert.strictEqual(recurring[0].key, 'lint:no-unused-vars:a.js:10');
    assert.strictEqual(recurring[0].count, 4);
  });

  it('records and persists scan summaries', () => {
    const store = new MemoryStore(tmpDir);
    store.recordScan({ gateStatus: 'PASSED', issueCount: 0, errorCount: 0 });
    store.recordScan({ gateStatus: 'FAILED', issueCount: 3, errorCount: 1 });

    const snap = store.load();
    assert.strictEqual(snap.scans.totalScans, 2);
    assert.strictEqual(snap.scans.runs.length, 2);
    assert.strictEqual(snap.scans.runs[1].gateStatus, 'FAILED');
  });

  it('dismisses false positives and remembers them', () => {
    const store = new MemoryStore(tmpDir);
    assert.strictEqual(store.isFalsePositive('foo:bar'), false);
    store.dismiss('foo:bar', 'intentional test fixture');
    assert.strictEqual(store.isFalsePositive('foo:bar'), true);
  });

  it('ingestLatestReport returns scanIngested=false when no report exists', () => {
    const store = new MemoryStore(tmpDir);
    const res = store.ingestLatestReport();
    assert.strictEqual(res.scanIngested, false);
    assert.strictEqual(res.newIssues, 0);
  });

  it('ingestLatestReport pulls failed checks from a real report file', () => {
    const reportDir = path.join(tmpDir, '.gatetest', 'reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const report = {
      gatetest: { version: '1.0.0', timestamp: '2026-04-14T00:00:00Z', gateStatus: 'FAILED' },
      summary: { checks: { failed: 2, errors: 1 } },
      results: [
        {
          module: 'lint',
          checks: [
            { name: 'no-unused-vars', passed: false, severity: 'warning', file: 'a.js', line: 3, message: 'unused x' },
            { name: 'ok-check', passed: true, severity: 'info' },
          ],
        },
      ],
    };
    fs.writeFileSync(
      path.join(reportDir, 'gatetest-report-latest.json'),
      JSON.stringify(report),
    );

    const store = new MemoryStore(tmpDir);
    const res = store.ingestLatestReport();
    assert.strictEqual(res.scanIngested, true);
    assert.strictEqual(res.newIssues, 1, 'only failed checks become memory issues');

    const snap = store.load();
    assert.strictEqual(snap.issues.length, 1);
    assert.strictEqual(snap.scans.totalScans, 1);
    assert.strictEqual(snap.scans.runs[0].gateStatus, 'FAILED');
  });
});

describe('MemoryModule', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-memmod-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads without throwing on an empty repo', async () => {
    const MemoryModule = require('../src/modules/memory');
    const mod = new MemoryModule();
    const result = { checks: [], addCheck(n, p, d) { this.checks.push({ n, p, ...d }); } };
    const config = { projectRoot: tmpDir };
    await mod.run(result, config);
    const summary = result.checks.find((c) => c.n === 'memory:summary');
    assert.ok(summary, 'memory:summary check must be recorded');
    assert.ok(config._memory, 'memory must be attached to config');
    assert.ok(config._memory.store);
    assert.ok(config._memory.fingerprint);
  });

  it('attaches recurring issues to config._memory', async () => {
    // Seed memory with a recurring issue
    const memDir = path.join(tmpDir, '.gatetest', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    const line = JSON.stringify({ _key: 'lint:foo:a.js:1', module: 'lint' });
    fs.writeFileSync(path.join(memDir, 'issues.jsonl'), Array(5).fill(line).join('\n') + '\n');

    const MemoryModule = require('../src/modules/memory');
    const mod = new MemoryModule();
    const result = { checks: [], addCheck(n, p, d) { this.checks.push({ n, p, ...d }); } };
    const config = { projectRoot: tmpDir };
    await mod.run(result, config);

    assert.strictEqual(config._memory.recurring.length, 1);
    assert.strictEqual(config._memory.recurring[0].count, 5);
    const recurringCheck = result.checks.find((c) => c.n.startsWith('memory:recurring:'));
    assert.ok(recurringCheck, 'a memory:recurring:* check must be recorded');
  });
});
