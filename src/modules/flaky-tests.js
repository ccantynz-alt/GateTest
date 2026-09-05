/**
 * Flaky Tests Module — tests that pass on your laptop and fail in CI.
 *
 * Every team that ships has a test suite that flakes. The usual
 * suspects: someone committed `it.only` to debug a single test and
 * forgot it, a test reads `Date.now()` and asserts against a fixed
 * string, a spec calls real `fetch('https://api.stripe.com')` in CI,
 * `setTimeout` races against assertions, `process.env.X` gets mutated
 * in one test and read in another. Every one of those is a CI failure
 * waiting to happen. This module reads test source directly — no
 * runtime required — and flags the shapes before they flake.
 *
 * Discovery: `*.test.{js,jsx,ts,tsx,mjs,cjs,mts,cts}`,
 *            `*.spec.*`, and any file under `tests/`, `test/`,
 *            `__tests__/`, `spec/`.
 *
 * Rules (grouped by class of flake):
 *
 *   1. Left-in focus/skip modifiers (committed accidents)
 *      error:   `it.only(` / `test.only(` / `describe.only(` / `fit(` / `fdescribe(`
 *               (rule: `flaky-tests:only-committed:<rel>:<line>`)
 *      warning: `it.skip(` / `test.skip(` / `xit(` / `xdescribe(` / `xtest(`
 *               (rule: `flaky-tests:skip-committed:<rel>:<line>`)
 *      info:    `it.todo(` / `test.todo(` without a linked issue/PR
 *               in the title
 *               (rule: `flaky-tests:todo-no-issue:<rel>:<line>`)
 *
 *   2. Nondeterminism
 *      warning: `Math.random()` in a test file — non-seeded, flakes randomly
 *               (rule: `flaky-tests:math-random:<rel>:<line>`)
 *      warning: `Date.now()` / `new Date()` with NO fake-timer setup
 *               anywhere in the file — clock-dependent flake
 *               (rule: `flaky-tests:real-clock:<rel>:<line>`)
 *
 *   3. Network hitting real endpoints from tests
 *      warning: `fetch(`, `axios.(get|post|put|delete)(`, `http.request(`
 *               with a URL argument when no mock harness (`nock`,
 *               `msw`, `vi.mock(`, `jest.mock(`, `fetchMock`) appears
 *               in the file
 *               (rule: `flaky-tests:real-network:<rel>:<line>`)
 *
 *   4. Real-time setTimeout/setInterval
 *      warning: `setTimeout(` / `setInterval(` in a test file with NO
 *               fake-timer setup — timing-dependent assertion
 *               (rule: `flaky-tests:real-timer:<rel>:<line>`)
 *
 *   5. Process-wide state mutation
 *      warning: `process.env.XXX = ...` without a matching restore in
 *               an `afterEach` / `afterAll` later in the file
 *               (rule: `flaky-tests:env-leak:<rel>:<line>`)
 *
 *   6. Self-admission
 *      warning: test title contains `flaky`, `intermittent`,
 *               `sometimes`, `randomly`, `eventually` (unless wrapped
 *               in a retry helper — we can't tell either way, so we
 *               warn and let humans adjudicate)
 *               (rule: `flaky-tests:self-admitted:<rel>:<line>`)
 *
 * Non-goals: we don't try to run the tests or parse their ASTs. This
 * is a line-heuristic scanner. False positives are tolerable because
 * every flag is reviewed — false negatives (a missed flaky pattern)
 * are what actually cost teams money in CI minutes and "retry and
 * merge" culture.
 *
 * TODO(gluecron): once Gluecron ships first-party CI, add a rule
 * detecting tests that rely on GitHub-specific env vars
 * (`GITHUB_TOKEN`, `GITHUB_WORKSPACE`, etc.) without guarding for
 * Gluecron equivalents.
 */

const fs = require('fs');
const path = require('path');
const BaseModule = require('./base-module');

// Directory excludes beyond what `BaseModule._collectFiles` already skips
// (node_modules, .git, dist, build, coverage, .next, out, …). The old
// private walk (removed under KI #104) also skipped these.
const EXTRA_EXCLUDES = ['.terraform'];

const TEST_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const TEST_FILE_RE = /\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const TEST_DIR_RE = /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)/;

// Fake-timer / mock hints — if ANY of these appear in the file, we
// soften the real-clock / real-timer / real-network rules.
const FAKE_TIMER_HINTS = [
  /\bjest\.useFakeTimers\b/,
  /\bvi\.useFakeTimers\b/,
  /\bsinon\.useFakeTimers\b/,
  /\buseFakeTimers\s*\(/,
  /\bMockDate\b/,
  /\btimekeeper\b/i,
];

const MOCK_NETWORK_HINTS = [
  /\bnock\s*\(/,
  /\bmsw\b/i,
  /\bjest\.mock\s*\(/,
  /\bvi\.mock\s*\(/,
  /\bfetchMock\b/i,
  /\bmockFetch\b/i,
  /\bsinon\.(?:stub|spy|fake)\b/,
  /\bfrom ['"]msw['"]/, // import from 'msw'

  // A test that supplies its OWN fetch is mocked without using a mocking
  // library. This list previously recognised libraries only, so the modern
  // pattern — define a fetch stub, inject it — read as an unmocked real call.
  //
  // Measured on axios @81df7a5 (org axios): flaky-tests produced 264 of the
  // repo's 487 warnings, 210 of them `real-network`. The sampled case,
  // tests/smoke/bun/tests/cancel.smoke.test.ts:67, is
  //
  //     const fetch = async () => new Response(JSON.stringify({ ok: true }), …)
  //     …
  //     const request = axios.get('https://example.com/in-flight', { fetch })
  //
  // The URL is never requested. example.com is not even resolved. That is a
  // fully hermetic test being told it will flake on a DNS hiccup.
  //
  // Deliberately narrow: a BINDING named `fetch`, or an assignment to the
  // global. Not `adapter:` (appears in real-network config too) and not a
  // bare `new Response(` (a file can construct one and still call out).
  /\b(?:const|let|var|function)\s+fetch\b/,
  /\b(?:globalThis|global|window|self)\s*\.\s*fetch\s*=/,
  /\bnew\s+MockAdapter\s*\(|\baxios-mock-adapter\b/,

  // A file that DECLARES a test double is a file that mocks, whether or not
  // it reaches for a mocking library. axios's smoke tests build
  // `createTransportMock()` and pass the result as `transport`, so the
  // request never touches the network stack:
  //
  //     const createTransportMock = (…) => ({ request(options, onResponse) {…} })
  //     …
  //     await axios.post('http://example.com/form', form,
  //                      { adapter: 'http', proxy: false, transport })
  //
  // This is file-level, like every other hint here — `jest.mock(` anywhere in
  // a file already suppresses the whole file, so the granularity is the
  // list's existing design rather than a new concession.
  //
  // The false-negative it admits: a file declaring a data fixture named
  // `mockUser` that ALSO makes a genuine external call would go unreported.
  // Accepted knowingly at warning severity, where 80 false warnings cost more
  // trust than one missed advisory — and recorded here so the trade is
  // visible rather than discovered later.
  /\b(?:const|let|var|function)\s+\w*(?:Mock|Stub|Fake)\w*\b/,
];

const SELF_ADMIT_TITLE_RE = /\b(?:flak(?:y|iness)|intermittent|sometimes\s+fails?|randomly\s+fails?|eventually\s+works?)\b/i;

// Line-level "inside a string literal" check. Walks the line up to
// `idx` counting unescaped quotes of each kind. If any kind has an odd
// count, the position is inside a string and the match should be
// ignored (e.g. fixture diffs that embed `.skip` as a literal).
function isInString(line, idx) {
  let inSingle = false;
  let inDouble = false;
  let inTick = false;
  for (let i = 0; i < idx && i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') { i += 1; continue; }
    if (!inDouble && !inTick && ch === '\'') inSingle = !inSingle;
    else if (!inSingle && !inTick && ch === '"') inDouble = !inDouble;
    else if (!inSingle && !inDouble && ch === '`') inTick = !inTick;
  }
  return inSingle || inDouble || inTick;
}

// Search a line for a regex match that's NOT inside a string literal.
// Returns the match object or null.
function matchOutsideString(line, re) {
  // Force global flag so we can iterate matches
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const gre = new RegExp(re.source, flags);
  let m;
  while ((m = gre.exec(line)) !== null) {
    if (!isInString(line, m.index)) return m;
    if (m.index === gre.lastIndex) gre.lastIndex += 1;
  }
  return null;
}

class FlakyTestsModule extends BaseModule {
  constructor() {
    super(
      'flakyTests',
      'Flaky Tests — committed .only/.skip, real clock/network/timers, env leaks, self-admitted flakes',
    );
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    // Shared walk from BaseModule — honours --diff/--pr scoping (KI #104);
    // the test-file predicate is applied on top of it.
    const files = this._collectFiles(projectRoot, [...TEST_EXTS], EXTRA_EXCLUDES)
      .filter((f) => this._isTestFile(f));

    if (files.length === 0) {
      result.addCheck('flaky-tests:no-files', true, {
        severity: 'info',
        message: 'No test files found — skipping',
      });
      return;
    }

    result.addCheck('flaky-tests:scanning', true, {
      severity: 'info',
      message: `Scanning ${files.length} test file(s)`,
    });

    let issues = 0;
    for (const file of files) {
      issues += this._scanFile(file, projectRoot, result);
    }

    result.addCheck('flaky-tests:summary', true, {
      severity: 'info',
      message: `Flaky tests scan: ${files.length} file(s), ${issues} issue(s)`,
    });
  }

  _isTestFile(full) {
    const basename = path.basename(full);
    const ext = path.extname(basename).toLowerCase();
    if (!TEST_EXTS.has(ext)) return false;
    if (TEST_FILE_RE.test(basename)) return true;
    // Under a tests/ / __tests__/ / spec/ directory
    return TEST_DIR_RE.test(full.replace(/\\/g, '/'));
  }

  _scanFile(file, projectRoot, result) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch { return 0; }

    const rel = path.relative(projectRoot, file);
    const lines = content.split(/\r?\n/);
    let issues = 0;

    const hasFakeTimers = FAKE_TIMER_HINTS.some((re) => re.test(content));
    const hasNetworkMock = MOCK_NETWORK_HINTS.some((re) => re.test(content));

    // Track env mutations + their potential restores (file-level).
    const envMutations = []; // { line, varName }
    const envRestores = new Set(); // varNames with a restore call afterwards

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // 1. Focus / skip modifiers (skip matches inside string fixtures)
      if (matchOutsideString(line, /\b(?:it|test|describe)\.only\s*\(|\bfit\s*\(|\bfdescribe\s*\(/)) {
        issues += this._flag(result, `flaky-tests:only-committed:${rel}:${i + 1}`, {
          severity: 'error',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} contains \`.only\` / \`fit\` / \`fdescribe\` — this silently disables every OTHER test in the file`,
          suggestion: 'Remove `.only` before committing. If you need to focus one test locally, use the test runner\'s CLI filter instead.',
        });
      }

      if (matchOutsideString(line, /\b(?:it|test|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(|\bxtest\s*\(/)) {
        issues += this._flag(result, `flaky-tests:skip-committed:${rel}:${i + 1}`, {
          severity: 'warning',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} contains \`.skip\` / \`xit\` — skipped tests rot; if you can't fix it, delete it or convert to \`.todo\` with an issue link`,
          suggestion: 'Fix the test, delete it, or change to `it.todo(\'... — see ISSUE-123\')`.',
        });
      }

      // 2. `.todo` with no issue link in the title
      const todoMatchOutside = matchOutsideString(line, /\b(?:it|test)\.todo\s*\(/);
      const todoMatch = todoMatchOutside ? line.match(/\b(?:it|test)\.todo\s*\(\s*(['"`])([^'"`]*?)\1/) : null;
      if (todoMatch) {
        const title = todoMatch[2];
        const hasLink = /(?:issue|#\d+|https?:\/\/|gh\/|pr[-/]?\d+|bug[-\s]?\d+)/i.test(title);
        if (!hasLink) {
          issues += this._flag(result, `flaky-tests:todo-no-issue:${rel}:${i + 1}`, {
            severity: 'info',
            file: rel,
            line: i + 1,
            message: `${rel}:${i + 1} has a \`.todo\` with no linked issue — TODOs without issues never get picked up`,
            suggestion: 'Include an issue link or reference: `it.todo(\'handles negative zero — see #456\')`.',
          });
        }
      }

      // 3. Nondeterminism: Math.random
      if (/\bMath\.random\s*\(/.test(line)) {
        // Skip jitter/backoff context: `Math.random() * DELAY` or `* Math.random()`
        // These are legitimate uses in retry/timing tests, not nondeterministic data.
        const isJitterContext = /Math\.random\s*\(\s*\)\s*[*+]/.test(line)
          || /[*+]\s*Math\.random\s*\(\s*\)/.test(line);
        if (!isJitterContext) {
          issues += this._flag(result, `flaky-tests:math-random:${rel}:${i + 1}`, {
            severity: 'warning',
            file: rel,
            line: i + 1,
            message: `${rel}:${i + 1} calls \`Math.random()\` — an unseeded RNG in a test produces different values every run`,
            suggestion: 'Use a fixed seed (e.g., `seedrandom`), inject the random source as a parameter, or assert on a property that doesn\'t depend on the random value.',
          });
        }
      }

      // 4. Real clock: Date.now() or new Date() without fake timers.
      // Reading the clock is not flaky by itself — a timestamp in a fixture
      // id or a temp filename is deterministic in every way a test cares
      // about. It becomes flaky only when the value is ASSERTED against, so
      // flag a clock read only when it feeds an expect/assert: directly on
      // the same line, or via a variable that later appears inside one.
      // (2026-08-18 audit residue: the unconditional form was a tautology —
      // "test reads clock, therefore flaky" — and mostly noise.)
      if ((/\bDate\.now\s*\(/.test(line) || /\bnew\s+Date\s*\(\s*\)/.test(line)) && !hasFakeTimers) {
        const assertedInline = /\b(?:expect|assert(?:\.\w+)*|should)\s*\(?[^;\n]*(?:\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\))/.test(line);
        let assertedViaVar = false;
        if (!assertedInline) {
          const assign = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;]*(?:\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\))/);
          if (assign) {
            const varRe = new RegExp(`\\b(?:expect|assert(?:\\.\\w+)*|should)\\s*\\(?[^;\\n]*\\b${assign[1]}\\b`);
            assertedViaVar = lines.some((l, k) => k > i && varRe.test(l));
          }
        }
        if (assertedInline || assertedViaVar) {
          issues += this._flag(result, `flaky-tests:real-clock:${rel}:${i + 1}`, {
            severity: 'warning',
            file: rel,
            line: i + 1,
            message: `${rel}:${i + 1} asserts on a real clock reading (\`Date.now()\` / \`new Date()\`) with no fake-timer setup in this file`,
            suggestion: 'Call `jest.useFakeTimers()` / `vi.useFakeTimers()` / `sinon.useFakeTimers()` at the top of the describe, or inject a clock.',
          });
        }
      }

      // 5. Real network
      // Matched OUTSIDE string literals: a test that writes source fixtures
      // (`write(tmp, 'src/gateway.ts', 'fetch("https://api.openai.com…')`)
      // contains the call as DATA — three such lines in our own
      // tests/prompt-safety.test.js were reported as real network calls
      // (2026-09-05, PR #431). Same guard the .skip rule already uses.
      const fetchCall = matchOutsideString(line, /\bfetch\s*\(\s*['"`]https?:\/\//) !== null;
      const axiosCall = matchOutsideString(line, /\baxios\.(?:get|post|put|delete|patch|head)\s*\(\s*['"`]https?:\/\//) !== null;
      const httpCall = matchOutsideString(line, /\b(?:https?)\.request\s*\(/) !== null;
      // A LOOPBACK request is not a real-network call. There is no DNS to
      // hiccup and no third party to return a 5xx — the two failures this
      // rule's own message names. It is a test talking to a server the test
      // started, which is the standard way to test an HTTP client.
      //
      // Measured on axios @81df7a5 (org axios): 113 of 203 remaining
      // real-network findings were in tests/unit/adapters/http.test.js alone,
      // a file that calls http.createServer 14 times and points 96 of its 126
      // requests at localhost / 127.0.0.1 / [::1].
      //
      // Per-line rather than per-file on purpose: the same file also requests
      // `http://connect-timeout.test/`, and a file-level suppression would
      // have silenced that too.
      const loopback = /['"`]https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)(?::|\/|['"`])/.test(line);
      if ((fetchCall || axiosCall || httpCall) && !hasNetworkMock && !loopback) {
        issues += this._flag(result, `flaky-tests:real-network:${rel}:${i + 1}`, {
          severity: 'warning',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} makes a real HTTP call with no network mock detected in this file — every 5xx or DNS hiccup flakes this test`,
          suggestion: 'Use `nock`, `msw`, `jest.mock(\'node:http\')`, or `vi.mock(\'node:fetch\')`. If this is an integration test against a staging env, mark the describe with a CI flag and document it.',
        });
      }

      // 6. Real timers
      if (/\b(?:setTimeout|setInterval)\s*\(/.test(line) && !hasFakeTimers) {
        issues += this._flag(result, `flaky-tests:real-timer:${rel}:${i + 1}`, {
          severity: 'warning',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} uses \`setTimeout\` / \`setInterval\` in a test with no fake-timer setup — every race condition in CI surfaces as a flake`,
          suggestion: 'Use `jest.useFakeTimers()` / `vi.useFakeTimers()` and advance time explicitly with `jest.advanceTimersByTime(n)`.',
        });
      }

      // 7. process.env mutations (record for later restore check)
      const envMatch = line.match(/\bprocess\.env\.([A-Z_][A-Z0-9_]*)\s*=/);
      if (envMatch) {
        envMutations.push({ line: i + 1, varName: envMatch[1] });
      }
      // Track restores: `delete process.env.X`, or later assignment to a
      // saved `originalX` inside afterEach/afterAll.
      const restoreMatch = line.match(/\bdelete\s+process\.env\.([A-Z_][A-Z0-9_]*)/);
      if (restoreMatch) envRestores.add(restoreMatch[1]);

      // 8. Self-admission — test titles with flaky keywords
      const titleMatch = line.match(/\b(?:it|test)\s*\(\s*(['"`])([^'"`]+?)\1/);
      if (titleMatch && SELF_ADMIT_TITLE_RE.test(titleMatch[2])) {
        issues += this._flag(result, `flaky-tests:self-admitted:${rel}:${i + 1}`, {
          severity: 'warning',
          file: rel,
          line: i + 1,
          title: titleMatch[2],
          message: `${rel}:${i + 1} test title admits flakiness: "${titleMatch[2]}" — tests that are documented as flaky ARE the bug`,
          suggestion: 'Root-cause the nondeterminism. If you genuinely need retry-on-failure, use your runner\'s `retry` option explicitly and track the root-cause as a bug.',
        });
      }
    }

    // Post-pass: flag env mutations whose variable was never restored.
    // `restored` covers two cases: explicit `delete process.env.X` or a
    // later `process.env.X = originalX` inside an afterEach/afterAll.
    // We approximate the second case with a lightweight substring
    // check over the whole file.
    for (const mutation of envMutations) {
      if (envRestores.has(mutation.varName)) continue;
      const restoreRe = new RegExp(
        `(?:afterEach|afterAll)[\\s\\S]{0,500}process\\.env\\.${mutation.varName}\\s*=`,
      );
      if (restoreRe.test(content)) continue;
      issues += this._flag(result, `flaky-tests:env-leak:${rel}:${mutation.line}:${mutation.varName}`, {
        severity: 'warning',
        file: rel,
        line: mutation.line,
        envVar: mutation.varName,
        message: `${rel}:${mutation.line} sets \`process.env.${mutation.varName}\` with no matching restore in afterEach/afterAll — later tests in the run see the mutation`,
        suggestion: `Wrap in an afterEach: \`const orig = process.env.${mutation.varName}; /* ... */; afterEach(() => { process.env.${mutation.varName} = orig; });\` (or just \`delete process.env.${mutation.varName}\`).`,
      });
    }

    return issues;
  }

  _flag(result, name, details) {
    result.addCheck(name, false, details);
    return 1;
  }
}

module.exports = FlakyTestsModule;
