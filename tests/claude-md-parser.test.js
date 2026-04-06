const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { ClaudeMdParser } = require('../src/core/claude-md-parser');

describe('ClaudeMdParser', () => {
  const projectRoot = path.resolve(__dirname, '..');

  it('should parse CLAUDE.md successfully', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const parsed = parser.parse();

    assert.ok(parsed.raw.length > 0);
    assert.ok(Object.keys(parsed.checklists).length > 0);
    assert.ok(parsed.gateRules.length > 0);
    assert.notStrictEqual(parsed.version, 'unknown');
  });

  it('should extract checklist items', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const parsed = parser.parse();

    // Should have the sections defined in our CLAUDE.md
    const sections = Object.keys(parsed.checklists);
    assert.ok(sections.length >= 10, `Expected >= 10 sections, got ${sections.length}`);

    // Each section should have checklist items
    for (const [section, items] of Object.entries(parsed.checklists)) {
      assert.ok(items.length > 0, `Section "${section}" should have checklist items`);
    }
  });

  it('should count total checklist items', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const total = parser.getTotalChecklistItems();
    assert.ok(total > 50, `Expected > 50 checklist items, got ${total}`);
  });

  it('should validate CLAUDE.md', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const validation = parser.validate();

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.issues.length, 0);
    assert.ok(validation.stats.sections > 0);
    assert.ok(validation.stats.totalItems > 0);
  });

  it('should extract gate rules', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const parsed = parser.parse();

    assert.ok(parsed.gateRules.length >= 5, 'Should have multiple gate rules');
    const ruleNames = parsed.gateRules.map(r => r.name);
    assert.ok(ruleNames.includes('ZERO TOLERANCE'));
  });

  it('should extract version', () => {
    const parser = new ClaudeMdParser(projectRoot);
    const parsed = parser.parse();
    assert.strictEqual(parsed.version, '2.0.0');
  });
});
