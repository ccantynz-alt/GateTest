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

    // 4. Surface fix intelligence — patterns GateTest has auto-fixed in
    //    this repo before. Downstream modules (aiReview, agentic) can
    //    condition their suggestions on these known-good fixes; the human
    //    gets a quick reminder of what the gate has quietly handled.
    const fixPatterns = store.getFixPatterns();
    const topFixPatterns = this._topFixPatterns(fixPatterns, 5);
    if (topFixPatterns.length > 0) {
      for (const p of topFixPatterns) {
        result.addCheck(`memory:fix-pattern:${p.key}`, true, {
          severity: 'info',
          message: `Fix-pattern known: ${p.key} — auto-fixed ${p.count} time(s) in this repo`,
          suggestion: p.lastDescription
            ? `Last fix: ${p.lastDescription}`
            : undefined,
        });
      }
    }

    // 5. Summary line — info only, always present.
    const summary = this._buildSummary(previous, fingerprint, ingest, recurring, topFixPatterns);
    result.addCheck('memory:summary', true, {
      severity: 'info',
      message: summary,
    });

    // 6. Expose memory to downstream modules. This is the moat:
    //    agentic modules can condition their exploration on history.
    config._memory = {
      store,
      fingerprint,
      previous,
      recurring,
      fixPatterns,
      topFixPatterns,
    };
  }

  _topFixPatterns(db, limit) {
    const patterns = (db && db.patterns) || {};
    return Object.entries(patterns)
      .map(([key, value]) => ({
        key,
        count: value.count || 0,
        lastAt: value.lastAt || null,
        lastDescription: value.examples && value.examples[0] ? value.examples[0].description : null,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  _buildSummary(previous, fingerprint, ingest, recurring, topFixPatterns) {
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
    const fixMsg = topFixPatterns && topFixPatterns.length > 0
      ? ` ${topFixPatterns.length} known fix-pattern(s) from prior auto-fix history.`
      : '';
    return `Memory: ${scanCount} scan(s) tracked, ${issueCount} issue(s) in history, languages=[${langs}], frameworks=[${frameworks}].${ingestMsg}${recurringMsg}${fixMsg}`;
  }
}

module.exports = MemoryModule;
