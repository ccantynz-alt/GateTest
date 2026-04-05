/**
 * CLAUDE.md Parser - Reads and enforces the CLAUDE.md checklist.
 * This is the single source of truth. Every build reads this file.
 */

const fs = require('fs');
const path = require('path');

class ClaudeMdParser {
  constructor(projectRoot) {
    this.projectRoot = projectRoot || process.cwd();
    this.filePath = path.join(this.projectRoot, 'CLAUDE.md');
  }

  parse() {
    if (!fs.existsSync(this.filePath)) {
      throw new Error(
        `CLAUDE.md not found at ${this.filePath}. ` +
        'GateTest requires a CLAUDE.md file. Run "gatetest init" to create one.'
      );
    }

    const content = fs.readFileSync(this.filePath, 'utf-8');
    return {
      raw: content,
      checklists: this._extractChecklists(content),
      thresholds: this._extractThresholds(content),
      gateRules: this._extractGateRules(content),
      version: this._extractVersion(content),
    };
  }

  _extractChecklists(content) {
    const checklists = {};
    let currentSection = null;

    for (const line of content.split('\n')) {
      // Match section headers (### N. Title)
      const sectionMatch = line.match(/^###\s+\d+\.\s+(.+)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        checklists[currentSection] = [];
        continue;
      }

      // Match checklist items (- [ ] or - [x])
      const checkMatch = line.match(/^-\s+\[([ x])\]\s+(.+)/);
      if (checkMatch && currentSection) {
        checklists[currentSection].push({
          checked: checkMatch[1] === 'x',
          text: checkMatch[2].trim(),
          section: currentSection,
        });
      }
    }

    return checklists;
  }

  _extractThresholds(content) {
    const thresholds = {};
    const tablePattern = /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/g;
    let match;

    while ((match = tablePattern.exec(content)) !== null) {
      const [, metric, minimum, target] = match;
      if (metric.includes('---') || metric.includes('Metric')) continue;

      thresholds[metric.trim()] = {
        minimum: minimum.trim(),
        target: target.trim(),
      };
    }

    return thresholds;
  }

  _extractGateRules(content) {
    const rules = [];
    const rulePattern = /^\d+\.\s+\*\*(.+?)\*\*:\s*(.+)/gm;
    let match;

    while ((match = rulePattern.exec(content)) !== null) {
      rules.push({
        name: match[1].trim(),
        description: match[2].trim(),
      });
    }

    return rules;
  }

  _extractVersion(content) {
    const versionMatch = content.match(/GateTest\s+v([\d.]+)/);
    return versionMatch ? versionMatch[1] : 'unknown';
  }

  getTotalChecklistItems() {
    const parsed = this.parse();
    let total = 0;
    for (const items of Object.values(parsed.checklists)) {
      total += items.length;
    }
    return total;
  }

  validate() {
    const parsed = this.parse();
    const issues = [];

    if (Object.keys(parsed.checklists).length === 0) {
      issues.push('No checklists found in CLAUDE.md');
    }

    if (parsed.gateRules.length === 0) {
      issues.push('No gate rules found in CLAUDE.md');
    }

    if (parsed.version === 'unknown') {
      issues.push('No version found in CLAUDE.md');
    }

    return {
      valid: issues.length === 0,
      issues,
      stats: {
        sections: Object.keys(parsed.checklists).length,
        totalItems: this.getTotalChecklistItems(),
        gateRules: parsed.gateRules.length,
        version: parsed.version,
      },
    };
  }
}

module.exports = { ClaudeMdParser };
