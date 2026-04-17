/**
 * Static registry — hand-maintained map of all 67 CLI modules, imported
 * by explicit relative path so Webpack/Turbopack traces every file into
 * the serverless function bundle.
 *
 * CRITICAL: do NOT convert these to `require(path.resolve(...))` or a
 * dynamic `import()`. The bundler cannot trace non-literal paths and the
 * bundle will silently drop 67 modules, which is the failure mode we
 * spent this whole bridge avoiding.
 *
 * Adding a new CLI module: add an entry here AND in capabilities.ts.
 * The build-time smoke test asserts both files agree.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

type ModuleConstructor = new () => {
  name: string;
  description: string;
  run(result: unknown, config: unknown): Promise<void>;
};

export interface RegisteredModule {
  name: string;
  ctor: ModuleConstructor;
}

// Explicit relative imports — one per line, path must be literal.
const MODULES: Record<string, ModuleConstructor> = {
  syntax: require("../../../../src/modules/syntax.js"),
  lint: require("../../../../src/modules/lint.js"),
  secrets: require("../../../../src/modules/secrets.js"),
  codeQuality: require("../../../../src/modules/code-quality.js"),
  unitTests: require("../../../../src/modules/unit-tests.js"),
  integrationTests: require("../../../../src/modules/integration-tests.js"),
  e2e: require("../../../../src/modules/e2e.js"),
  visual: require("../../../../src/modules/visual.js"),
  accessibility: require("../../../../src/modules/accessibility.js"),
  performance: require("../../../../src/modules/performance.js"),
  security: require("../../../../src/modules/security.js"),
  seo: require("../../../../src/modules/seo.js"),
  links: require("../../../../src/modules/links.js"),
  compatibility: require("../../../../src/modules/compatibility.js"),
  dataIntegrity: require("../../../../src/modules/data-integrity.js"),
  documentation: require("../../../../src/modules/documentation.js"),
  liveCrawler: require("../../../../src/modules/live-crawler.js"),
  explorer: require("../../../../src/modules/explorer.js"),
  chaos: require("../../../../src/modules/chaos.js"),
  mutation: require("../../../../src/modules/mutation.js"),
  aiReview: require("../../../../src/modules/ai-review.js"),
  fakeFixDetector: require("../../../../src/modules/fake-fix-detector.js"),
  memory: require("../../../../src/modules/memory.js"),
  agentic: require("../../../../src/modules/agentic.js"),
  python: require("../../../../src/modules/python.js"),
  go: require("../../../../src/modules/go-lang.js"),
  rust: require("../../../../src/modules/rust-lang.js"),
  java: require("../../../../src/modules/java.js"),
  ruby: require("../../../../src/modules/ruby.js"),
  php: require("../../../../src/modules/php.js"),
  csharp: require("../../../../src/modules/csharp.js"),
  kotlin: require("../../../../src/modules/kotlin.js"),
  swift: require("../../../../src/modules/swift.js"),
  dependencies: require("../../../../src/modules/dependencies.js"),
  dockerfile: require("../../../../src/modules/dockerfile.js"),
  ciSecurity: require("../../../../src/modules/ci-security.js"),
  shell: require("../../../../src/modules/shell.js"),
  sqlMigrations: require("../../../../src/modules/sql-migrations.js"),
  terraform: require("../../../../src/modules/terraform.js"),
  kubernetes: require("../../../../src/modules/kubernetes.js"),
  promptSafety: require("../../../../src/modules/prompt-safety.js"),
  deadCode: require("../../../../src/modules/dead-code.js"),
  secretRotation: require("../../../../src/modules/secret-rotation.js"),
  webHeaders: require("../../../../src/modules/web-headers.js"),
  typescriptStrictness: require("../../../../src/modules/typescript-strictness.js"),
  flakyTests: require("../../../../src/modules/flaky-tests.js"),
  errorSwallow: require("../../../../src/modules/error-swallow.js"),
  nPlusOne: require("../../../../src/modules/n-plus-one.js"),
  retryHygiene: require("../../../../src/modules/retry-hygiene.js"),
  raceCondition: require("../../../../src/modules/race-condition.js"),
  resourceLeak: require("../../../../src/modules/resource-leak.js"),
  ssrf: require("../../../../src/modules/ssrf.js"),
  hardcodedUrl: require("../../../../src/modules/hardcoded-url.js"),
  envVars: require("../../../../src/modules/env-vars.js"),
  asyncIteration: require("../../../../src/modules/async-iteration.js"),
  homoglyph: require("../../../../src/modules/homoglyph.js"),
  openapiDrift: require("../../../../src/modules/openapi-drift.js"),
  prSize: require("../../../../src/modules/pr-size.js"),
  redos: require("../../../../src/modules/redos.js"),
  cronExpression: require("../../../../src/modules/cron-expression.js"),
  datetimeBug: require("../../../../src/modules/datetime-bug.js"),
  importCycle: require("../../../../src/modules/import-cycle.js"),
  moneyFloat: require("../../../../src/modules/money-float.js"),
  logPii: require("../../../../src/modules/log-pii.js"),
  featureFlag: require("../../../../src/modules/feature-flag.js"),
  tlsSecurity: require("../../../../src/modules/tls-security.js"),
  cookieSecurity: require("../../../../src/modules/cookie-security.js"),
};

export const ALL_MODULE_NAMES: string[] = Object.keys(MODULES);

export function listModules(): RegisteredModule[] {
  return ALL_MODULE_NAMES.map((name) => ({ name, ctor: MODULES[name] }));
}

export function getModule(name: string): ModuleConstructor | undefined {
  return MODULES[name];
}
