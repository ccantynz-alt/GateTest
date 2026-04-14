/**
 * Memory Module — the compounding moat.
 *
 * Loads persistent memory, ingests the previous scan's report, detects the
 * current repo fingerprint, and exposes everything to downstream modules
 * via `config._memory`. Records info-severity checks summarising what
 * memory knows so humans (and AI) can see the trajectory.
 *
 * This module is intentionally non-blocking: it never fails the gate. Its
 * job is to make every OTHER module smarter.
 *
 * TODO(gluecron): once Gluecron exposes a cross-mirror memory endpoint,
 * pull upstream memory here before local ingest.
 */

const BaseModule = require('./base-module');
const { MemoryStore } = require('../core/memory');

class MemoryModule extends BaseModule {
  constructor() {
    super('memory', 'Codebase Memory — compounding intelligence across scans');
  }

  async run(result, config) {
    const store = new MemoryStore(config.projectRoot);

    // 1. Ingest the previous scan's report (if any) so history grows
    //    each run. Safe on first run — returns { scanIngested: false }.
    let ingest = { scanIngested: false, newIssues: 0 };
    try {
      ingest = store.ingestLatestReport();
    } catch (err) {
      result.addCheck('memory:ingest-error', true, {
        severity: 'info',
        message: `Memory ingest skipped: ${err.message}`,
      });
    }

    // 2. Detect current fingerprint and record any stack drift.
    const previous = store.load();
    const fingerprint = store.detectFingerprint();

    if (previous.fingerprint) {
      const prevLangs = Object.keys(previous.fingerprint.languages || {}).sort().join(',');
      const nowLangs = Object.keys(fingerprint.languages || {}).sort().join(',');
      if (prevLangs && prevLangs !== nowLangs) {
        result.addCheck('memory:stack-drift', true, {
          severity: 'warning',
          message: `Stack drift detected — languages changed from [${prevLangs}] to [${nowLangs}]`,
          suggestion: 'If intentional, this is fine. If unintentional, investigate.',
        });
      }
    }

    // 3. Surface recurring issues — signal that rules alone aren't catching
    //    a real root cause.
    const recurring = store.getRecurringIssues(3);
    if (recurring.length > 0) {
      const top = recurring.slice(0, 5);
      for (const item of top) {
        result.addCheck(`memory:recurring:${item.key}`, true, {
          severity: 'warning',
          message: `Recurring issue across ${item.count} scans: ${item.key}`,
          suggestion: 'Consider dismissing as false positive, or fixing at the root so it stops appearing.',
        });
      }
    }

    // 4. Summary line — info only, always present.
    const summary = this._buildSummary(previous, fingerprint, ingest, recurring);
    result.addCheck('memory:summary', true, {
      severity: 'info',
      message: summary,
    });

    // 5. Expose memory to downstream modules. This is the moat:
    //    agentic modules can condition their exploration on history.
    config._memory = {
      store,
      fingerprint,
      previous,
      recurring,
    };
  }

  _buildSummary(previous, fingerprint, ingest, recurring) {
    const scanCount = previous.scans?.totalScans || 0;
    const issueCount = previous.issues?.length || 0;
    const langs = Object.keys(fingerprint.languages || {}).join(', ') || 'none detected';
    const frameworks = (fingerprint.frameworks || []).join(', ') || 'none';
    const ingestMsg = ingest.scanIngested
      ? ` Ingested ${ingest.newIssues} new issue(s) from last scan.`
      : '';
    const recurringMsg = recurring.length > 0
      ? ` ${recurring.length} recurring issue pattern(s) tracked.`
      : '';
    return `Memory: ${scanCount} scan(s) tracked, ${issueCount} issue(s) in history, languages=[${langs}], frameworks=[${frameworks}].${ingestMsg}${recurringMsg}`;
  }
}

module.exports = MemoryModule;
