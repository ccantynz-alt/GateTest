// =============================================================================
// duplicate-code — skip list by segment, not substring (Move 10, 2026-09-05)
// =============================================================================
// `shouldSkipFile` used `lower.includes('test')` / `('spec')` / `('dist/')`,
// so src/latest/, attestation.js, inspect.js and mydist/ were silently left
// out of duplicate detection. This is the module's first test file; the
// control pair is: a real duplicate under src/latest/ MUST be reported, the
// same duplicate under tests/ must not.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DuplicateCode = require('../src/modules/duplicate-code');

// Well above WINDOW_SIZE (6) and dense enough to pass the "meaningful lines"
// bar — every line is a real statement.
const BLOCK = [
  'function computeTotals(items) {',
  '  let subtotal = 0;',
  '  let tax = 0;',
  '  for (const item of items) {',
  '    subtotal += item.price * item.quantity;',
  '    tax += item.price * item.quantity * item.taxRate;',
  '  }',
  '  const shipping = subtotal > 100 ? 0 : 9.95;',
  '  const total = subtotal + tax + shipping;',
  '  return { subtotal, tax, shipping, total };',
  '}',
  'module.exports = { computeTotals };',
  '',
].join('\n');

async function duplicatesBetween(relA, relB) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dupe-skip-'));
  try {
    for (const rel of [relA, relB]) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, BLOCK);
    }
    const checks = [];
    const result = {
      checks,
      addCheck(name, passed, meta) { checks.push({ name, passed, ...(meta || {}) }); },
      addInfo() {},
    };
    await new DuplicateCode().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed && c.name.startsWith('duplicate-code:'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('duplicate-code — skip list is segment-anchored', () => {
  it('reports a duplicate between two application files', async () => {
    const d = await duplicatesBetween('src/a/totals.js', 'src/b/totals.js');
    assert.ok(d.length > 0, 'positive control: a real duplicate must be reported');
  });

  for (const [a, b] of [
    ['src/latest/totals.js', 'src/checkout/totals.js'],
    ['src/attestation.js', 'src/billing/totals.js'],
    ['src/inspect.js', 'src/billing/totals.js'],
    ['mydist/totals.js', 'src/billing/totals.js'],
  ]) {
    it(`does not skip ${a}`, async () => {
      const d = await duplicatesBetween(a, b);
      assert.ok(d.length > 0, `${a} was skipped as if it were a test or build dir`);
    });
  }

  for (const [a, b] of [
    ['tests/totals.js', 'src/billing/totals.js'],
    ['src/__tests__/totals.js', 'src/billing/totals.js'],
    ['dist/totals.js', 'src/billing/totals.js'],
    ['src/totals.test.js', 'src/billing/totals.js'],
  ]) {
    it(`still skips ${a}`, async () => {
      const d = await duplicatesBetween(a, b);
      assert.strictEqual(d.length, 0, `${a} should be skipped: ${d.map((x) => x.name).join(', ')}`);
    });
  }
});
