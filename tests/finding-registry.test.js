'use strict';

// FINDING REGISTRY — one defect is one finding, ranked by what matters.
// Hand-built results with known answers (pure module, no fs).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFindings, summarizeFindings, annotateDuplicates, ruleKeyOf, classify } = require('../src/core/finding-registry');

const chk = (name, over = {}) => ({ name, passed: false, severity: 'error', confidence: 1, message: name, ...over });

describe('finding-registry — dedupe across modules', () => {
  it('eval reported by security, codeQuality and crossFileTaint at the same line collapses to ONE finding owned by the taint module', () => {
    const results = [
      { module: 'security', checks: [chk('security:eval():app/x.js:32', { file: 'app/x.js', line: 32, message: 'CRITICAL: eval() detected' })] },
      { module: 'codeQuality', checks: [chk('quality:eval:app/x.js:32', { file: 'app\\x.js', line: 32, message: 'eval() usage — arbitrary code execution' })] },
      { module: 'crossFileTaint', checks: [chk('taint:sink:eval:app/x.js:32', { file: 'app/x.js', line: 32, message: 'Tainted input reaches eval() sink' })] },
    ];
    const f = normalizeFindings(results);
    const primary = f.filter((x) => !x.duplicateOf);
    assert.equal(primary.length, 1, JSON.stringify(f));
    assert.equal(primary[0].module, 'crossFileTaint');
    assert.equal(f.filter((x) => x.duplicateOf).length, 2);
    const s = summarizeFindings(f);
    assert.equal(s.total, 1);
    assert.equal(s.duplicatesCollapsed, 2);
    assert.equal(s.blocking, 1);
  });

  it('the same class on DIFFERENT lines, or a different class on the same line, are separate findings', () => {
    const results = [
      { module: 'security', checks: [chk('a', { file: 'x.js', line: 1, message: 'eval() detected' }), chk('b', { file: 'x.js', line: 2, message: 'eval() detected' })] },
      { module: 'codeQuality', checks: [chk('c', { file: 'x.js', line: 1, message: 'console.log left in code', severity: 'warning' })] },
    ];
    const f = normalizeFindings(results);
    assert.equal(f.filter((x) => !x.duplicateOf).length, 3);
  });

  it('two checks from the SAME module at one line are not marked as cross-module duplicates', () => {
    const results = [{ module: 'security', checks: [chk('a', { file: 'x.js', line: 1, message: 'eval() detected' }), chk('b', { file: 'x.js', line: 1, message: 'eval() sink' })] }];
    assert.equal(normalizeFindings(results).filter((x) => x.duplicateOf).length, 0);
  });

  it('findings without file+line are never deduped (nothing to key on)', () => {
    const results = [
      { module: 'security', checks: [chk('security:secrets-scan', { message: 'Found 4 potential secret(s)' })] },
      { module: 'secrets', checks: [chk('secrets:summary', { message: 'secrets found' })] },
    ];
    assert.equal(normalizeFindings(results).filter((x) => x.duplicateOf).length, 0);
  });
});

describe('finding-registry — ranking and summary', () => {
  it('ranks blocking errors first, then soft errors, warnings, info; duplicates last', () => {
    const results = [{ module: 'm', checks: [
      chk('w', { severity: 'warning', message: 'a warning' }),
      chk('soft', { confidence: 0.4, message: 'low confidence error' }),
      chk('i', { severity: 'info', message: 'fyi' }),
      chk('block', { confidence: 0.95, message: 'real error' }),
    ] }];
    const f = normalizeFindings(results);
    assert.deepEqual(f.map((x) => x.rule), ['block', 'soft', 'w', 'i']);
    const s = summarizeFindings(f);
    assert.equal(s.blocking, 1);
    assert.equal(s.hiddenLowConfidence, 1);
    assert.equal(s.warnings, 1);
    assert.equal(s.info, 1);
  });

  it('extracts the rule key from names carrying a trailing path:line, on either slash', () => {
    assert.equal(ruleKeyOf('security:eval():app/routes/x.js:32', 'app/routes/x.js'), 'security:eval()');
    assert.equal(ruleKeyOf('secrets:benchmarks\\bench\\login.js', 'benchmarks\\bench\\login.js'), 'secrets');
    assert.equal(ruleKeyOf('a11y:img-alt:templates/welcome.html'), 'a11y:img-alt');
    assert.equal(ruleKeyOf('auth-bypass:no-routes'), 'auth-bypass:no-routes');
  });

  it('classifies the messages that were measured to double-report', () => {
    assert.equal(classify('CRITICAL: eval() detected'), 'eval');
    assert.equal(classify('element.innerHTML assignment'), 'innerhtml');
    assert.equal(classify('Potential API Key found in config'), 'secret');
    assert.equal(classify('HIGH: open redirect risk detected'), 'open-redirect');
    assert.equal(classify('something unrelated'), null);
  });

  it('annotateDuplicates stamps duplicateOf on the underlying checks without touching counts', () => {
    const results = [
      { module: 'security', errors: 1, checks: [chk('security:eval():x.js:1', { file: 'x.js', line: 1, message: 'eval() detected' })] },
      { module: 'codeQuality', errors: 1, checks: [chk('quality:eval:x.js:1', { file: 'x.js', line: 1, message: 'eval() usage' })] },
    ];
    const n = annotateDuplicates(results);
    assert.equal(n, 1);
    assert.equal(results[1].checks[0].duplicateOf, 'security:security:eval():x.js:1');
    assert.equal(results[0].checks[0].duplicateOf, undefined);
    assert.equal(results[1].errors, 1, 'gate counts untouched');
  });
});
