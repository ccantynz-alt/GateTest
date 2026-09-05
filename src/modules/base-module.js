/**
 * Base Module - Abstract base class for all GateTest test modules.
 */

/**
 * Canonical "is this test/fixture code?" pattern — the union of the 6
 * drifted copies it replaces. Forward slashes only; `_isTestPath()` owns
 * normalising the input, so callers must go through it rather than testing
 * this directly (that omission is the Windows bug it was built to fix).
 *
 * Three branches: a directory segment anywhere in the path, a conventional
 * `.test.<ext>` / `.spec.<ext>` suffix, or a Python runner basename.
 * Language list covers the runtimes GateTest scans.
 */
const TEST_PATH_RE =
  // `[a-z0-9]+[-_](?:tests?|specs?)` — django keeps its QUnit suite in
  // `js_tests/`, hono its runtime tests in `runtime-tests/`. A segment that
  // ENDS in a test word with a separator before it is a test dir; `contest`,
  // `latest`, `tester.js` have no separator and stay application code.
  //
  // `(?:test_[^/]*|[^/]*_test|tests|conftest)\.py` — the Python runners
  // find tests by BASENAME, not by suffix: pytest collects `test_*.py` and
  // `*_test.py` and loads `conftest.py` by name; Django's runner discovers
  // `test*.py`, so an app ships a single `tests.py` beside `views.py`. The
  // whole basename is matched at end-of-path (`[^/]*` cannot cross a
  // segment), and the loading rule is the same as the directory branch: a
  // test WORD with a separator (`_`) or nothing on the far side. `contest`,
  // `latest`, `attestation`, `testing`, `testcases`, `testutils` carry the
  // word inside an identifier and stay application code — django's
  // `django/test/testcases.py` is test-support code classified by its
  // `test/` directory, never by its name. Bare `test.py` is deliberately
  // NOT here: pytest does not collect it, and the two in the corpus are both
  // shipped code — `django/core/management/commands/test.py` IS the
  // `manage.py test` command, and `django/contrib/messages/test.py` is a
  // public assertion mixin. Matching it would silence checks on files that
  // exist precisely because they run tests, not because they are tests.
  /(?:^|\/)(?:tests?|specs?|__tests__|__mocks__|e2e|fixtures?|stories|storybook|reliability-corpus|testdata|test[-_]?resources|[a-z0-9]+[-_](?:tests?|specs?))(?:\/|$)|\.(?:test|spec|stories|fixture|e2e)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts|py|rb|go|java|rs|php)$|(?:^|\/)(?:test_[^/]*|[^/]*_test|tests|conftest)\.py$/i;

class BaseModule {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  /**
   * Run the module's checks.
   * @param {TestResult} result - The result object to record checks against.
   * @param {GateTestConfig} config - The GateTest configuration.
   */
  async run(_result, _config) {
    throw new Error(`Module "${this.name}" must implement run()`);
  }

  /**
   * Collect files matching patterns from project root.
   *
   * Incremental-scan mode: when the runner sets
   * `this._incrementalContext = { changedFilesAbs: Set<string> }` on
   * the module instance (only on PRs / `--diff`), the returned file list
   * is intersected with that set. Modules don't need to know — they get
   * a shorter list and run proportionally faster. Per-PR scans drop from
   * ~30s (full sweep, parallel) to ~3-10s (touched files only).
   *
   * Modules that need to run on EVERY scan regardless of diff (e.g. a
   * config-level checker that reads `package.json`) can opt out by
   * setting `this._respectsIncremental = false` in their constructor.
   */
  _collectFiles(projectRoot, patterns, excludes = []) {
    const fs = require('fs');
    const path = require('path');
    const files = [];

    const { WALK_EXCLUDES: defaultExcludes } = require('../core/walk-excludes');
    const allExcludes = [...defaultExcludes, ...excludes];

    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (allExcludes.includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (patterns.includes(ext) || patterns.includes('*')) {
            files.push(fullPath);
          }
        }
      }
    };

    walk(projectRoot);

    // Repository path filter (.gatetest.json `paths`, stamped by the runner
    // as this._scanPathFilter): the one place "in scope for this gate" is
    // decided for every module that walks (src/core/scan-paths.js).
    if (this._scanPathFilter) {
      const { pathInScope } = require('../core/scan-paths');
      const inScope = (f) => pathInScope(this._scanPathFilter, path.relative(projectRoot, f).split(path.sep).join('/'));
      for (let i = files.length - 1; i >= 0; i--) if (!inScope(files[i])) files.splice(i, 1);
    }

    // Incremental filter — applied AFTER the walk so the exclude rules
    // and extension matching still hold. Cheap set intersection.
    if (
      this._respectsIncremental !== false &&
      this._incrementalContext &&
      this._incrementalContext.changedFilesAbs instanceof Set
    ) {
      const changed = this._incrementalContext.changedFilesAbs;
      return files.filter((f) => changed.has(f));
    }

    return files;
  }

  /**
   * Run a shell command and return { stdout, stderr, exitCode }.
   */
  _exec(command, options = {}) {
    const { execSync } = require('child_process');
    try {
      const stdout = execSync(command, {
        encoding: 'utf-8',
        timeout: options.timeout || 60000,
        cwd: options.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
        ...(options.env ? { env: options.env } : {}),
      });
      return { stdout, stderr: '', exitCode: 0, signal: null, timedOut: false };
    } catch (err) {
      // execSync kills the child on timeout: status is null, signal is
      // SIGTERM, code is ETIMEDOUT. Without surfacing this, callers can't
      // tell "the tool crashed" from "we killed it after our own timeout" —
      // and the two need very different messages (see lint.js self-scan
      // 2026-07-15: a real ESLint timeout on a large Next.js app was
      // reported to the user as "ESLint crashed. stderr: " with zero
      // diagnostic value).
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.status || 1,
        signal: err.signal || null,
        timedOut: err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM',
      };
    }
  }

  /**
   * True when `index` falls inside an unescaped '/"/` string literal that
   * OPENS before `index` on the same line (and hasn't closed yet).
   *
   * Rules whose regex needs a quoted value preserved (e.g. matching a literal
   * `"0"`) can't run against a fully string-stripped line, so they scan raw
   * text instead — which means a rule like `process.env.X = "0"` matches
   * identically whether it's real top-level code OR a JS string literal
   * containing that same text as sample/fixture data, e.g.
   * `write(tmp, 'a.js', 'process.env.X = "0"')`. A real assignment is never
   * itself nested inside another string literal — that would be inert text,
   * not executable code — so "nested in an outer string" is a safe, general
   * signal that a match is example/fixture data, not a live vulnerability.
   * (Found via self-scan 2026-07-15: tls-security/cookie-security flagging
   * their own test fixtures as real findings.)
   */
  /**
   * Is this repo-relative path test/fixture code?
   *
   * Modules use this to downgrade findings (usually error → info) in code
   * that is not shipped. It replaces 6 DIFFERENT hand-rolled `TEST_PATH_RE`
   * bodies that had been copy-pasted across 20 modules and then drifted, so
   * whether `src/foo.test.js` counted as a test depended on which module
   * found it (KI #77).
   *
   * SEPARATOR NORMALISATION IS THE POINT, not a detail. `path.relative()`
   * returns `tests\helper.js` on Windows, and every one of those regexes
   * required `/`. Eight modules — async-iteration, env-vars, hardcoded-url,
   * import-cycle, openapi-drift, race-condition, resource-leak, ssrf —
   * tested the raw value, so on any Windows checkout a file under `tests/`
   * was NOT recognised unless its name also carried `.test.`/`.spec.`.
   * Findings in `tests/helper.js`, `tests/setup.js`, `spec/support/*.js`
   * were reported at full severity; for `ssrf` that is a gate-BLOCKING
   * error rather than an info. Proven by direct predicate comparison
   * 2026-07-28. Normalising here fixes it everywhere at once.
   *
   * The pattern is the union of what those 6 variants were each reaching
   * for — none of them was deliberately narrow, they were just incomplete.
   *
   * @param {string} relPath — repo-relative path, either separator
   * @returns {boolean}
   */
  _isTestPath(relPath) {
    if (typeof relPath !== 'string' || !relPath) return false;
    return TEST_PATH_RE.test(relPath.replace(/\\/g, '/'));
  }

  /**
   * Is this whole line a comment? (`//`, `#`, or a `*` continuation line.)
   *
   * Modules that scan line-by-line for a code pattern need this: prose
   * describing the thing you detect looks exactly like the thing you detect.
   * `retry-hygiene` flagged `no-backoff` and `no-jitter` at
   * `website/app/lib/pentest/probes.js:145` because the line above reads
   * `// Time-based: send sleep(5), expect response delay` — the module
   * matched `sleep(5)` in a sentence about sleep(5) (found 2026-07-28).
   *
   * Companion to `_isInsideStringLiteral`, which covers the other half of
   * "this text is not executable code".
   *
   * Deliberately only whole-line: a trailing `// note` after real code
   * leaves that code executable, and callers wanting position-accurate
   * handling should use `_isInsideStringLiteral` with an index instead.
   *
   * @param {string} line
   * @returns {boolean}
   */
  _isCommentLine(line) {
    if (typeof line !== 'string') return false;
    const t = line.trim();
    if (!t) return false;
    return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
  }

  _isInsideStringLiteral(line, index) {
    // A stack: each entry is a quote character, or '{' for a `${ … }`
    // template expression. Code inside `${}` IS code — until 2026-09-05
    // `apiKey = \`${Math.random()}\`` read as prose to every rule that used
    // this guard, and the security module worked around it by anchoring its
    // regex at the line start, which in turn fired on Math.random() inside
    // a plain string (the inert-fixture sweep caught that).
    const stack = [];
    for (let j = 0; j < index && j < line.length; j += 1) {
      const ch = line[j];
      const top = stack[stack.length - 1];
      if (top === "'" || top === '"' || top === '`') {
        if (ch === '\\') { j += 1; continue; }
        if (ch === top) { stack.pop(); continue; }
        if (top === '`' && ch === '$' && line[j + 1] === '{') { stack.push('{'); j += 1; }
        continue;
      }
      // in code (top-level or inside a template expression)
      if (ch === "'" || ch === '"' || ch === '`') { stack.push(ch); continue; }
      if (top === '{') {
        if (ch === '{') stack.push('{');
        else if (ch === '}') stack.pop();
      }
    }
    const top = stack[stack.length - 1];
    return top === "'" || top === '"' || top === '`';
  }

  // A `/` opens a regex literal (not a division operator) when the last
  // non-space character emitted so far is one of these — covers the
  // overwhelming majority of real code AND test-assertion style
  // (`assert.match(x, /foo/)`, `.test(/foo/)`, `const re = /foo/`), without
  // the false-positive risk of trying to fully disambiguate JS grammar.
  static _REGEX_PRECEDING_RE = /[([{,:=!&|;]$|^$/;

  /**
   * Blank out the contents of string ('/"/`) and regex (/.../ ) literals on
   * a line, keeping the delimiters so downstream regexes that only care
   * about structure (not content) still see them. Regex literals matter
   * because rules that match on stripped `line` still see straight through
   * one: `assert.doesNotMatch(result, /rejectUnauthorized: false/)` is a
   * test assertion, not a live config value, but textually contains the
   * exact vulnerable pattern the module is designed to flag. Found via
   * self-scan 2026-07-15 (tls-security + cookie-security self-flagging
   * their own test files' regex-literal assertions).
   */
  _stripJsStrings(line, inTemplate) {
    let out = '';
    let state = inTemplate ? '`' : null;
    let j = 0;
    while (j < line.length) {
      const ch = line[j];
      if (state) {
        if (state === '/') {
          if (ch === '\\') { out += '  '; j += 2; continue; }
          if (ch === '[') { out += ' '; state = '/['; j += 1; continue; }
          if (ch === '/') { out += ch; state = null; j += 1; continue; }
          out += ' ';
          j += 1;
          continue;
        }
        if (state === '/[') {
          // Inside a regex character class — `/` doesn't close the regex here.
          if (ch === '\\') { out += '  '; j += 2; continue; }
          if (ch === ']') { out += ' '; state = '/'; j += 1; continue; }
          out += ' ';
          j += 1;
          continue;
        }
        if (ch === '\\') {
          out += '  ';
          j += 2;
          continue;
        }
        if (ch === state) {
          out += ch;
          state = null;
          j += 1;
          continue;
        }
        out += ' ';
        j += 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        out += ch;
        state = ch;
        j += 1;
        continue;
      }
      if (ch === '/' && BaseModule._REGEX_PRECEDING_RE.test(out.trimEnd())) {
        out += ch;
        state = '/';
        j += 1;
        continue;
      }
      out += ch;
      j += 1;
    }
    return { stripped: out, inTemplate: state === '`' };
  }
}

module.exports = BaseModule;
// The one test-path definition, for the standalone predicates that have no
// module instance to call `_isTestPath()` on (auth-bypass's exempt-path
// check, duplicate-code's skip list). Same regex, same drift guard.
module.exports.TEST_PATH_RE = TEST_PATH_RE;
