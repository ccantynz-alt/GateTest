/**
 * flakyTests module — #22. Finds the test-suite anti-patterns that cause
 * red-then-green-then-red CI and eventually "disable the test" rot:
 *
 *   - setTimeout / setInterval inside test bodies — timing-dependent.
 *   - Date.now() / new Date() referenced without a mock nearby.
 *   - Math.random() referenced without a seed helper.
 *   - `it.only`, `fdescribe`, `describe.only`, `test.only` — leaves the rest
 *     of the suite silently unrun.
 *   - .skip / xit / xdescribe — silently disabled coverage.
 *   - Missing `await` on expect(asyncFn()) or on .toResolve/.toThrow helpers.
 *   - Network calls (fetch, axios, supertest to http://) without a mock.
 *
 * Pure text scan of test files. Runs in milliseconds even on large repos.
 */
import type { ModuleContext, ModuleOutput, ModuleRunner, RepoFile } from "./types";

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|spec|e2e)(\/|$)|\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function isTestFile(f: RepoFile): boolean {
  return SOURCE_EXT.test(f.path) && TEST_PATH_RE.test(f.path);
}

function lineOf(content: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < content.length; i++) if (content[i] === "\n") n++;
  return n;
}

interface Rule {
  name: string;
  re: RegExp;
  message: string;
  /** Suppress if this counter-regex also matches anywhere in the same file. */
  unless?: RegExp;
  /** Fire on every occurrence instead of the first match. */
  all?: boolean;
}

const RULES: Rule[] = [
  {
    name: "it.only / describe.only leaked",
    re: /\b(it|test|describe)\.only\s*\(/,
    message: ".only() focus left in source — rest of the suite is silently skipped on CI",
    all: true,
  },
  {
    name: "fdescribe / fit focus",
    re: /\bf(describe|it)\s*\(/,
    message: "fdescribe / fit focus left in source — skips the rest of the suite",
    all: true,
  },
  {
    name: "disabled test (.skip)",
    re: /\b(it|test|describe)\.skip\s*\(/,
    message: ".skip left in source — flag the reason or delete the test",
    all: true,
  },
  {
    name: "disabled test (xit/xdescribe)",
    re: /\b(xit|xdescribe|xtest)\s*\(/,
    message: "xit / xdescribe left in source — silently disabled test",
    all: true,
  },
  {
    name: "setTimeout in test body",
    re: /\bsetTimeout\s*\(/,
    message: "setTimeout inside a test — timing-dependent, use fake timers (vi.useFakeTimers / jest.useFakeTimers)",
    unless: /(jest|vi|sinon)\.useFakeTimers/,
  },
  {
    name: "setInterval in test body",
    re: /\bsetInterval\s*\(/,
    message: "setInterval inside a test — timing-dependent, use fake timers",
    unless: /(jest|vi|sinon)\.useFakeTimers/,
  },
  {
    name: "Date.now without mock",
    re: /\bDate\.now\s*\(/,
    message: "Date.now() in a test without a mock — switch to fake timers or inject a clock",
    unless: /(Date\.now\s*=\s*|spyOn\s*\([^)]*,\s*['"]now['"]\)|vi\.setSystemTime|jest\.setSystemTime|MockDate)/,
  },
  {
    name: "new Date() without mock",
    re: /new\s+Date\s*\(\s*\)/,
    message: "new Date() in a test without a mock — fix the clock (vi.setSystemTime)",
    unless: /(vi\.setSystemTime|jest\.setSystemTime|MockDate|useFakeTimers)/,
  },
  {
    name: "Math.random without seed",
    re: /\bMath\.random\s*\(/,
    message: "Math.random() in a test without seeding — use a seeded PRNG or stub",
    unless: /(seedrandom|spyOn\s*\(\s*Math\s*,\s*['"]random['"]\)|Math\.random\s*=)/,
  },
  {
    name: "hardcoded sleep",
    re: /await\s+new\s+Promise\s*\(\s*(?:r|res|resolve)\s*=>\s*setTimeout\s*\(\s*\w+\s*,\s*\d+\s*\)\s*\)/,
    message: "hand-rolled await sleep(...) — flaky under CI load, use event-driven waits",
    all: true,
  },
  {
    name: "real network fetch",
    re: /\bfetch\s*\(\s*['"]https?:\/\//,
    message: "fetch() against a real URL in a test — stub with msw / nock / vi.mock",
    unless: /(msw|nock|vi\.mock|jest\.mock|mockFetch|fetchMock)/,
    all: true,
  },
  {
    name: "missing await on expect(asyncFn())",
    re: /^(?!.*\bawait\b).*\bexpect\s*\(\s*\w+\s*\(\s*[^)]*\)\s*\)\s*\.\s*(resolves|rejects|toResolve|toReject)\b/m,
    message: "expect(...).resolves/.rejects without await — assertion fires asynchronously and can silently pass",
    all: true,
  },
];

export const flakyTests: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const testFiles = ctx.fileContents.filter(isTestFile);
  if (testFiles.length === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no test files found",
    };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of testFiles) {
    for (const rule of RULES) {
      checks++;
      if (rule.unless && rule.unless.test(f.content)) continue;

      if (rule.all) {
        const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
        let match: RegExpExecArray | null;
        let fired = false;
        while ((match = re.exec(f.content)) !== null) {
          issues++;
          fired = true;
          details.push(`${f.path}:${lineOf(f.content, match.index)}: ${rule.message}`);
          if (details.length > 500) break;
          if (match.index === re.lastIndex) re.lastIndex++;
        }
        // `checks` counted once per rule per file regardless — matches the
        // honesty contract: one check = one rule on this file.
        void fired;
      } else {
        const m = rule.re.exec(f.content);
        if (!m) continue;
        issues++;
        details.push(`${f.path}:${lineOf(f.content, m.index)}: ${rule.message}`);
      }
    }
  }

  return { checks, issues, details };
};
