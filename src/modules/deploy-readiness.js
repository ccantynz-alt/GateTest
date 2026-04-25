/**
 * Deploy Readiness Score — aggregate 0-100 confidence score.
 *
 * Converts the binary pass/fail gate into a nuanced confidence score
 * that answers: "How ready is this code to ship?"
 *
 * Score formula:
 *   Base: 100
 *   Each error check failure:   -5 points (max -40)
 *   Each warning check failure: -1 point  (max -15)
 *   Critical security errors:   -10 points each (uncapped)
 *   Missing test coverage:      -5 per uncovered module (max -15)
 *   Bonus: all tests pass +5, zero warnings +3
 *
 * Score bands:
 *   90-100 → SHIP IT — all clear
 *   75-89  → LOW RISK — minor issues, review recommended
 *   50-74  → MEDIUM RISK — significant issues, fix before shipping
 *   25-49  → HIGH RISK — critical issues present
 *   0-24   → DO NOT SHIP — multiple critical failures
 *
 * This module runs LAST in the suite (it reads all other module results).
 * In the runner, it receives the full results array via config._allResults.
 */

'use strict';

const BaseModule = require('./base-module');

// ─── scoring constants ─────────────────────────────────────────────────────

const POINTS = {
  errorPenalty:        -5,
  warningPenalty:      -1,
  criticalPenalty:     -10,
  missingTestPenalty:  -5,
  allPassBonus:        +5,
  zeroWarningBonus:    +3,
  maxErrorPenalty:     -40,
  maxWarningPenalty:   -15,
  maxTestPenalty:      -15,
};

// Security-critical check names that get the extra penalty
const CRITICAL_CHECK_PREFIXES = [
  'secrets:', 'security:', 'auth-bypass:', 'webhook-payload:unvalidated',
  'tls-security:', 'cookie-security:', 'ssrf:', 'cross-file-taint:',
  'sql-migrations:blocking', 'hardcoded-url:private',
];

function isCritical(checkName) {
  return CRITICAL_CHECK_PREFIXES.some(p => checkName.startsWith(p));
}

// ─── score bands ──────────────────────────────────────────────────────────

function scoreBand(score) {
  if (score >= 90) return { label: 'SHIP IT',       emoji: '✅', level: 'pass'    };
  if (score >= 75) return { label: 'LOW RISK',      emoji: '🟡', level: 'warning' };
  if (score >= 50) return { label: 'MEDIUM RISK',   emoji: '🟠', level: 'warning' };
  if (score >= 25) return { label: 'HIGH RISK',     emoji: '🔴', level: 'error'   };
  return               { label: 'DO NOT SHIP',   emoji: '🚫', level: 'error'   };
}

// ─── module ────────────────────────────────────────────────────────────────

class DeployReadiness extends BaseModule {
  constructor() {
    super('deployReadiness', 'Deploy Readiness Score — aggregate 0-100 deployment confidence score');
  }

  async run(result, config) {
    // Collect all prior module results
    const allResults = config._allResults || [];

    if (allResults.length === 0) {
      result.addCheck('deploy-readiness:no-data', true, {
        severity: 'info',
        message: 'No prior module results available — deploy readiness score requires full suite run',
      });
      return;
    }

    // Gather all checks across all modules (excluding this module itself)
    const allChecks = allResults
      .filter(r => r.module !== 'deployReadiness')
      .flatMap(r => r.checks || []);

    const errorChecks   = allChecks.filter(c => !c.passed && c.severity === 'error');
    const warningChecks = allChecks.filter(c => !c.passed && c.severity === 'warning');
    const criticalChecks = errorChecks.filter(c => isCritical(c.name || ''));

    // Modules with no tests (skipped modules = potential coverage gaps)
    const skippedModules = allResults.filter(r => r.status === 'skipped').length;

    // Calculate score
    let score = 100;

    // Error penalty (capped)
    const errorPenalty = Math.max(
      errorChecks.length * POINTS.errorPenalty,
      POINTS.maxErrorPenalty
    );
    score += errorPenalty;

    // Warning penalty (capped)
    const warnPenalty = Math.max(
      warningChecks.length * POINTS.warningPenalty,
      POINTS.maxWarningPenalty
    );
    score += warnPenalty;

    // Critical security penalty (uncapped — security is always priority)
    score += criticalChecks.length * POINTS.criticalPenalty;

    // Missing test penalty
    const testPenalty = Math.max(
      skippedModules * POINTS.missingTestPenalty,
      POINTS.maxTestPenalty
    );
    score += testPenalty;

    // Bonuses
    if (errorChecks.length === 0 && warningChecks.length === 0) {
      score += POINTS.allPassBonus;
    } else if (errorChecks.length === 0) {
      score += POINTS.allPassBonus;
      if (warningChecks.length === 0) score += POINTS.zeroWarningBonus;
    }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    const band = scoreBand(score);

    // Top blocking issues
    const topIssues = [
      ...criticalChecks.slice(0, 3).map(c => `[CRITICAL] ${c.name}`),
      ...errorChecks.filter(c => !isCritical(c.name || '')).slice(0, 3).map(c => `[ERROR] ${c.name}`),
      ...warningChecks.slice(0, 2).map(c => `[WARN] ${c.name}`),
    ].slice(0, 8);

    const passed = band.level === 'pass';

    // Main score check
    result.addCheck('deploy-readiness:score', passed, {
      severity: passed ? 'info' : (band.level === 'warning' ? 'warning' : 'error'),
      message: `${band.emoji} Deploy Readiness: ${score}/100 — ${band.label}`,
      details: {
        score,
        band: band.label,
        errors: errorChecks.length,
        warnings: warningChecks.length,
        critical: criticalChecks.length,
        skippedModules,
        topIssues,
      },
      fix: topIssues.length > 0
        ? `Resolve the top blocking issues: ${topIssues.slice(0, 3).join(', ')}`
        : undefined,
    });

    // Breakdown checks (info level — always pass, just informational)
    result.addCheck('deploy-readiness:breakdown', true, {
      severity: 'info',
      message: `Score breakdown: ${errorChecks.length} error(s) (${errorPenalty}pts), ${warningChecks.length} warning(s) (${warnPenalty}pts), ${criticalChecks.length} critical (${criticalChecks.length * POINTS.criticalPenalty}pts)`,
    });

    if (topIssues.length > 0) {
      result.addCheck('deploy-readiness:top-issues', false, {
        severity: band.level === 'pass' ? 'info' : 'warning',
        message: `Top issues blocking score: ${topIssues.slice(0, 3).join(' | ')}`,
      });
    }

    // Emit the score on the result object for downstream consumers
    result.deployReadinessScore = score;
    result.deployReadinessBand  = band.label;
  }
}

module.exports = DeployReadiness;
