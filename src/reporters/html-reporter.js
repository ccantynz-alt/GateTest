/**
 * HTML Reporter - Produces a visual HTML report for GateTest results.
 */

const fs = require('fs');
const path = require('path');

class HtmlReporter {
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
    const filename = `gatetest-report-${timestamp}.html`;
    const filepath = path.join(absDir, filename);

    const html = this._generateHtml(summary);
    fs.writeFileSync(filepath, html);

    const latestPath = path.join(absDir, 'gatetest-report-latest.html');
    fs.writeFileSync(latestPath, html);
  }

  _generateHtml(summary) {
    const statusColor = summary.gateStatus === 'PASSED' ? '#22c55e' : '#ef4444';
    const statusBg = summary.gateStatus === 'PASSED' ? '#f0fdf4' : '#fef2f2';

    const moduleRows = summary.results.map(r => {
      const statusIcon = r.status === 'passed' ? '&#10003;' : r.status === 'failed' ? '&#10007;' : '&#8212;';
      const rowColor = r.status === 'passed' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#f59e0b';
      return `
        <tr>
          <td style="color:${rowColor};font-weight:bold;">${statusIcon}</td>
          <td>${r.module}</td>
          <td>${r.status.toUpperCase()}</td>
          <td>${r.passedChecks}/${r.totalChecks}</td>
          <td>${r.duration}ms</td>
          <td>${r.error || ''}</td>
        </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GateTest Report - ${summary.timestamp}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    .gate-status { padding: 1rem 2rem; border-radius: 8px; background: ${statusBg}; border: 2px solid ${statusColor}; margin-bottom: 2rem; }
    .gate-status h2 { color: ${statusColor}; font-size: 2rem; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: white; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0; text-align: center; }
    .stat .value { font-size: 1.5rem; font-weight: bold; }
    .stat .label { font-size: 0.875rem; color: #64748b; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    th { background: #f1f5f9; padding: 0.75rem; text-align: left; font-size: 0.875rem; color: #475569; }
    td { padding: 0.75rem; border-top: 1px solid #e2e8f0; font-size: 0.875rem; }
    .footer { margin-top: 2rem; color: #94a3b8; font-size: 0.75rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>GateTest Quality Report</h1>
    <div class="gate-status">
      <h2>GATE: ${summary.gateStatus}</h2>
      <p>${summary.timestamp}</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="value">${summary.modules.passed}/${summary.modules.total}</div><div class="label">Modules Passed</div></div>
      <div class="stat"><div class="value">${summary.checks.passed}/${summary.checks.total}</div><div class="label">Checks Passed</div></div>
      <div class="stat"><div class="value">${summary.duration}ms</div><div class="label">Duration</div></div>
      <div class="stat"><div class="value">${summary.failedModules.length}</div><div class="label">Failures</div></div>
    </div>
    <table>
      <thead><tr><th></th><th>Module</th><th>Status</th><th>Checks</th><th>Duration</th><th>Details</th></tr></thead>
      <tbody>${moduleRows}</tbody>
    </table>
    <div class="footer">GateTest v1.0.0 — Nothing ships unless it's pristine.</div>
  </div>
</body>
</html>`;
  }
}

module.exports = { HtmlReporter };
