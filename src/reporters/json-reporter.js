/**
 * JSON Reporter - Produces machine-readable reports for CI/CD integration.
 */

const fs = require('fs');
const path = require('path');
// Tool version, grouped with the run's timestamp and gateStatus. It read
// '1.0.0' regardless of what actually ran. Nothing consumes this field
// (consumers read gateStatus/timestamp) and no schema version is documented,
// so deriving it makes it meaningful rather than decorative.
const PKG_VERSION = require('../../package.json').version;

class JsonReporter {
  constructor(runner, config) {
    this.runner = runner;
    this.config = config;
    this._attach();
  }

  _attach() {
    this.runner.on('suite:end', (summary) => this._onSuiteEnd(summary));
  }

  _onSuiteEnd(summary) {
    const reportDir = this.config.get('reporting.outputDir') || '.gatetest/reports';
    const absDir = path.resolve(this.config.projectRoot, reportDir);

    if (!fs.existsSync(absDir)) {
      fs.mkdirSync(absDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `gatetest-report-${timestamp}.json`;
    const filepath = path.join(absDir, filename);

    const report = {
      gatetest: {
        version: PKG_VERSION,
        timestamp: summary.timestamp,
        gateStatus: summary.gateStatus,
      },
      summary: {
        duration: summary.duration,
        modules: summary.modules,
        checks: summary.checks,
      },
      results: summary.results,
      failures: summary.failedModules,
      // Ranked, cross-module-deduped view (src/core/finding-registry.js).
      // Counts in `summary.checks` are the gate's truth; this is what to
      // SHOW — consumers should render `findings` and mention
      // `findingSummary.duplicatesCollapsed` / `.hiddenLowConfidence`.
      findings: Array.isArray(summary.findings) ? summary.findings : [],
      findingSummary: summary.findingSummary || null,
    };

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    // Also write a "latest" symlink / copy
    const latestPath = path.join(absDir, 'gatetest-report-latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  }
}

module.exports = { JsonReporter };
