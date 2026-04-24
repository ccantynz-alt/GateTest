/**
 * Security / data-integrity / secrets / fake-fix scan modules.
 *
 * Every check inspects real file content or real file paths.
 * No defaults, no placeholders, no "checks = 1; break;" shortcuts.
 */

import type { ModuleContext, ModuleOutput, ModuleRunner } from "./types";

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\./i;
const ENV_PATH_RE = /(^|\/)\.env($|\.)/i;

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function isTestOrEnv(p: string): boolean {
  return TEST_PATH_RE.test(p) || ENV_PATH_RE.test(p);
}

function lineOf(content: string, idx: number): string {
  const start = content.lastIndexOf("\n", idx - 1) + 1;
  let end = content.indexOf("\n", idx);
  if (end < 0) end = content.length;
  return content.slice(start, end);
}

function windowAround(content: string, idx: number, radius = 200): string {
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + radius);
  return content.slice(start, end);
}

/* ------------------------------------------------------------------ */
/* secrets                                                             */
/* ------------------------------------------------------------------ */

interface SecretPattern {
  name: string;
  re: RegExp;
  skipTestAndEnv?: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "Stripe live key", re: /['"]sk_live_[a-zA-Z0-9]{24,}['"]/ },
  { name: "Stripe test key", re: /['"]sk_test_[a-zA-Z0-9]{24,}['"]/, skipTestAndEnv: true },
  { name: "GitHub personal access token", re: /['"]gh[pousr]_[A-Za-z0-9_]{36,}['"]/ },
  { name: "AWS access key id", re: /['"]AKIA[A-Z0-9]{16}['"]/ },
  {
    name: "AWS secret access key",
    re: /aws[_-]?secret[_-]?(access[_-]?)?key\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/i,
  },
  { name: "OpenAI key", re: /['"]sk-[A-Za-z0-9]{32,}['"]/ },
  { name: "Anthropic key", re: /['"]sk-ant-[A-Za-z0-9\-_]{40,}['"]/ },
  { name: "Google API key", re: /['"]AIza[0-9A-Za-z\-_]{35}['"]/ },
  { name: "Slack token", re: /['"]xox[baprs]-[A-Za-z0-9-]{10,}['"]/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Hardcoded password", re: /\bpassword\s*[:=]\s*['"][^'"]{8,}['"]/i },
  {
    name: "DB connection string with inline credentials",
    re: /(mongodb|postgres(?:ql)?|mysql|redis):\/\/[^:\s]+:[^@\s]+@/i,
  },
];

const SENSITIVE_FILE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "service-account.json",
  ".npmrc",
  ".pypirc",
]);

const SENSITIVE_EXT_RE = /\.(pem|key)$/i;
const ENV_EXAMPLE_RE = /^\.env\.(example|sample)$/i;

export const secrets: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of ctx.fileContents) {
    const inTestOrEnv = isTestOrEnv(f.path);
    for (const pat of SECRET_PATTERNS) {
      if (pat.skipTestAndEnv && inTestOrEnv) continue;
      checks++;
      if (pat.re.test(f.content)) {
        issues++;
        details.push(`${f.path}: ${pat.name}`);
      }
    }
  }

  for (const p of ctx.files) {
    const b = basename(p);
    if (ENV_EXAMPLE_RE.test(b)) continue;
    checks++;
    if (SENSITIVE_FILE_BASENAMES.has(b) || SENSITIVE_EXT_RE.test(b)) {
      issues++;
      details.push(`${p}: committed sensitive file (${b})`);
    }
  }

  return { checks, issues, details };
};

/* ------------------------------------------------------------------ */
/* security                                                            */
/* ------------------------------------------------------------------ */

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

interface SecurityPattern {
  name: string;
  re: RegExp;
  /** If set, run this extra guard on each match's surrounding line. */
  guard?: (line: string) => boolean;
}

const SECURITY_PATTERNS: SecurityPattern[] = [
  { name: "innerHTML assignment (XSS risk)", re: /\.innerHTML\s*=/g },
  { name: "dangerouslySetInnerHTML", re: /dangerouslySetInnerHTML/g },
  { name: "eval() call", re: /\beval\s*\(/g },
  { name: "new Function() constructor", re: /new\s+Function\s*\(/g },
  {
    name: "child_process.exec with string arg (command injection)",
    re: /child_process[\s\S]{0,40}?\bexec\s*\(\s*['"`]/g,
  },
  {
    name: "child_process.spawn with shell:true",
    re: /child_process[\s\S]{0,60}?\bspawn\s*\([^)]*shell\s*:\s*true/g,
  },
  { name: "document.write()", re: /document\.write\s*\(/g },
  {
    name: "Insecure HTTP URL",
    re: /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^'"]+['"]/g,
  },
  {
    name: "CORS wildcard origin",
    re: /Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/g,
  },
  { name: "JWT alg:none", re: /alg['"]?\s*:\s*['"]none['"]/gi },
  {
    name: "Math.random() used for security token/id",
    re: /Math\.random\s*\(\s*\)/g,
    guard: (line) => /\b(token|id|session|secret)\b/i.test(line),
  },
  {
    name: "SQL string concatenation",
    re: /['"]\s*SELECT\b[^'"]*\+\s*\w+/gi,
  },
  {
    name: "SQL template literal with interpolation",
    re: /\.query\(\s*[`'"][^`'")]*\$\{/g,
  },
];

export const security: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;
    for (const pat of SECURITY_PATTERNS) {
      checks++;
      const re = new RegExp(pat.re.source, pat.re.flags);
      let match: RegExpExecArray | null;
      let hit = false;
      while ((match = re.exec(f.content)) !== null) {
        if (pat.guard) {
          const line = lineOf(f.content, match.index);
          if (!pat.guard(line)) continue;
        }
        hit = true;
        break;
      }
      if (hit) {
        issues++;
        details.push(`${f.path}: ${pat.name}`);
      }
    }
  }

  return { checks, issues, details };
};

/* ------------------------------------------------------------------ */
/* dataIntegrity                                                       */
/* ------------------------------------------------------------------ */

const VALIDATION_IMPORT_RE =
  /\b(from|require)\s*\(?\s*['"](zod|joi|yup|ajv|valibot|class-validator)['"]/;

const MIGRATION_DIR_RE =
  /(^|\/)(migrations|db\/migrations|prisma\/migrations|database\/migrations)(\/|$)/i;

const SQL_USAGE_RE = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i;

function jsonParseUnwrapped(content: string): number {
  const re = /JSON\.parse\s*\(/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const win = windowAround(content, m.index, 250);
    if (!/\btry\s*\{/.test(win) || !/\bcatch\b/.test(win)) count++;
  }
  return count;
}

export const dataIntegrity: ModuleRunner = async (
  ctx: ModuleContext,
): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;

    checks++;
    const unwrapped = jsonParseUnwrapped(f.content);
    if (unwrapped > 0) {
      issues++;
      details.push(`${f.path}: ${unwrapped} JSON.parse() without try/catch`);
    }

    checks++;
    const noRadixRe = /parseInt\s*\([^,)]+\)/g;
    if (noRadixRe.test(f.content)) {
      issues++;
      details.push(`${f.path}: parseInt() without radix argument`);
    }

    checks++;
    if (/\breq\.body\b/.test(f.content) && !VALIDATION_IMPORT_RE.test(f.content)) {
      issues++;
      details.push(`${f.path}: req.body used without validation library import`);
    }

    checks++;
    if (/console\.\w+\([^)]*\b(password|token|secret|email|ssn|credit)/i.test(f.content)) {
      issues++;
      details.push(`${f.path}: console logging of sensitive field`);
    }

    checks++;
    if (/\.find(All)?\(\s*\)/.test(f.content)) {
      issues++;
      details.push(`${f.path}: unbounded DB query (.find()/.findAll() with no filter)`);
    }
  }

  const hasMigrationDir = ctx.files.some((p) => MIGRATION_DIR_RE.test(p));
  const hasEnvExample = ctx.files.some((p) => ENV_EXAMPLE_RE.test(basename(p)));
  const sourceUsesSql = ctx.fileContents.some(
    (f) => SOURCE_EXT.test(f.path) && SQL_USAGE_RE.test(f.content),
  );

  checks++;
  if (sourceUsesSql && !hasMigrationDir) {
    issues++;
    details.push("repo: SQL usage detected but no migrations/ directory present");
  }

  checks++;
  if (!hasEnvExample) {
    issues++;
    details.push("repo: no .env.example / .env.sample documenting required env vars");
  }

  return { checks, issues, details };
};

/* ------------------------------------------------------------------ */
/* fakeFixDetector                                                     */
/* ------------------------------------------------------------------ */

interface FakeFixPattern {
  name: string;
  re: RegExp;
  testOnly?: boolean;
  sourceOnly?: boolean;
  countEach?: boolean;
}

const FAKEFIX_PATTERNS: FakeFixPattern[] = [
  {
    name: "disabled test (test.skip/it.skip/xit/xdescribe/describe.skip)",
    re: /\b(?:test\.skip|it\.skip|xit|xdescribe|describe\.skip)\s*\(/g,
    testOnly: true,
  },
  {
    name: "focused-only test (test.only/it.only/fdescribe/fit)",
    re: /\b(?:test\.only|it\.only|fdescribe|fit)\s*\(/g,
    testOnly: true,
  },
  {
    name: "useless assertion (expect(true).toBe(true) or assert(true))",
    re: /expect\s*\(\s*true\s*\)\s*\.(?:toBe|toEqual)\s*\(\s*true\s*\)|\bassert\s*\(\s*true\s*\)/g,
    testOnly: true,
  },
  {
    name: "empty catch block (swallowed error)",
    re: /catch\s*\([^)]*\)\s*\{\s*(?:\/\/[^\n]*\s*)?\}/g,
  },
  {
    name: "trivial constant-return function",
    re: /function\s+\w+\s*\([^)]*\)\s*\{\s*return\s+(?:true|false|null|\[\]|\{\})\s*;?\s*\}/g,
    sourceOnly: true,
  },
  {
    name: "catch block that only logs",
    re: /catch\s*\([^)]*\)\s*\{\s*console\.(?:error|warn|log)[^}]*\}/g,
  },
  {
    name: "@ts-ignore / @ts-expect-error suppression",
    re: /\/\/\s*@ts-(?:ignore|expect-error)\b/g,
    countEach: true,
  },
  {
    name: "eslint-disable suppression",
    re: /\beslint-disable(?:-next-line|-line)?\b/g,
    countEach: true,
  },
];

const EMPTY_TEST_RE =
  /\b(?:test|it)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*return\s*;?\s*\}\s*\)/g;

export const fakeFixDetector: ModuleRunner = async (
  ctx: ModuleContext,
): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;
    const isTest = TEST_PATH_RE.test(f.path);

    for (const pat of FAKEFIX_PATTERNS) {
      if (pat.testOnly && !isTest) continue;
      if (pat.sourceOnly && isTest) continue;

      checks++;
      const re = new RegExp(pat.re.source, pat.re.flags);

      if (pat.countEach) {
        const matches = f.content.match(re);
        if (matches && matches.length > 0) {
          issues++;
          details.push(`${f.path}: ${pat.name} (${matches.length} occurrence${matches.length === 1 ? "" : "s"})`);
        }
      } else {
        if (re.test(f.content)) {
          issues++;
          details.push(`${f.path}: ${pat.name}`);
        }
      }
    }

    if (isTest) {
      checks++;
      const emptyRe = new RegExp(EMPTY_TEST_RE.source, EMPTY_TEST_RE.flags);
      if (emptyRe.test(f.content)) {
        issues++;
        details.push(`${f.path}: empty test body (returns without expect)`);
      }
    }
  }

  return { checks, issues, details };
};
