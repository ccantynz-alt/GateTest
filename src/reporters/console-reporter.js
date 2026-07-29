/**
 * Console Reporter - Rich terminal output for GateTest results.
 */

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

const { triageFindings } = require('../core/finding-triage');
const { siteUrl } = require('../core/site-url');

class ConsoleReporter {
  /**
   * @param {object} runner
   * @param {object} [opts]
   * @param {boolean} [opts.showAll=false] — restore the full per-module dump
   *   (`gatetest --all`). Off by default: a scan of this repo streams 813
   *   warnings inline, which reads as noise even though every one is real,
   *   and the developer closes the terminal. Default output is now a ranked
   *   shortlist at the end. Nothing is dropped silently — the count of what
   *   is not shown, and the flag to see it, are printed every time.
   */
  constructor(runner, opts = {}) {
    this.runner = runner;
    this.showAll = Boolean(opts.showAll);
    this._attach();
  }

  _attach() {
    this.runner.on('suite:start', (data) => this._onSuiteStart(data));
    this.runner.on('module:start', (result) => this._onModuleStart(result));
    this.runner.on('module:end', (result) => this._onModuleEnd(result));
    this.runner.on('module:skip', (result) => this._onModuleSkip(result));
    this.runner.on('suite:end', (summary) => this._onSuiteEnd(summary));
  }

  /**
   * The shortlist. This is the part a first-time user actually reads.
   *
   * "813 warnings" tells a developer nothing they can act on and reads as
   * noise even when every finding is real — so they close the terminal and
   * never run it again. "3 things, here they are, here is the line" gets
   * trusted. The confidence score that ranks these already existed; nothing
   * was using it to decide what to show.
   *
   * Blocking errors are listed in full and never capped — they stop the
   * build, so hiding any of them would be indefensible. Everything else
   * competes for three slots, spread across modules so one noisy module
   * cannot fill the list.
   *
   * The hidden count and the flag to see them are always printed. Quietly
   * showing 3 of 813 is the same dishonesty as reporting 813, in the other
   * direction.
   */
  _whatMatters(summary) {
    if (this.showAll) return;

    const { blocking, top, hiddenCount } = triageFindings(summary.results, {
      blockThreshold: summary.confidenceThreshold,
    });
    if (blocking.length === 0 && top.length === 0) return;

    const line = (f, mark) => {
      const c = f.check;
      const where = c.file ? `${c.file}${c.line ? `:${c.line}` : ''}` : f.module;
      console.log(`  ${mark} ${COLORS.bold}${where}${COLORS.reset}`);
      const msg = c.message || c.name;
      if (msg) console.log(`      ${msg}`);
      if (c.suggestion) console.log(`      ${COLORS.dim}→ ${c.suggestion}${COLORS.reset}`);
    };

    // A repo with 200 blockers should not open with 200 lines of scroll —
    // that recreates the wall this whole section exists to remove. Worst
    // first, a readable slice, and the remainder disclosed rather than
    // dropped. The gate decision is untouched: all of them still block.
    const BLOCKING_SHOWN = 10;
    const blockingShown = blocking.slice(0, BLOCKING_SHOWN);
    const blockingHidden = blocking.length - blockingShown.length;

    console.log('');
    if (blocking.length > 0) {
      console.log(`${COLORS.bold}  What's blocking you${COLORS.reset}${blocking.length > BLOCKING_SHOWN ? ` ${COLORS.dim}(worst ${BLOCKING_SHOWN} of ${blocking.length})${COLORS.reset}` : ''}`);
      for (const f of blockingShown) line(f, `${COLORS.red}✗${COLORS.reset}`);
      if (blockingHidden > 0) {
        console.log(`      ${COLORS.dim}…and ${blockingHidden} more blocking finding(s).${COLORS.reset}`);
      }
      if (top.length > 0) console.log('');
    }
    if (top.length > 0) {
      console.log(`${COLORS.bold}  ${blocking.length > 0 ? 'Also worth a look' : 'Worth a look'}${COLORS.reset}`);
      for (const f of top) line(f, `${COLORS.yellow}~${COLORS.reset}`);
    }
    if (hiddenCount > 0) {
      console.log('');
      console.log(`  ${COLORS.dim}${hiddenCount} more finding(s) not shown — ${COLORS.reset}gatetest --all${COLORS.dim} for everything.${COLORS.reset}`);
    }
  }

  _onSuiteStart(data) {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}  GATETEST - Quality Assurance Gate${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log(`${COLORS.dim}  Modules: ${data.modules.join(', ')}${COLORS.reset}`);
    console.log('');
  }

  _onModuleStart(result) {
    process.stdout.write(`  ${COLORS.blue}[RUN]${COLORS.reset} ${result.module} `);
  }

  _onModuleEnd(result) {
    const errors = result.errorChecks.length;
    const warnings = result.warningChecks.length;
    const fixes = result.fixes.length;

    if (result.status === 'passed') {
      const checkCount = result.checks.length;
      let extra = `${checkCount} checks, ${result.duration}ms`;
      if (warnings > 0) extra += `, ${warnings} warnings`;
      if (fixes > 0) extra += `, ${fixes} auto-fixed`;
      console.log(`${COLORS.green}[PASS]${COLORS.reset} ${COLORS.dim}(${extra})${COLORS.reset}`);
      // Warnings are collected and ranked for the shortlist at the end.
      // Streaming every one inline is what produced 813 lines of scroll.
      if (this.showAll) {
        for (const check of result.warningChecks) {
          console.log(`    ${COLORS.yellow}~ ${check.name}${COLORS.reset}`);
          if (check.message) {
            console.log(`      ${COLORS.dim}${check.message}${COLORS.reset}`);
          }
        }
      }
    } else {
      let extra = `${errors} errors, ${result.duration}ms`;
      if (warnings > 0) extra += `, ${warnings} warnings`;
      if (fixes > 0) extra += `, ${fixes} auto-fixed`;
      console.log(`${COLORS.red}[FAIL]${COLORS.reset} ${COLORS.dim}(${extra})${COLORS.reset}`);
      // Show errors first
      for (const check of result.errorChecks) {
        const prefix = check.autoFixed
          ? `${COLORS.green}+ FIXED${COLORS.reset}`
          : `${COLORS.red}x${COLORS.reset}`;
        // Soft-error annotation: low-confidence error doesn't block
        const isSoft = typeof check.confidence === 'number' && check.confidence < 0.7;
        const tag = isSoft
          ? ` ${COLORS.dim}(low confidence: ${check.confidence.toFixed(2)})${COLORS.reset}`
          : '';
        console.log(`    ${prefix} ${COLORS.red}${check.name}${COLORS.reset}${tag}`);
        if (check.expected !== undefined) {
          console.log(`      ${COLORS.dim}expected: ${check.expected}, got: ${check.actual}${COLORS.reset}`);
        }
        if (check.file) {
          console.log(`      ${COLORS.dim}file: ${check.file}:${check.line || ''}${COLORS.reset}`);
        }
        if (check.suggestion) {
          console.log(`      ${COLORS.yellow}fix: ${check.suggestion}${COLORS.reset}`);
        }
      }
      // Then warnings — same reasoning as the pass branch. Errors above are
      // always shown; they are why the module failed.
      if (this.showAll) {
        for (const check of result.warningChecks) {
          console.log(`    ${COLORS.yellow}~ ${check.name}${COLORS.reset}`);
          if (check.message) {
            console.log(`      ${COLORS.dim}${check.message}${COLORS.reset}`);
          }
        }
      }
    }
    // Show applied fixes
    for (const fix of result.fixes) {
      console.log(`    ${COLORS.green}+ auto-fixed: ${fix.description}${COLORS.reset}`);
    }
  }

  _onModuleSkip(result) {
    console.log(`  ${COLORS.yellow}[SKIP]${COLORS.reset} ${result.module} — ${result.error}`);
  }

  _onSuiteEnd(summary) {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.cyan}----------------------------------------${COLORS.reset}`);

    if (summary.gateStatus === 'PASSED') {
      console.log(`${COLORS.bold}${COLORS.bgGreen}${COLORS.white}  GATE: PASSED  ${COLORS.reset}`);
    } else {
      console.log(`${COLORS.bold}${COLORS.bgRed}${COLORS.white}  GATE: BLOCKED  ${COLORS.reset}`);
    }

    console.log('');
    if (summary.diffOnly) {
      console.log(`${COLORS.dim}  Mode: diff-only (${(summary.changedFiles || []).length} changed files)${COLORS.reset}`);
    }
    console.log(`  Modules:  ${summary.modules.passed}/${summary.modules.total} passed`);
    // Info-severity "findings" (markdown whitespace nits, missing Stylelint
    // config, etc.) never block and are never even a warning — but each one
    // still counts as one failed check in the raw total. Left in the
    // denominator, `passed/total` reads as "half this repo is broken" on a
    // perfectly healthy scan (self-scan 2026-07-15: 1272/2506). Excluding
    // them makes the headline reflect what actually needs attention.
    const infoFindings = summary.checks.infoFindings || 0;
    const actionableTotal = summary.checks.total - infoFindings;
    const infoNote = infoFindings > 0
      ? ` ${COLORS.dim}(+${infoFindings} info-only nit(s), never blocks — see Info below)${COLORS.reset}`
      : '';
    console.log(`  Checks:   ${summary.checks.passed}/${actionableTotal} passed${infoNote}`);
    const blocking = summary.checks.blockingErrors;
    const soft = summary.checks.softErrors;
    if (typeof blocking === 'number' && typeof soft === 'number' && soft > 0) {
      console.log(`  Errors:   ${COLORS.red}${blocking}${COLORS.reset} blocking, ${COLORS.dim}${soft} soft (low confidence)${COLORS.reset}`);
    } else {
      console.log(`  Errors:   ${COLORS.red}${summary.checks.errors}${COLORS.reset}`);
    }
    // Warnings get the same confident/soft disclosure errors already had.
    // The score was being computed for warnings and then discarded, so a
    // pile of 800 gave no hint how much of it was shaky (KI #77).
    const softWarn = summary.checks.softWarnings;
    const softWarnNote = typeof softWarn === 'number' && softWarn > 0
      ? `${COLORS.dim} (${softWarn} low confidence)${COLORS.reset}`
      : '';
    console.log(`  Warnings: ${COLORS.yellow}${summary.checks.warnings}${COLORS.reset}${softWarnNote}`);
    // Flywheel softening was previously observable only by inspecting
    // confidenceSignals on an individual check — the scan said nothing about
    // findings having been quieted on the user's own past dismissals
    // (disclosure gap on KI #76). Never quiet about being quiet.
    const softened = summary.checks.flywheelSoftened;
    if (typeof softened === 'number' && softened > 0) {
      console.log(`  ${COLORS.dim}Softened: ${softened} finding(s) down-weighted from your .gatetestignore history — see ${COLORS.reset}gatetest --noise`);
    }
    if (infoFindings > 0) {
      console.log(`  Info:     ${COLORS.dim}${infoFindings}${COLORS.reset}`);
    }
    if (summary.fixes.total > 0) {
      console.log(`  Fixed:    ${COLORS.green}${summary.fixes.total}${COLORS.reset}`);
    }
    console.log(`  Time:     ${summary.duration}ms`);

    if (summary.failedModules.length > 0) {
      console.log('');
      console.log(`${COLORS.red}  Failed modules:${COLORS.reset}`);
      for (const fm of summary.failedModules) {
        console.log(`    ${COLORS.red}- ${fm.module}: ${fm.error}${COLORS.reset}`);
      }
    }

    this._whatMatters(summary);

    this._upsell(summary);

    console.log('');
    console.log(`${COLORS.dim}  Report generated at ${summary.timestamp}${COLORS.reset}`);
    console.log(`${COLORS.bold}${COLORS.cyan}========================================${COLORS.reset}`);
    console.log('');
  }

  /**
   * Conversion hook — fires only when there are fixable findings (the moment
   * of maximum intent). The free CLI just told the developer what's broken;
   * this is where we offer to fix it for them. Honest, single CTA, no spam.
   * Suppressible in CI / scripted runs via GATETEST_NO_UPSELL.
   */
  _upsell(summary) {
    if (process.env.GATETEST_NO_UPSELL) return;
    const errs =
      typeof summary.checks.errors === 'number'
        ? summary.checks.errors
        : (summary.checks.blockingErrors || 0) + (summary.checks.softErrors || 0);
    const warns = summary.checks.warnings || 0;
    const fixable = errs + warns;
    if (fixable <= 0) return;

    console.log('');
    console.log(`${COLORS.bold}${COLORS.magenta}  ────────────────────────────────────────${COLORS.reset}`);
    console.log(
      `${COLORS.bold}  🔧 GateTest found ${COLORS.magenta}${fixable}${COLORS.reset}${COLORS.bold} fixable issue${fixable === 1 ? '' : 's'} in this scan.${COLORS.reset}`,
    );
    console.log(
      `${COLORS.dim}     This scan ran the deterministic engine for free. To have them FIXED —${COLORS.reset}`,
    );
    console.log(
      `${COLORS.dim}     Claude opens a PR, re-scans each fix, and proves it worked:${COLORS.reset}`,
    );
    console.log(`     ${COLORS.cyan}${COLORS.bold}→ ${siteUrl()}${COLORS.reset}  ${COLORS.dim}(Scan + Fix, one verified PR)${COLORS.reset}`);
    console.log(
      `${COLORS.dim}     Already have an Anthropic key? Fix locally: ${COLORS.reset}${COLORS.cyan}gatetest fix${COLORS.reset}`,
    );
    console.log(`${COLORS.bold}${COLORS.magenta}  ────────────────────────────────────────${COLORS.reset}`);
  }
}

module.exports = { ConsoleReporter };
