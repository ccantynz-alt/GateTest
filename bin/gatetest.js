#!/usr/bin/env node

/**
 * GateTest CLI - Command-line interface for the GateTest QA system.
 *
 * Usage:
 *   gatetest                    Run standard test suite
 *   gatetest --suite full       Run the full test suite
 *   gatetest --suite quick      Run quick checks only
 *   gatetest --module security  Run a specific module
 *   gatetest --module visual    Run visual regression tests
 *   gatetest --validate         Validate CLAUDE.md file
 *   gatetest --report           Show latest report
 *   gatetest --list             List available modules
 *   gatetest --init             Initialize GateTest in a project
 */

const path = require('path');
const fs = require('fs');
const { GateTest } = require('../src/index');

const HELP = `
  GateTest - Advanced QA Gate System
  Nothing ships unless it's pristine.

  USAGE
    gatetest [options]

  OPTIONS
    --suite <name>     Run a test suite: quick, standard, full (default: standard)
    --module <name>    Run a specific module by name
    --validate         Validate the CLAUDE.md file
    --report           Display the latest test report
    --list             List all available test modules
    --init             Initialize GateTest in the current project
    --parallel         Run modules in parallel
    --stop-first       Stop on first module failure
    --project <path>   Set project root (default: cwd)
    --help, -h         Show this help message
    --version, -v      Show version

  EXAMPLES
    gatetest                          Run standard checks
    gatetest --suite full             Run every single check
    gatetest --module security        Security scan only
    gatetest --module visual          Visual regression only
    gatetest --suite quick            Fast pre-commit checks

  MODULES
    syntax         Syntax & compilation validation
    lint           ESLint, Stylelint, Markdownlint
    secrets        Secret & credential detection
    codeQuality    Code quality analysis
    unitTests      Unit test execution
    integrationTests  Integration test execution
    e2e            End-to-end test execution
    visual         Visual regression testing
    accessibility  WCAG 2.2 AAA compliance
    performance    Performance & Web Vitals
    security       Security analysis
    seo            SEO & metadata validation
    links          Broken link detection
    compatibility  Browser compatibility
    dataIntegrity  Data integrity validation
    documentation  Documentation completeness
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.version) {
    const pkg = require('../package.json');
    console.log(`GateTest v${pkg.version}`);
    process.exit(0);
  }

  const projectRoot = args.project || process.cwd();

  if (args.init) {
    initProject(projectRoot);
    return;
  }

  const gatetest = new GateTest(projectRoot, {
    parallel: args.parallel || false,
    stopOnFirstFailure: args['stop-first'] || false,
  });

  gatetest.init();

  if (args.validate) {
    const validation = gatetest.validateClaudeMd();
    console.log('\nCLAUDE.md Validation:');
    console.log(`  Valid: ${validation.valid}`);
    console.log(`  Sections: ${validation.stats.sections}`);
    console.log(`  Checklist Items: ${validation.stats.totalItems}`);
    console.log(`  Gate Rules: ${validation.stats.gateRules}`);
    console.log(`  Version: ${validation.stats.version}`);
    if (validation.issues.length > 0) {
      console.log('\n  Issues:');
      for (const issue of validation.issues) {
        console.log(`    - ${issue}`);
      }
    }
    process.exit(validation.valid ? 0 : 1);
  }

  if (args.list) {
    const modules = gatetest.registry.list();
    console.log('\nAvailable GateTest Modules:\n');
    for (const name of modules) {
      const mod = gatetest.registry.get(name);
      console.log(`  ${name.padEnd(20)} ${mod?.description || ''}`);
    }
    console.log('');
    process.exit(0);
  }

  if (args.report) {
    showLatestReport(projectRoot);
    return;
  }

  // Run tests
  let summary;
  if (args.module) {
    summary = await gatetest.runModule(args.module);
  } else {
    summary = await gatetest.runSuite(args.suite || 'standard');
  }

  process.exit(summary.gateStatus === 'PASSED' ? 0 : 1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--validate') args.validate = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--report') args.report = true;
    else if (arg === '--init') args.init = true;
    else if (arg === '--parallel') args.parallel = true;
    else if (arg === '--stop-first') args['stop-first'] = true;
    else if (arg === '--suite' && argv[i + 1]) args.suite = argv[++i];
    else if (arg === '--module' && argv[i + 1]) args.module = argv[++i];
    else if (arg === '--project' && argv[i + 1]) args.project = argv[++i];
  }
  return args;
}

function initProject(projectRoot) {
  const configDir = path.join(projectRoot, '.gatetest');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const dirs = ['reports', 'screenshots', 'baselines', 'modules'];
  for (const dir of dirs) {
    const fullPath = path.join(configDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  // Create default config
  const configPath = path.join(configDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({
      thresholds: {},
      modules: {},
      reporting: { formats: ['json', 'html', 'console'] },
    }, null, 2));
  }

  console.log('\nGateTest initialized successfully!');
  console.log(`  Config: ${configDir}/config.json`);
  console.log(`  Reports: ${configDir}/reports/`);
  console.log('\nRun "gatetest --suite quick" to test your setup.\n');
}

function showLatestReport(projectRoot) {
  const reportPath = path.join(projectRoot, '.gatetest/reports/gatetest-report-latest.json');
  if (!fs.existsSync(reportPath)) {
    console.log('\nNo reports found. Run "gatetest" first.\n');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log('\nLatest GateTest Report:');
  console.log(`  Status: ${report.gatetest.gateStatus}`);
  console.log(`  Time: ${report.gatetest.timestamp}`);
  console.log(`  Modules: ${report.summary.modules.passed}/${report.summary.modules.total} passed`);
  console.log(`  Checks: ${report.summary.checks.passed}/${report.summary.checks.total} passed`);
  console.log(`  Duration: ${report.summary.duration}ms`);

  if (report.failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of report.failures) {
      console.log(`    - ${f.module}: ${f.error}`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error(`\n[GateTest] Fatal error: ${err.message}\n`);
  process.exit(1);
});
