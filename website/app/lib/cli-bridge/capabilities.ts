/**
 * Per-module serverless capability declarations.
 *
 * Honesty contract: if a module cannot run in Vercel's serverless Node
 * runtime, it is skipped up-front with a specific reason — NEVER marked
 * "passed" when it didn't actually run. Customers see the real status.
 *
 * Categories:
 *   fs-only            — reads files only, runs cleanly
 *   fs-with-optional-exec — primary path is fs; an exec call may fail but
 *                           module handles it gracefully
 *   needs-git          — relies on `git` CLI / `.git` dir; degrades to no-op
 *                         if git is unavailable (pr-size, ai-review,
 *                         fake-fix-detector already handle this)
 *   needs-toolchain    — requires the target project's dev-deps + test
 *                         toolchain to be installed (npm/eslint/pytest/etc.)
 *   needs-browser      — requires Playwright/Chromium; cannot run serverless
 */

export type Capability =
  | "fs-only"
  | "fs-with-optional-exec"
  | "needs-git"
  | "needs-toolchain"
  | "needs-browser";

export interface ModuleCapability {
  capability: Capability;
  skipReason?: string;
}

/**
 * Skip messages surfaced to the customer verbatim. They must be specific
 * enough to be useful ("install the CLI to run this") rather than vague
 * ("not available"). This is what separates an honest service from fake-pass.
 */
export const MODULE_CAPABILITIES: Record<string, ModuleCapability> = {
  // ── fs-only (run cleanly) ──────────────────────────
  accessibility: { capability: "fs-only" },
  asyncIteration: { capability: "fs-only" },
  ciSecurity: { capability: "fs-only" },
  codeQuality: { capability: "fs-only" },
  compatibility: { capability: "fs-only" },
  cookieSecurity: { capability: "fs-only" },
  cronExpression: { capability: "fs-only" },
  csharp: { capability: "fs-only" },
  datetimeBug: { capability: "fs-only" },
  deadCode: { capability: "fs-only" },
  dependencies: { capability: "fs-only" },
  dockerfile: { capability: "fs-only" },
  documentation: { capability: "fs-only" },
  envVars: { capability: "fs-only" },
  errorSwallow: { capability: "fs-only" },
  featureFlag: { capability: "fs-only" },
  flakyTests: { capability: "fs-only" },
  go: { capability: "fs-only" },
  hardcodedUrl: { capability: "fs-only" },
  homoglyph: { capability: "fs-only" },
  importCycle: { capability: "fs-only" },
  java: { capability: "fs-only" },
  kotlin: { capability: "fs-only" },
  kubernetes: { capability: "fs-only" },
  links: { capability: "fs-only" },
  logPii: { capability: "fs-only" },
  memory: { capability: "fs-only" },
  moneyFloat: { capability: "fs-only" },
  nPlusOne: { capability: "fs-only" },
  openapiDrift: { capability: "fs-only" },
  php: { capability: "fs-only" },
  promptSafety: { capability: "fs-only" },
  python: { capability: "fs-only" },
  raceCondition: { capability: "fs-only" },
  redos: { capability: "fs-only" },
  resourceLeak: { capability: "fs-only" },
  retryHygiene: { capability: "fs-only" },
  ruby: { capability: "fs-only" },
  rust: { capability: "fs-only" },
  secretRotation: { capability: "fs-only" },
  secrets: { capability: "fs-only" },
  seo: { capability: "fs-only" },
  shell: { capability: "fs-only" },
  sqlMigrations: { capability: "fs-only" },
  ssrf: { capability: "fs-only" },
  swift: { capability: "fs-only" },
  terraform: { capability: "fs-only" },
  tlsSecurity: { capability: "fs-only" },
  typescriptStrictness: { capability: "fs-only" },
  webHeaders: { capability: "fs-only" },

  // ── fs + optional exec (degrade gracefully) ────────
  security: { capability: "fs-with-optional-exec" },
  dataIntegrity: { capability: "fs-with-optional-exec" },

  // ── git-dependent (degrade if git CLI unavailable) ─
  prSize: { capability: "needs-git" },
  aiReview: { capability: "needs-git" },
  fakeFixDetector: { capability: "needs-git" },
  agentic: { capability: "needs-git" },

  // ── toolchain (skipped honestly in serverless) ─────
  syntax: {
    capability: "needs-toolchain",
    skipReason:
      "Requires project dev-deps and a parser toolchain (typescript/babel) — run via the GateTest CLI for this scan.",
  },
  lint: {
    capability: "needs-toolchain",
    skipReason:
      "Requires project-installed ESLint/Stylelint with rule config — run via the GateTest CLI for this scan.",
  },
  unitTests: {
    capability: "needs-toolchain",
    skipReason:
      "Requires the project's test runner (jest/vitest/mocha) and installed dependencies — run via the GateTest CLI for this scan.",
  },
  integrationTests: {
    capability: "needs-toolchain",
    skipReason:
      "Requires the project's integration harness — run via the GateTest CLI for this scan.",
  },
  mutation: {
    capability: "needs-toolchain",
    skipReason:
      "Runs the project's test suite across source mutations — requires installed dev-deps, run via the GateTest CLI.",
  },
  performance: {
    capability: "needs-toolchain",
    skipReason:
      "Requires Lighthouse / WebPageTest against a deployed URL — run via the GateTest CLI for this scan.",
  },

  // ── browser/Playwright (not serverless) ────────────
  e2e: {
    capability: "needs-browser",
    skipReason:
      "Requires Playwright with Chromium — not runnable in Vercel serverless. Run via the GateTest CLI.",
  },
  visual: {
    capability: "needs-browser",
    skipReason:
      "Visual regression needs Playwright screenshots against a deployed URL — run via the GateTest CLI.",
  },
  chaos: {
    capability: "needs-browser",
    skipReason:
      "Chaos testing needs a controllable runtime + network shims — run via the GateTest CLI.",
  },
  liveCrawler: {
    capability: "needs-browser",
    skipReason:
      "Live crawler needs a browser to render and navigate — run via the GateTest CLI against a deployed URL.",
  },
  explorer: {
    capability: "needs-browser",
    skipReason:
      "Autonomous explorer fills forms and clicks buttons in a browser — run via the GateTest CLI.",
  },
};

/**
 * Modules that run in the serverless bridge. Anything classified as
 * needs-toolchain or needs-browser is excluded — the customer still sees
 * the row, but with an honest skipped status.
 */
export function isBridgeCompatible(name: string): boolean {
  const cap = MODULE_CAPABILITIES[name];
  if (!cap) return false;
  return (
    cap.capability === "fs-only" ||
    cap.capability === "fs-with-optional-exec" ||
    cap.capability === "needs-git"
  );
}
