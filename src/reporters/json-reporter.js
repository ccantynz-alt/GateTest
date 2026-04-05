/**
 * JSON Reporter - Produces machine-readable reports for CI/CD integration.
 */

const fs = require('fs');
const path = require('path');

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
        version: '1.0.0',
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
    };

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

    // Also write a "latest" symlink / copy
    const latestPath = path.join(absDir, 'gatetest-report-latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  }
}

module.exports = { JsonReporter };
