/**
 * Shared findings model — used by every UI surface that renders scan results
 * (FindingsPanel, AdminPanel, dashboard scan drawer, status page).
 *
 * Modules ship free-form strings in `details[]`. This file turns those strings
 * into a structured `Finding` with severity / file / line parsed out, so that
 *   - UI renders consistently everywhere
 *   - the /api/scan/fix payload gets accurate `{ file, issue, module }` tuples
 *     (previous admin split naively on the first ":" which captured
 *     "error:" / "Line 42" as the file path and silently broke fixes).
 */

export interface ModuleResultLike {
  name: string;
  status: "passed" | "failed" | "skipped" | "pending" | "running";
  checks: number;
  issues: number;
  duration: number;
  details?: string[];
  skipped?: string;
}

export interface Finding {
  id: string;
  module: string;
  moduleLabel: string;
  severity: "error" | "warning" | "info";
  file: string | null;
  line: number | null;
  message: string;
  raw: string;
}

export const MODULE_LABELS: Record<string, string> = {
  syntax: "Syntax",
  lint: "Lint",
  secrets: "Secrets",
  codeQuality: "Code quality",
  security: "Security",
  accessibility: "Accessibility",
  seo: "SEO",
  links: "Links",
  compatibility: "Compatibility",
  dataIntegrity: "Data integrity",
  documentation: "Documentation",
  performance: "Performance",
  aiReview: "AI review",
  fakeFixDetector: "Fake-fix detector",
  unitTests: "Unit tests",
  integrationTests: "Integration tests",
  e2e: "End-to-end",
  visual: "Visual regression",
  mutation: "Mutation testing",
  chaos: "Chaos testing",
  agentic: "Agentic review",
  liveCrawler: "Live crawler",
  explorer: "Explorer",
  memory: "Codebase memory",
  dependencies: "Dependencies",
  dockerfile: "Dockerfile",
  ciSecurity: "CI security",
  shell: "Shell scripts",
  sqlMigrations: "SQL migrations",
  terraform: "Terraform",
  kubernetes: "Kubernetes",
  promptSafety: "Prompt safety",
  deadCode: "Dead code",
  secretRotation: "Secret rotation",
  webHeaders: "Web headers",
  typescriptStrictness: "TypeScript strictness",
  flakyTests: "Flaky tests",
  errorSwallow: "Error swallow",
  nPlusOne: "N+1 queries",
  retryHygiene: "Retry hygiene",
  raceCondition: "Race conditions",
  resourceLeak: "Resource leaks",
  ssrf: "SSRF",
  hardcodedUrl: "Hardcoded URLs",
  envVars: "Env vars",
  asyncIteration: "Async iteration",
  homoglyph: "Homoglyph",
  openapiDrift: "OpenAPI drift",
  prSize: "PR size",
  redos: "ReDoS",
  cronExpression: "Cron expressions",
  datetimeBug: "Datetime bugs",
  importCycle: "Import cycles",
  tlsSecurity: "TLS security",
  cookieSecurity: "Cookie security",
  featureFlag: "Feature flags",
  logPii: "Log PII",
  moneyFloat: "Money floats",
  python: "Python",
  "go-lang": "Go",
  "rust-lang": "Rust",
  java: "Java",
  ruby: "Ruby",
  php: "PHP",
  csharp: "C#",
  kotlin: "Kotlin",
  swift: "Swift",
};

export function labelFor(module: string): string {
  return MODULE_LABELS[module] || module;
}

const WARNING_HINTS = /\b(warning|warn|should|consider|prefer|outdated|stale|deprecat|missing|unused|aging)\b/i;
const INFO_HINTS = /\b(summary|note|scanned|info|library-ok)\b/i;
const ERROR_HINTS = /\b(error|fail|vulnerab|exploit|injection|unsafe|critical|leak|exposed|disabled|bypass|impossible|catastrophic|unbounded|never|race|toctou|secret|credential|password|api[_-]?key|token)\b/i;

export function classifySeverity(raw: string): Finding["severity"] {
  if (/^(error|err|critical|high)\b[:]/i.test(raw)) return "error";
  if (/^(warning|warn|medium)\b[:]/i.test(raw)) return "warning";
  if (/^(info|note|low|summary)\b[:]/i.test(raw)) return "info";
  const lower = raw.toLowerCase();
  if (ERROR_HINTS.test(lower)) return "error";
  if (WARNING_HINTS.test(lower)) return "warning";
  if (INFO_HINTS.test(lower)) return "info";
  return "warning";
}

export function parseFinding(
  raw: string,
  moduleName: string,
  index: number
): Finding {
  let rest = raw.replace(/^(?:\[[^\]]+\]\s*|(?:error|warn(?:ing)?|info|note|summary)\s*:\s*)/i, "").trim();

  let file: string | null = null;
  let line: number | null = null;

  // "path/to/file.ts:42" or "path/to/file.ts:42:7"
  const fileLineMatch = rest.match(/^([A-Za-z0-9_./\-@+]+?\.[A-Za-z0-9]{1,8}):(\d+)(?::\d+)?(?:\s*[-—:]\s*|\s+)(.+)$/);
  if (fileLineMatch) {
    file = fileLineMatch[1];
    line = Number(fileLineMatch[2]);
    rest = fileLineMatch[3];
  } else {
    const fileOnly = rest.match(/^([A-Za-z0-9_./\-@+]+?\.[A-Za-z0-9]{1,8})\s*[:—-]\s*(.+)$/);
    if (fileOnly) {
      file = fileOnly[1];
      rest = fileOnly[2];
    }
  }

  return {
    id: `${moduleName}-${index}`,
    module: moduleName,
    moduleLabel: labelFor(moduleName),
    severity: classifySeverity(raw),
    file,
    line,
    message: rest.trim(),
    raw,
  };
}

export function buildFindings(modules: ModuleResultLike[]): Finding[] {
  const out: Finding[] = [];
  for (const m of modules) {
    if (!m.details || m.details.length === 0) continue;
    m.details.forEach((d, idx) => out.push(parseFinding(d, m.name, idx)));
  }
  return out;
}

/**
 * Build the payload consumed by POST /api/scan/fix.
 * Only findings with a known file path are fixable — everything else is routed
 * to manual remediation.
 */
export function toFixIssues(
  findings: Finding[]
): Array<{ file: string; issue: string; module: string }> {
  return findings
    .filter((f) => f.file)
    .map((f) => ({
      file: f.file as string,
      issue: f.line ? `Line ${f.line}: ${f.message}` : f.message,
      module: f.module,
    }));
}
