/**
 * HTML Reporter - Dashboard report for GateTest results.
 * Opens in browser. Shows checklist of broken → fixed items.
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
    const passed = summary.gateStatus === 'PASSED';
    const passRate = summary.checks.total > 0
      ? Math.round((summary.checks.passed / summary.checks.total) * 100)
      : 0;

    // Group all failed checks by severity
    const critical = [];
    const high = [];
    const medium = [];
    const low = [];

    for (const result of summary.results) {
      if (result.status !== 'failed') continue;
      const failedChecks = (result.checks || []).filter(c => !c.passed);
      for (const check of failedChecks) {
        const item = {
          module: result.module,
          name: check.name,
          file: check.file || '',
          line: check.line || '',
          suggestion: check.suggestion || '',
          expected: check.expected,
          actual: check.actual,
        };
        // Classify by module
        if (['secrets', 'security'].includes(result.module)) {
          critical.push(item);
        } else if (['syntax', 'unitTests', 'accessibility'].includes(result.module)) {
          high.push(item);
        } else if (['lint', 'visual', 'performance', 'seo', 'links'].includes(result.module)) {
          medium.push(item);
        } else {
          low.push(item);
        }
      }
    }

    const moduleCards = summary.results.map(r => {
      const isPassed = r.status === 'passed';
      const isSkipped = r.status === 'skipped';
      const statusIcon = isPassed ? '&#10003;' : isSkipped ? '&#8212;' : '&#10007;';
      const statusClass = isPassed ? 'pass' : isSkipped ? 'skip' : 'fail';
      const checkText = `${r.passedChecks}/${r.totalChecks}`;
      return `<div class="module-card ${statusClass}">
        <div class="module-icon">${statusIcon}</div>
        <div class="module-name">${r.module}</div>
        <div class="module-checks">${checkText} checks</div>
      </div>`;
    }).join('');

    const renderChecklist = (items, severity) => {
      if (items.length === 0) return '';
      return items.map(item => {
        const loc = item.file ? `<span class="loc">${item.file}${item.line ? ':' + item.line : ''}</span>` : '';
        const fix = item.suggestion ? `<span class="fix">${item.suggestion}</span>` : '';
        const detail = (item.expected !== undefined)
          ? `<span class="detail">expected: ${item.expected}, got: ${item.actual}</span>`
          : '';
        return `<div class="checklist-item ${severity}">
          <input type="checkbox" class="check-box" />
          <div class="check-content">
            <span class="check-module">${item.module}</span>
            <span class="check-name">${item.name}</span>
            ${loc}${detail}${fix}
          </div>
        </div>`;
      }).join('');
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GateTest Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a1a; color: #e2e8f0; min-height: 100vh;
    }

    /* Header */
    .header {
      background: ${passed ? '#052e16' : '#2a0a0a'};
      border-bottom: 2px solid ${passed ? '#22c55e' : '#ef4444'};
      padding: 1.5rem 2rem;
    }
    .header-row { display: flex; align-items: center; justify-content: space-between; max-width: 1200px; margin: 0 auto; }
    .header h1 { font-size: 1.5rem; color: #fff; }
    .gate-badge {
      font-size: 1.25rem; font-weight: 800; padding: 0.5rem 1.5rem; border-radius: 8px;
      background: ${passed ? '#22c55e' : '#ef4444'}; color: #fff;
      letter-spacing: 0.05em;
    }
    .header-meta { max-width: 1200px; margin: 0.75rem auto 0; display: flex; gap: 2rem; font-size: 0.85rem; color: #94a3b8; }

    /* Stats */
    .stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem;
      max-width: 1200px; margin: 1.5rem auto; padding: 0 2rem;
    }
    .stat {
      background: #111827; border: 1px solid #1e293b; border-radius: 12px;
      padding: 1.25rem; text-align: center;
    }
    .stat-value { font-size: 2rem; font-weight: 800; }
    .stat-value.good { color: #22c55e; }
    .stat-value.bad { color: #ef4444; }
    .stat-value.warn { color: #f59e0b; }
    .stat-label { font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }

    /* Progress bar */
    .progress-wrap { max-width: 1200px; margin: 0 auto 1.5rem; padding: 0 2rem; }
    .progress-bar { height: 8px; background: #1e293b; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
    .progress-label { display: flex; justify-content: space-between; font-size: 0.8rem; color: #64748b; margin-top: 0.5rem; }

    /* Module grid */
    .section { max-width: 1200px; margin: 0 auto 1.5rem; padding: 0 2rem; }
    .section-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem; color: #fff; }
    .module-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; }
    .module-card {
      background: #111827; border: 1px solid #1e293b; border-radius: 10px;
      padding: 1rem; text-align: center; transition: transform 0.15s;
    }
    .module-card:hover { transform: translateY(-2px); }
    .module-card.pass { border-color: #166534; }
    .module-card.fail { border-color: #991b1b; }
    .module-card.skip { border-color: #78350f; opacity: 0.6; }
    .module-icon { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .module-card.pass .module-icon { color: #22c55e; }
    .module-card.fail .module-icon { color: #ef4444; }
    .module-card.skip .module-icon { color: #f59e0b; }
    .module-name { font-size: 0.85rem; font-weight: 600; }
    .module-checks { font-size: 0.75rem; color: #64748b; margin-top: 0.25rem; }

    /* Checklist */
    .checklist { display: flex; flex-direction: column; gap: 0.5rem; }
    .severity-header {
      font-size: 0.85rem; font-weight: 700; padding: 0.5rem 0.75rem;
      border-radius: 6px; margin-top: 0.5rem;
    }
    .severity-header.critical { background: #450a0a; color: #fca5a5; }
    .severity-header.high { background: #451a03; color: #fdba74; }
    .severity-header.medium { background: #422006; color: #fcd34d; }
    .severity-header.low { background: #1e293b; color: #94a3b8; }
    .checklist-item {
      display: flex; align-items: flex-start; gap: 0.75rem;
      background: #111827; border: 1px solid #1e293b; border-radius: 8px;
      padding: 0.75rem 1rem; transition: opacity 0.3s;
    }
    .checklist-item.checked { opacity: 0.4; text-decoration: line-through; }
    .check-box {
      width: 18px; height: 18px; margin-top: 2px; cursor: pointer;
      accent-color: #22c55e; flex-shrink: 0;
    }
    .check-content { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
    .check-module {
      font-size: 0.7rem; font-weight: 600; color: #6366f1;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .check-name { font-size: 0.85rem; color: #e2e8f0; word-break: break-word; }
    .loc { font-size: 0.75rem; color: #64748b; font-family: monospace; }
    .detail { font-size: 0.75rem; color: #f59e0b; }
    .fix { font-size: 0.75rem; color: #22d3ee; font-style: italic; }
    .checklist-item.critical { border-left: 3px solid #ef4444; }
    .checklist-item.high { border-left: 3px solid #f97316; }
    .checklist-item.medium { border-left: 3px solid #eab308; }
    .checklist-item.low { border-left: 3px solid #64748b; }

    /* Counter */
    .counter-bar {
      position: sticky; bottom: 0; background: #111827; border-top: 1px solid #1e293b;
      padding: 1rem 2rem; text-align: center; font-size: 0.9rem;
    }
    .counter-bar span { font-weight: 700; color: #22c55e; }

    .footer { text-align: center; padding: 2rem; color: #475569; font-size: 0.75rem; }

    @media (max-width: 768px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .module-grid { grid-template-columns: repeat(3, 1fr); }
      .header-row { flex-direction: column; gap: 0.75rem; text-align: center; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-row">
      <h1>GateTest Dashboard</h1>
      <div class="gate-badge">${passed ? 'PASSED' : 'BLOCKED'}</div>
    </div>
    <div class="header-meta">
      <span>${summary.timestamp}</span>
      <span>${summary.duration}ms</span>
      <span>${summary.modules.total} modules</span>
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value ${passRate >= 80 ? 'good' : passRate >= 50 ? 'warn' : 'bad'}">${passRate}%</div>
      <div class="stat-label">Pass Rate</div>
    </div>
    <div class="stat">
      <div class="stat-value ${summary.modules.failed === 0 ? 'good' : 'bad'}">${summary.modules.passed}/${summary.modules.total}</div>
      <div class="stat-label">Modules Passed</div>
    </div>
    <div class="stat">
      <div class="stat-value bad">${summary.checks.failed}</div>
      <div class="stat-label">Issues Found</div>
    </div>
    <div class="stat">
      <div class="stat-value good">${summary.checks.passed}</div>
      <div class="stat-label">Checks Passed</div>
    </div>
  </div>

  <div class="progress-wrap">
    <div class="progress-bar">
      <div class="progress-fill" style="width:${passRate}%;background:${passRate >= 80 ? '#22c55e' : passRate >= 50 ? '#f59e0b' : '#ef4444'};"></div>
    </div>
    <div class="progress-label">
      <span>${summary.checks.passed} passed</span>
      <span>${summary.checks.failed} remaining</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Modules</div>
    <div class="module-grid">${moduleCards}</div>
  </div>

  <div class="section">
    <div class="section-title">Issues Checklist</div>
    <div class="checklist">
      ${critical.length > 0 ? `<div class="severity-header critical">CRITICAL (${critical.length})</div>${renderChecklist(critical, 'critical')}` : ''}
      ${high.length > 0 ? `<div class="severity-header high">HIGH (${high.length})</div>${renderChecklist(high, 'high')}` : ''}
      ${medium.length > 0 ? `<div class="severity-header medium">MEDIUM (${medium.length})</div>${renderChecklist(medium, 'medium')}` : ''}
      ${low.length > 0 ? `<div class="severity-header low">LOW (${low.length})</div>${renderChecklist(low, 'low')}` : ''}
      ${(critical.length + high.length + medium.length + low.length) === 0 ? '<div style="text-align:center;padding:2rem;color:#22c55e;font-size:1.25rem;font-weight:700;">All clear! No issues found.</div>' : ''}
    </div>
  </div>

  <div class="footer">GateTest v1.0.0 — Nothing ships unless it's pristine.</div>

  <div class="counter-bar" id="counter">
    <span id="fixed-count">0</span> / ${summary.checks.failed} issues marked as fixed
  </div>

  <script>
    // Interactive checklist — tick items off as you fix them
    const checkboxes = document.querySelectorAll('.check-box');
    const counterEl = document.getElementById('fixed-count');
    let fixedCount = 0;

    // Load saved state
    const saved = JSON.parse(localStorage.getItem('gatetest-checked') || '{}');
    checkboxes.forEach((cb, i) => {
      if (saved[i]) {
        cb.checked = true;
        cb.closest('.checklist-item').classList.add('checked');
        fixedCount++;
      }
      cb.addEventListener('change', () => {
        const item = cb.closest('.checklist-item');
        if (cb.checked) {
          item.classList.add('checked');
          fixedCount++;
        } else {
          item.classList.remove('checked');
          fixedCount--;
        }
        counterEl.textContent = fixedCount;
        // Save state
        const state = {};
        checkboxes.forEach((c, j) => { if (c.checked) state[j] = true; });
        localStorage.setItem('gatetest-checked', JSON.stringify(state));
      });
    });
    counterEl.textContent = fixedCount;
  </script>
</body>
</html>`;
  }
}

module.exports = { HtmlReporter };
