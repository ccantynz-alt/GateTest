/**
 * GateTest - Advanced QA Gate System
 *
 * Nothing ships unless it's pristine.
 * This is the main entry point for the GateTest library.
 */

const { GateTestConfig } = require('./core/config');
const { GateTestRunner, TestResult } = require('./core/runner');
const { ModuleRegistry } = require('./core/registry');
const { ClaudeMdParser } = require('./core/claude-md-parser');
const { ConsoleReporter } = require('./reporters/console-reporter');
const { JsonReporter } = require('./reporters/json-reporter');
const { HtmlReporter } = require('./reporters/html-reporter');
const { SessionLedger } = require('./core/session-ledger');
const { AccountManager, TIERS } = require('./core/accounts');
const { BillingManager, PLANS } = require('./core/billing');

class GateTest {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot || process.cwd();
    this.config = new GateTestConfig(this.projectRoot);
    this.registry = new ModuleRegistry();
    this.options = options;
    this.ledger = new SessionLedger(this.projectRoot);
    this.accounts = new AccountManager(this.projectRoot);
  }

  /**
   * Initialize GateTest with all built-in modules.
   */
  init() {
    this.registry.loadBuiltIn();

    // Load custom modules from project
    const customDir = `${this.projectRoot}/.gatetest/modules`;
    this.registry.loadCustom(customDir);

    return this;
  }

  /**
   * Run a specific suite of tests.
   */
  async runSuite(suiteName = 'standard') {
    const modules = this.config.getSuite(suiteName);
    return this._run(modules);
  }

  /**
   * Run a specific module by name.
   */
  async runModule(moduleName) {
    return this._run([moduleName]);
  }

  /**
   * Run all registered modules.
   */
  async runAll() {
    const modules = this.registry.list();
    return this._run(modules);
  }

  /**
   * Validate the CLAUDE.md file.
   */
  validateClaudeMd() {
    const parser = new ClaudeMdParser(this.projectRoot);
    return parser.validate();
  }

  /**
   * Parse the CLAUDE.md file and return structured data.
   */
  parseClaudeMd() {
    const parser = new ClaudeMdParser(this.projectRoot);
    return parser.parse();
  }

  async _run(moduleNames) {
    const runner = new GateTestRunner(this.config, this.options);

    // Register modules
    const allModules = this.registry.getAll();
    for (const [name, mod] of allModules) {
      runner.register(name, mod);
    }

    // Attach reporters
    new ConsoleReporter(runner);
    new JsonReporter(runner, this.config);
    new HtmlReporter(runner, this.config);

    // Run and return summary
    const summary = await runner.run(moduleNames);

    // Auto-snapshot session state after every scan
    try {
      this.ledger.snapshot(summary);
    } catch {
      // Don't fail the scan if ledger write fails
    }

    // Record scan against quota
    try {
      this.accounts.recordScan();
    } catch {
      // Don't fail the scan if quota tracking fails
    }

    // Exit with non-zero if gate is blocked
    if (summary.gateStatus === 'BLOCKED' && this.config.get('gate.blockOnFailure')) {
      process.exitCode = 1;
    }

    return summary;
  }
}

module.exports = {
  GateTest,
  GateTestConfig,
  GateTestRunner,
  TestResult,
  ModuleRegistry,
  ClaudeMdParser,
  ConsoleReporter,
  JsonReporter,
  HtmlReporter,
  SessionLedger,
  AccountManager,
  TIERS,
  BillingManager,
  PLANS,
};
