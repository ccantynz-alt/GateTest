/**
 * GateTest Session Ledger — Cross-Account Session Continuity
 *
 * The problem: Power users run multiple Claude accounts (to maximize usage
 * quotas) and lose all project context when switching. The Session Ledger
 * persists project state in the repo itself — the one thing that doesn't
 * change when you switch accounts.
 *
 * How it works:
 *   1. After every scan, the ledger auto-snapshots project state
 *   2. `gatetest --resume` prints a briefing for the new session
 *   3. State is written into CLAUDE.md so any Claude session auto-loads it
 *
 * Storage:
 *   .gatetest/session-ledger.json   — Current state (latest snapshot)
 *   .gatetest/session-history/      — Rolling log of past sessions
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SessionLedger {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.ledgerPath = path.join(projectRoot, '.gatetest', 'session-ledger.json');
    this.historyDir = path.join(projectRoot, '.gatetest', 'session-history');
    this.maxHistory = 50;
  }

  /**
   * Take a snapshot of current project state.
   * Called automatically after every GateTest scan.
   */
  snapshot(scanSummary = null) {
    const state = {
      timestamp: new Date().toISOString(),
      sessionId: this._generateSessionId(),
      git: this._captureGitState(),
      scan: scanSummary ? this._extractScanState(scanSummary) : null,
      files: this._captureFileState(),
      tasks: this._captureTasks(),
    };

    this._ensureDirs();

    // Write current ledger
    fs.writeFileSync(this.ledgerPath, JSON.stringify(state, null, 2));

    // Append to history
    const historyFile = path.join(
      this.historyDir,
      `session-${state.timestamp.replace(/[:.]/g, '-')}.json`
    );
    fs.writeFileSync(historyFile, JSON.stringify(state, null, 2));

    // Prune old history
    this._pruneHistory();

    return state;
  }

  /**
   * Load the latest session state.
   */
  load() {
    if (!fs.existsSync(this.ledgerPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.ledgerPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Load full session history (newest first).
   */
  loadHistory() {
    if (!fs.existsSync(this.historyDir)) return [];
    const files = fs.readdirSync(this.historyDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.historyDir, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Generate a human-readable resume briefing for a new session.
   */
  generateResumeBriefing() {
    const state = this.load();
    if (!state) {
      return {
        text: 'No previous session found. Run `gatetest` to start tracking.',
        state: null,
      };
    }

    const lines = [];
    lines.push('GateTest Session Resume');
    lines.push('─'.repeat(40));
    lines.push('');

    // Time since last session
    const elapsed = this._timeSince(state.timestamp);
    lines.push(`Last session: ${state.timestamp} (${elapsed} ago)`);
    lines.push('');

    // Git state
    if (state.git) {
      lines.push(`Branch:      ${state.git.branch}`);
      if (state.git.lastCommit) {
        lines.push(`Last commit: "${state.git.lastCommit.message}"`);
        lines.push(`             ${state.git.lastCommit.sha}`);
      }
      if (state.git.uncommittedCount > 0) {
        lines.push(`Uncommitted: ${state.git.uncommittedCount} file(s) modified`);
        for (const f of state.git.uncommittedFiles.slice(0, 10)) {
          lines.push(`             ${f}`);
        }
        if (state.git.uncommittedFiles.length > 10) {
          lines.push(`             ... and ${state.git.uncommittedFiles.length - 10} more`);
        }
      } else {
        lines.push('Uncommitted: Clean working tree');
      }
      lines.push('');
    }

    // Scan results
    if (state.scan) {
      const s = state.scan;
      if (s.gateStatus === 'PASSED') {
        lines.push(`Last scan:   PASSED (${s.checksPassed}/${s.checksTotal} checks)`);
      } else {
        lines.push(`Last scan:   BLOCKED (${s.failedCount} issues)`);
        if (s.failures && s.failures.length > 0) {
          for (const f of s.failures.slice(0, 10)) {
            lines.push(`  - ${f.module}: ${f.error}`);
          }
        }
      }
      lines.push('');
    }

    // Active tasks
    if (state.tasks && state.tasks.length > 0) {
      lines.push('Active tasks:');
      for (const task of state.tasks) {
        const icon = task.done ? '[x]' : '[ ]';
        lines.push(`  ${icon} ${task.description}`);
      }
      lines.push('');
    }

    // Suggested next steps
    const steps = this._suggestNextSteps(state);
    if (steps.length > 0) {
      lines.push('Suggested next steps:');
      steps.forEach((step, i) => {
        lines.push(`  ${i + 1}. ${step}`);
      });
      lines.push('');
    }

    return {
      text: lines.join('\n'),
      state,
    };
  }

  /**
   * Generate a CLAUDE.md-compatible section for auto-injection.
   */
  generateClaudeMdSection() {
    const state = this.load();
    if (!state) return '';

    const lines = [];
    lines.push('## SESSION CONTINUITY (auto-generated by GateTest)');
    lines.push('');
    lines.push('> This section is auto-updated after every GateTest scan.');
    lines.push('> It ensures context is preserved when switching between Claude accounts.');
    lines.push('');
    lines.push(`**Last session:** ${state.timestamp}`);

    if (state.git) {
      lines.push(`**Branch:** ${state.git.branch}`);
      if (state.git.lastCommit) {
        lines.push(`**Last commit:** ${state.git.lastCommit.message} (${state.git.lastCommit.sha.slice(0, 7)})`);
      }
      if (state.git.uncommittedCount > 0) {
        lines.push(`**Uncommitted changes:** ${state.git.uncommittedCount} files`);
      }
    }

    if (state.scan) {
      lines.push(`**Last scan:** ${state.scan.gateStatus} — ${state.scan.checksPassed}/${state.scan.checksTotal} checks passed`);
      if (state.scan.failures && state.scan.failures.length > 0) {
        lines.push('');
        lines.push('**Outstanding issues:**');
        for (const f of state.scan.failures.slice(0, 15)) {
          lines.push(`- [ ] **${f.module}**: ${f.error}`);
        }
      }
    }

    if (state.tasks && state.tasks.length > 0) {
      lines.push('');
      lines.push('**Active tasks:**');
      for (const t of state.tasks) {
        const check = t.done ? 'x' : ' ';
        lines.push(`- [${check}] ${t.description}`);
      }
    }

    const steps = this._suggestNextSteps(state);
    if (steps.length > 0) {
      lines.push('');
      lines.push('**Suggested next steps:**');
      steps.forEach((step, i) => {
        lines.push(`${i + 1}. ${step}`);
      });
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Inject session state into CLAUDE.md file.
   */
  injectIntoClaudeMd() {
    const section = this.generateClaudeMdSection();
    if (!section) return false;

    const claudeMdPath = path.join(this.projectRoot, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) return false;

    let content = fs.readFileSync(claudeMdPath, 'utf-8');

    const startMarker = '## SESSION CONTINUITY (auto-generated by GateTest)';
    const endMarker = '<!-- END SESSION CONTINUITY -->';

    const startIdx = content.indexOf(startMarker);
    if (startIdx !== -1) {
      const endIdx = content.indexOf(endMarker, startIdx);
      if (endIdx !== -1) {
        content = content.slice(0, startIdx) + section + endMarker + '\n' + content.slice(endIdx + endMarker.length);
      } else {
        // Find next ## heading after our section
        const afterStart = content.slice(startIdx + startMarker.length);
        const nextHeading = afterStart.search(/\n## [^#]/);
        if (nextHeading !== -1) {
          content = content.slice(0, startIdx) + section + endMarker + '\n\n' + content.slice(startIdx + startMarker.length + nextHeading + 1);
        } else {
          content = content.slice(0, startIdx) + section + endMarker + '\n';
        }
      }
    } else {
      // Append before the last --- separator, or at the end
      const lastSep = content.lastIndexOf('\n---\n');
      if (lastSep !== -1) {
        content = content.slice(0, lastSep) + '\n\n' + section + endMarker + '\n' + content.slice(lastSep);
      } else {
        content += '\n\n' + section + endMarker + '\n';
      }
    }

    fs.writeFileSync(claudeMdPath, content);
    return true;
  }

  // ─── Internal Helpers ────────────────────────────────────

  _captureGitState() {
    try {
      const branch = this._git('rev-parse --abbrev-ref HEAD');
      const sha = this._git('rev-parse HEAD');
      const message = this._git('log -1 --format=%s');
      const author = this._git('log -1 --format=%an');

      const statusRaw = this._git('status --porcelain');
      const uncommittedFiles = statusRaw
        ? statusRaw.split('\n').map(l => l.trim()).filter(Boolean)
        : [];

      return {
        branch,
        lastCommit: { sha, message, author },
        uncommittedCount: uncommittedFiles.length,
        uncommittedFiles: uncommittedFiles.map(l => l.slice(3)), // strip status prefix
      };
    } catch {
      return null;
    }
  }

  _extractScanState(summary) {
    return {
      gateStatus: summary.gateStatus,
      checksPassed: summary.checks?.passed || 0,
      checksTotal: summary.checks?.total || 0,
      failedCount: summary.checks?.failed || 0,
      modulesPassed: summary.modules?.passed || 0,
      modulesTotal: summary.modules?.total || 0,
      duration: summary.duration,
      failures: (summary.failedModules || []).map(f => ({
        module: f.module,
        error: String(f.error).slice(0, 200),
      })),
    };
  }

  _captureFileState() {
    try {
      const recentRaw = this._git('log -5 --name-only --format=""');
      const recentFiles = [...new Set(
        recentRaw.split('\n').map(l => l.trim()).filter(Boolean)
      )].slice(0, 20);

      return { recentlyChanged: recentFiles };
    } catch {
      return { recentlyChanged: [] };
    }
  }

  _captureTasks() {
    // Look for TODO/FIXME in recently changed files
    const tasks = [];
    try {
      const grepResult = this._git('grep -n "TODO\\|FIXME" -- "*.js" "*.ts" "*.tsx"');
      const lines = grepResult.split('\n').filter(Boolean).slice(0, 20);
      for (const line of lines) {
        const match = line.match(/^(.+?):(\d+):\s*.*(?:TODO|FIXME)[:\s]*(.+)/i);
        if (match) {
          tasks.push({
            file: match[1],
            line: parseInt(match[2]),
            description: match[3].trim().slice(0, 120),
            done: false,
          });
        }
      }
    } catch {
      // No TODOs found — that's fine
    }
    return tasks;
  }

  _suggestNextSteps(state) {
    const steps = [];

    if (state.git?.uncommittedCount > 0) {
      steps.push(`Commit ${state.git.uncommittedCount} uncommitted file(s)`);
    }

    if (state.scan?.gateStatus === 'BLOCKED' && state.scan.failures) {
      for (const f of state.scan.failures.slice(0, 3)) {
        steps.push(`Fix ${f.module}: ${f.error.slice(0, 80)}`);
      }
    }

    if (state.tasks?.length > 0) {
      const pending = state.tasks.filter(t => !t.done);
      if (pending.length > 0) {
        steps.push(`Resolve ${pending.length} TODO/FIXME item(s)`);
      }
    }

    if (steps.length === 0 && state.scan?.gateStatus === 'PASSED') {
      steps.push('All checks passed — ready to push');
    }

    return steps;
  }

  _timeSince(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  _generateSessionId() {
    return `gts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _ensureDirs() {
    for (const dir of [path.dirname(this.ledgerPath), this.historyDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  _pruneHistory() {
    if (!fs.existsSync(this.historyDir)) return;
    const files = fs.readdirSync(this.historyDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    while (files.length > this.maxHistory) {
      const oldest = files.shift();
      try {
        fs.unlinkSync(path.join(this.historyDir, oldest));
      } catch {
        // ignore cleanup errors
      }
    }
  }

  _git(command) {
    return execSync(`git ${command}`, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
}

module.exports = { SessionLedger };
