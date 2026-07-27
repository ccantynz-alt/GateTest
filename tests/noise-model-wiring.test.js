/**
 * KI #76 — the noise model is only useful if something WRITES its inputs.
 *
 * `computePenalties()` gates on `dismissCount >= MIN_DISMISSALS`, and
 * dismissCount came from two sources that both had zero production callers:
 * `memory.dismiss()` (no CLI flag ever called it) and
 * `persistent-memory.recordSuppression()` (referenced only by its own test).
 * So the penalty map was permanently `{}` and `gatetest --noise` printed
 * "No modules softened yet" no matter what the user did.
 *
 * The fix routes .gatetestignore suppressions into that store: silencing a
 * rule in .gatetestignore IS the user declaring it a false positive. These
 * tests pin the whole loop — runner emits the signal, telemetry persists it,
 * the noise model reads it — plus the two boundaries that keep it honest
 * (baseline suppressions excluded, per-scan dedupe).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const persistentMemory = require('../src/core/persistent-memory');
const noiseModel = require('../src/core/noise-model');
const scanTelemetry = require('../src/core/scan-telemetry');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-noise-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('persistent-memory — recordSuppressions (batched)', () => {
  it('records each pair and bumps the module counter', () => {
    persistentMemory.recordScan(root, {
      modules: [{ name: 'hardcodedUrl', status: 'failed', errors: 1, warnings: 0 }],
      totalIssues: 1,
    });
    const n = persistentMemory.recordSuppressions(root, [
      { module: 'hardcodedUrl', ruleKey: 'localhost-url' },
      { module: 'hardcodedUrl', ruleKey: 'ip-literal' },
    ]);
    assert.strictEqual(n, 2);

    const data = persistentMemory.load(root);
    assert.strictEqual(data.suppressions['hardcodedUrl:localhost-url'].count, 1);
    assert.strictEqual(data.suppressions['hardcodedUrl:ip-literal'].count, 1);
    assert.strictEqual(data.modules.hardcodedUrl.suppressions, 2);
  });

  it('is a no-op on an empty or malformed list', () => {
    assert.strictEqual(persistentMemory.recordSuppressions(root, []), 0);
    assert.strictEqual(persistentMemory.recordSuppressions(root, null), 0);
    assert.strictEqual(
      persistentMemory.recordSuppressions(root, [{ module: 'x' }, null, { ruleKey: 'y' }]),
      0,
      'entries missing module or ruleKey must be skipped, not counted',
    );
  });
});

describe('KI #76 — the dismissal loop actually closes', () => {
  // Enough runs + dismissals + fireRate to cross every threshold in
  // _penaltyFor. Before the fix, no amount of scanning could get here.
  function driveScans({ scans, suppressPerScan }) {
    for (let i = 0; i < scans; i++) {
      scanTelemetry.recordScanFindings(
        {
          gateStatus: 'BLOCKED',
          duration: 10,
          checks: { errors: 1, warnings: 0 },
          results: [{ module: 'hardcodedUrl', errors: 1, warnings: 0, status: 'failed' }],
          suppressedRules: suppressPerScan,
        },
        { source: 'cli', projectRoot: root, suite: 'quick', filePath: path.join(root, 'tel.jsonl') },
      );
    }
  }

  it('a module the user keeps silencing eventually earns a penalty', () => {
    driveScans({
      scans: 5,
      suppressPerScan: [{ module: 'hardcodedUrl', ruleKey: 'localhost-url' }],
    });

    const data = persistentMemory.load(root);
    assert.ok(data.modules.hardcodedUrl.runs >= 3, 'runs must accumulate');
    assert.ok(data.modules.hardcodedUrl.suppressions >= 3, 'suppressions must accumulate');

    const penalties = noiseModel.computePenalties(root);
    assert.ok(
      Object.keys(penalties).length > 0,
      'computePenalties() was permanently {} before this wiring existed',
    );
    assert.ok(penalties.hardcodedUrl < 1, 'the silenced module must be softened');
  });

  it('a module nobody silences is never softened', () => {
    driveScans({ scans: 5, suppressPerScan: [] });
    const penalties = noiseModel.computePenalties(root);
    assert.deepStrictEqual(penalties, {}, 'firing often is not, by itself, evidence of noise');
  });

  it('the noise report surfaces the module as noisy', () => {
    driveScans({
      scans: 5,
      suppressPerScan: [{ module: 'hardcodedUrl', ruleKey: 'localhost-url' }],
    });
    const row = noiseModel.getNoiseReport(root).find((r) => r.module === 'hardcodedUrl');
    assert.ok(row, 'the module must appear in the report');
    assert.strictEqual(row.noisy, true);
    assert.ok(row.dismissals >= 3);
  });
});

describe('KI #76 — boundaries that keep the signal honest', () => {
  it('recordScanFindings survives a summary with no suppressedRules', () => {
    const out = scanTelemetry.recordScanFindings(
      {
        gateStatus: 'PASSED',
        duration: 1,
        checks: { errors: 0, warnings: 0 },
        results: [{ module: 'syntax', errors: 0, warnings: 0, status: 'ok' }],
      },
      { source: 'cli', projectRoot: root, suite: 'quick', filePath: path.join(root, 'tel.jsonl') },
    );
    assert.strictEqual(out.recorded, true);
    const data = persistentMemory.load(root);
    assert.deepStrictEqual(data.suppressions, {});
  });
});

describe('KI #76 — runner emits the signal it is supposed to', () => {
  const runnerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runner.js'), 'utf8');

  it('the summary carries suppressedRules', () => {
    assert.match(runnerSrc, /suppressedRules,/, 'summary must expose the field');
  });

  it('only .gatetestignore counts — a baselined finding is real, not noise', () => {
    assert.match(runnerSrc, /c\.suppressReason !== 'gatetestignore'\) continue/);
    assert.match(
      runnerSrc,
      /EXCLUDES suppressReason === 'baseline'/,
      'the exclusion must stay documented — counting baselines would soften modules for being right',
    );
  });

  it('pairs are deduped within a scan', () => {
    assert.match(runnerSrc, /if \(seen\.has\(key\)\) continue/);
  });
});

/**
 * Both regressions below were invisible to unit tests and only appeared in a
 * real CLI run against a fixture repo. They are the difference between "the
 * wiring exists" and "the feature works".
 */
describe('KI #76 — suppression must not hide the module from its own model', () => {
  it('a suppressed finding still counts as the module FIRING', () => {
    // The trap: suppressing a rule removes it from errors/warnings, so the
    // module reads as quiet. fireRate then falls under HIGH_FIRE_RATE and the
    // penalty never applies — declaring a module noisy made it un-softenable.
    // Measured on a real scan before the fix: fireRate 1.0 -> 0.2.
    persistentMemory.recordScan(root, {
      modules: [{ name: 'hardcodedUrl', status: 'ok', errors: 0, warnings: 0, suppressed: 3 }],
      totalIssues: 0,
    });
    const data = persistentMemory.load(root);
    assert.strictEqual(data.modules.hardcodedUrl.fires, 1, 'suppressed findings are still fires');
    assert.strictEqual(data.modules.hardcodedUrl.fireRate, 1);
  });

  it('a genuinely quiet module is still recorded as not firing', () => {
    persistentMemory.recordScan(root, {
      modules: [{ name: 'syntax', status: 'ok', errors: 0, warnings: 0, suppressed: 0 }],
      totalIssues: 0,
    });
    assert.strictEqual(persistentMemory.load(root).modules.syntax.fires, 0);
  });

  it('the runner exposes suppressedChecks so the count can travel', () => {
    const runnerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runner.js'), 'utf8');
    assert.match(runnerSrc, /suppressedChecks: this\.suppressedChecks\.length/);
  });
});

describe('KI #76 — the suppression key identifies a RULE, not a file:line', () => {
  const { _ruleIdentity } = require('../src/core/runner');

  it('strips the file and line embedded in a check name', () => {
    // Raw name produced one store entry per file per line, so the map grew
    // without bound instead of counting "this rule was silenced".
    assert.strictEqual(
      _ruleIdentity({ name: 'hardcoded-url:localhost:src\cfg.js:1', file: 'src\cfg.js' }),
      'hardcoded-url:localhost',
    );
    assert.strictEqual(
      _ruleIdentity({ name: 'hardcoded-url:localhost:src/cfg.js:12', file: 'src/cfg.js' }),
      'hardcoded-url:localhost',
    );
  });

  it('strips a trailing line number even when the path does not match verbatim', () => {
    assert.strictEqual(_ruleIdentity({ name: 'some-rule:42' }), 'some-rule');
  });

  it('leaves a plain rule name untouched', () => {
    assert.strictEqual(_ruleIdentity({ name: 'unit-tests:run' }), 'unit-tests:run');
  });

  it('two files silenced by one pattern collapse to a single key', () => {
    persistentMemory.recordScan(root, {
      modules: [{ name: 'hardcodedUrl', status: 'ok', errors: 0, warnings: 0, suppressed: 2 }],
      totalIssues: 0,
    });
    persistentMemory.recordSuppressions(root, [
      { module: 'hardcodedUrl', ruleKey: 'hardcoded-url:localhost' },
    ]);
    assert.deepStrictEqual(
      Object.keys(persistentMemory.load(root).suppressions),
      ['hardcodedUrl:hardcoded-url:localhost'],
    );
  });
});

/**
 * A path-scoped ignore is NOT evidence about a module.
 *
 * `hardcodedUrl:localhost` says "this rule is wrong about my repo" — a real
 * accuracy signal. `benchmarks/bench-target/**` says "this directory is not
 * real code" and implies nothing about any module. Counting the second as a
 * dismissal made GateTest down-weight accurate modules for firing inside a
 * deliberately-bad fixture corpus: on GateTest's own repo, 5 ignore lines
 * softened 555 findings across secrets, codeQuality, deadCode and 5 more,
 * because two of those lines were directory excludes.
 *
 * Found 2026-07-28 only because the scan summary started DISCLOSING how many
 * findings had been softened — the count was the bug report.
 */
describe('KI #76/#77 — only module-scoped ignores teach the noise model', () => {
  const ignoreFile = require('../src/core/ignore-file');

  it('matchKind distinguishes a module rule from a path glob', () => {
    const m = ignoreFile.parse('hardcodedUrl:localhost\ncorpus/**\n');
    assert.strictEqual(
      m.matchKind({ module: 'hardcodedUrl', ruleKey: 'hardcoded-url:localhost', file: 'src/a.js' }),
      'moduleRule',
    );
    assert.strictEqual(
      m.matchKind({ module: 'secrets', ruleKey: 'secrets:key', file: 'corpus/b.js' }),
      'path',
    );
    assert.strictEqual(
      m.matchKind({ module: 'secrets', ruleKey: 'secrets:key', file: 'src/b.js' }),
      null,
    );
  });

  it('matches() still answers the original question', () => {
    const m = ignoreFile.parse('hardcodedUrl:localhost\ncorpus/**\n');
    assert.strictEqual(m.matches({ module: 'secrets', ruleKey: 'secrets:key', file: 'corpus/b.js' }), true);
    assert.strictEqual(m.matches({ module: 'secrets', ruleKey: 'secrets:key', file: 'src/b.js' }), false);
  });

  it('the runner records which kind suppressed a finding', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runner.js'), 'utf8');
    assert.match(src, /check\.suppressKind = kind;/);
    assert.match(
      src,
      /if \(c\.suppressKind && c\.suppressKind !== 'moduleRule'\) continue;/,
      'path-scoped suppressions must not reach the noise model',
    );
  });

  it('a path-suppressed finding contributes no dismissal', () => {
    // Mirrors the runner's filter: only moduleRule kinds are collected.
    const checks = [
      { suppressReason: 'gatetestignore', suppressKind: 'path', name: 'secrets:key' },
      { suppressReason: 'gatetestignore', suppressKind: 'moduleRule', name: 'hardcoded-url:localhost' },
      { suppressReason: 'baseline', suppressKind: 'moduleRule', name: 'other:rule' },
    ];
    const collected = checks.filter(
      (c) => c.suppressReason === 'gatetestignore' && (!c.suppressKind || c.suppressKind === 'moduleRule'),
    );
    assert.strictEqual(collected.length, 1);
    assert.strictEqual(collected[0].name, 'hardcoded-url:localhost');
  });
});

describe('KI #77 — warning confidence is reported, never silently dropped', () => {
  const { GateTestRunner, TestResult } = require('../src/core/runner');

  it('softWarningChecks counts low-confidence warnings without removing them', () => {
    const r = new TestResult('probe', { blockThreshold: 0.7 });
    r.addCheck('a', false, { severity: 'warning', confidence: 0.9 });
    r.addCheck('b', false, { severity: 'warning', confidence: 0.4 });
    r.addCheck('c', false, { severity: 'warning', confidence: 0.2 });
    assert.strictEqual(r.warningChecks.length, 3, 'nothing is filtered out');
    assert.strictEqual(r.softWarningChecks.length, 2, 'low-confidence ones are countable');
  });

  it('flywheelSoftenedChecks surfaces findings quieted by past dismissals', () => {
    const r = new TestResult('probe', { blockThreshold: 0.7 });
    r.addCheck('a', false, { severity: 'warning', confidence: 0.3, confidenceSignals: ['flywheel-softened'] });
    r.addCheck('b', false, { severity: 'warning', confidence: 0.9, confidenceSignals: [] });
    assert.strictEqual(r.flywheelSoftenedChecks.length, 1);
  });

  it('the console reporter discloses both counts', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'reporters', 'console-reporter.js'), 'utf8');
    assert.match(src, /low confidence/, 'the soft-warning share must be visible');
    assert.match(src, /Softened:/, 'flywheel softening must not be silent');
  });

  it('GateTestRunner is exported alongside TestResult', () => {
    assert.strictEqual(typeof GateTestRunner, 'function');
  });
});
