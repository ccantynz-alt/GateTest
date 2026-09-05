/**
 * Error Swallow Module — silent catches, floating promises, unchecked
 * async errors.
 *
 * The single most common production bug we see across every
 * codebase is error swallowing. `try { ... } catch {}` in a webhook
 * handler. `.catch(() => {})` after a Stripe call. A missing `await`
 * on `db.commit()`. An `if (err) return;` in a Node callback that
 * drops the error on the floor. Each one looks harmless in code
 * review — each one deletes an alert that would have caught a bug
 * before it hit the customer.
 *
 * ESLint's `no-empty` catches a fraction of this (only literal empty
 * `catch` blocks). It misses:
 *   - catch blocks that only log and return
 *   - `.catch(() => {})` / `.catch(() => null)` on promise chains
 *   - missing `await` on a function call whose return type is a
 *     Promise (fire-and-forget)
 *   - Node-callback `(err, data) => { ... data }` that never
 *     branches on `err`
 *   - `process.on('uncaughtException', () => {})` / `unhandledRejection`
 *     handlers that swallow
 *
 * We cover all six families.
 *
 * Discovery: `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`,
 * `.cts`. HARNESS code — tests (`*.test.*`, `*.spec.*`, `tests/`,
 * `__tests__/`, `spec/`) and benchmarks (`bench/`, `benchmarks/`,
 * `perf/`, and the compounds `HARNESS_DIR_RE` in
 * `src/core/scan-scope.js` recognises) — is scanned at reduced
 * severity. A silent catch in a test or a benchmark is usually the
 * point of the measurement, not a defect: zod's
 * `packages/zod/src/v3/benchmarks/` times the throw path 22 times and
 * used to be told 22 times that it had erased an error. This is the
 * module's own long-standing test-path calibration, applied to the
 * other kind of harness; it is SCOPE, and the finding still reports.
 *
 * Rules:
 *
 *   error:   truly bare empty `catch (err) { }` block — no code, no
 *            comment                                          (prod)
 *            warning in a test/benchmark harness, and warning when the
 *            failure is GUARDED: the try block exits on success and
 *            code follows the catch, or the try only assigns a target
 *            the following code then tests. In a parsing library
 *            `try { ... } catch {}` is usually "that shape did not
 *            parse, fall through" — see `src/core/guarded-catch.js`
 *            for the discriminator and its control pairs.
 *            (rule: `error-swallow:empty-catch:<rel>:<line>`)
 *   warning: catch block that contains ONLY comments — a comment
 *            documents intent, it doesn't handle the error. Still a
 *            surfaced finding, not a blocking one: this codebase's own
 *            documented idiom is a commented catch explaining WHY it's
 *            safe, and the module's own fix advice blesses that pattern.
 *            (rule: `error-swallow:empty-catch:<rel>:<line>`)
 *   error:   catch block that only calls `console.log`/`console.warn`
 *            and does not re-throw — visible in logs but breaks
 *            downstream callers
 *            (rule: `error-swallow:log-and-eat:<rel>:<line>`)
 *   error:   `.catch(() => {})` / `.catch(() => null)` /
 *            `.catch(() => undefined)` on a Promise chain — swallows
 *            the reason. `.catch(noop)` where `noop = () => {}` is
 *            also caught.
 *            (rule: `error-swallow:catch-noop:<rel>:<line>`)
 *   warning: `process.on('uncaughtException', ...)` /
 *            `'unhandledRejection'` handler that doesn't re-throw or
 *            call `process.exit`
 *            (rule: `error-swallow:global-silent-handler:<rel>:<line>`)
 *   warning: Node-callback `(err, ...) => {` that references `err`
 *            neither in a conditional nor a throw — error never
 *            surfaces
 *            (rule: `error-swallow:callback-err-ignored:<rel>:<line>`)
 *   warning: statement-level call to a function whose name strongly
 *            suggests a Promise (`.save()`, `.commit()`, `.then()`,
 *            `.fetch()`, `.send()`, `await*`) with NO `await` and NO
 *            `.then(` / `.catch(` — fire-and-forget
 *            (rule: `error-swallow:floating-promise:<rel>:<line>`)
 *
 * TODO(gluecron): Once Gluecron runs first-party CI and ships its own
 * SDK, extend floating-promise detection to the Gluecron API client
 * (every `gluecron.call.*` returns a Promise).
 */

const fs = require('fs');
const path = require('path');
const BaseModule = require('./base-module');
const { HARNESS_DIR_RE } = require('../core/scan-scope');
const { classifyEmptyCatch, maskNonCode } = require('../core/guarded-catch');

// Directory excludes beyond what `BaseModule._collectFiles` already skips
// (node_modules, .git, dist, build, coverage, .next, out, …). The old
// private walk (removed under KI #104) also skipped these.
const EXTRA_EXCLUDES = ['.terraform'];

const SOURCE_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

// Function names whose invocation returns a Promise commonly enough
// that calling without await/then/catch is a smell. Deliberately
// narrow — we'd rather miss cases than shout false positives.
const PROMISE_METHOD_HINTS = [
  'save', 'commit', 'rollback', 'update', 'insert', 'delete',
  'query', 'exec', 'send', 'publish', 'fetch',
  'capture', 'confirm', 'charge', 'refund', 'cancel',
  'flush', 'sync', 'upload', 'download',
];
// NOTE: `.write()` is deliberately NOT a promise hint. Node's Writable.write()
// and http.ClientRequest.write() return a BOOLEAN (the backpressure signal),
// never an awaitable promise — on ANY receiver (out.write, req.write,
// sink.write, a bare stream variable). Including it flagged every stream write
// as an "unhandled promise", a false-positive flood on any repo that touches
// http/streams (42 FPs on our own codebase). The receiver allowlist below
// can't enumerate every stream variable name, so the fix is to not treat
// `.write()` as promise-returning at all. (Removed 2026-07-11.)

// Receivers whose `.send()` / `.delete()` / `.write()` / `.update()` etc.
// are SYNC by convention and would produce a flood of false positives if
// flagged. Express response object (`res.send()`), Express router
// (`app.delete('/foo', ...)`), Koa context (`ctx.body = ...`), Fastify
// reply (`reply.send()`), Hapi response toolkit (`h.response()`), Node
// stream (`stream.write()` returns boolean), Buffer/string builders.
//
// When the receiver chain matches one of these names (top-level), skip
// the floating-promise check entirely. Better to miss a genuine smell on
// `res.send()` than to produce a 200-finding noise wall on every
// Express app.
const SYNC_RECEIVER_NAMES = new Set([
  'res', 'response', 'reply', 'ctx', 'context', 'h',
  'app', 'router', 'route', 'server', 'next',
  'console', 'logger', 'log',
  'stream', 'socket', 'ws', 'process', 'stdout', 'stderr', 'stdin',
  'buffer', 'buf',
  'xhr', 'xmlhttprequest',
  // `this` / `self` are typically the route handler / response object in
  // Express-style code. Better to miss a real DB-call-on-this than flood
  // every middleware with FPs.
  'this', 'self',
]);

function receiverTopLevel(receiverExpr) {
  // For `a.b.c` return `a`. For `this.foo` return `this`.
  const dot = receiverExpr.indexOf('.');
  return dot === -1 ? receiverExpr : receiverExpr.slice(0, dot);
}

// String-aware "inside a string literal" guard (copied in spirit from
// flaky-tests.js — kept local to avoid cross-module coupling).
function isInString(line, idx) {
  let inS = false; let inD = false; let inT = false;
  for (let i = 0; i < idx && i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\') { i += 1; continue; }
    if (!inD && !inT && ch === '\'') inS = !inS;
    else if (!inS && !inT && ch === '"') inD = !inD;
    else if (!inS && !inD && ch === '`') inT = !inT;
  }
  return inS || inD || inT;
}

class ErrorSwallowModule extends BaseModule {
  constructor() {
    super(
      'errorSwallow',
      'Error Swallow — empty catch, .catch(noop), callback-err ignored, floating promises, global silent handlers',
    );
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    // Shared walk from BaseModule — honours --diff/--pr scoping (KI #104).
    const files = this._collectFiles(projectRoot, [...SOURCE_EXTS], EXTRA_EXCLUDES);

    if (files.length === 0) {
      result.addCheck('error-swallow:no-files', true, {
        severity: 'info',
        message: 'No JS/TS source files found — skipping',
      });
      return;
    }

    result.addCheck('error-swallow:scanning', true, {
      severity: 'info',
      message: `Scanning ${files.length} JS/TS file(s)`,
    });

    let issues = 0;
    for (const file of files) {
      issues += this._scanFile(file, projectRoot, result);
    }

    result.addCheck('error-swallow:summary', true, {
      severity: 'info',
      message: `Error-swallow scan: ${files.length} file(s), ${issues} issue(s)`,
    });
  }

  // Returns true if the current line or the previous line carries a
  // `// error-ok` or `// gatetest-fire-and-forget` suppressor comment,
  // meaning the developer has documented that this specific swallow is
  // intentional.
  _isSuppressed(lines, lineIdx) {
    const line = lines[lineIdx] || '';
    const prev = lineIdx > 0 ? lines[lineIdx - 1] : '';
    const re = /\b(?:error-ok|gatetest-fire-and-forget)\b/;
    return re.test(line) || re.test(prev);
  }

  // Returns true when the `.catch(...)` on the current line is part of
  // a `void expression` statement — the explicit, idiomatic JS pattern
  // (also ESLint's `no-floating-promises` recommendation) for
  // intentional fire-and-forget. We walk back up to 2 lines looking
  // for a `void ` at statement start, stopping at a prior statement
  // boundary so we don't accidentally accept an unrelated `void` above.
  _isVoidFireAndForget(lines, lineIdx) {
    for (let j = lineIdx; j >= Math.max(0, lineIdx - 2); j -= 1) {
      const trimmed = (lines[j] || '').trim();
      if (/^void\s+[\w$(]/.test(trimmed)) return true;
      // Hit a prior statement boundary — stop walking back. The
      // current line itself is allowed to end with `;` (the chain
      // we're checking).
      if (j !== lineIdx && /;\s*$/.test(trimmed)) return false;
    }
    return false;
  }

  // Strips `//` line comments and `/* */` block comments from a catch
  // body so a comment-only catch (`catch (err) { // nothing to do here }`)
  // is treated as empty — comments document intent, they don't handle
  // the error. `isInString` keeps us from truncating a line at a `//`
  // that's actually inside a string literal in the catch body.
  _stripComments(body) {
    const withoutBlocks = body.replace(/\/\*[\s\S]*?\*\//g, '');
    return withoutBlocks
      .split('\n')
      .map((l) => {
        const idx = l.indexOf('//');
        if (idx === -1 || isInString(l, idx)) return l;
        return l.slice(0, idx);
      })
      .join('\n')
      .trim();
  }

  _scanFile(file, projectRoot, result) {
    let content;
    try { content = fs.readFileSync(file, 'utf-8'); } catch { return 0; }

    const rel = path.relative(projectRoot, file);
    const relPosix = rel.replace(/\\/g, '/');
    // A benchmark is the same KIND of code as a test: a harness, not something
    // that ships. `HARNESS_DIR_RE` is the engine's single definition of that
    // (src/core/scan-scope.js) — this module used to know only about tests, so
    // zod's `packages/zod/src/v3/benchmarks/` measured the throw path 22 times
    // and was told 22 times that it had erased an error.
    const isHarness = this._isTestPath(relPosix) || HARNESS_DIR_RE.test(relPosix);
    const lines = content.split('\n');
    // Masked copy (string and comment CONTENT blanked, offsets preserved) for
    // the structural analysis in guarded-catch — and for `_isExecutableAt`,
    // which is what keeps this module from reporting the examples in its own
    // documentation. Built once per file.
    const masked = maskNonCode(content).split('\n');
    let issues = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // 1. Empty catch block — `catch (err) {}` or `catch {}` on one
      //    line, OR `catch (err) {` followed immediately by `}`.
      const catchOnLine = line.match(/\bcatch\s*(?:\(([^)]*)\))?\s*\{/);
      if (catchOnLine && !isInString(line, catchOnLine.index) && this._isExecutableAt(masked, i, line, catchOnLine.index) && !this._isSuppressed(lines, i)) {
        const bodyText = this._collectBlockBody(lines, i, catchOnLine.index);
        const rawBody = bodyText.closed ? bodyText.body.trim() : bodyText.body;
        const effectiveBody = bodyText.closed ? this._stripComments(bodyText.body) : bodyText.body;
        const isBareEmpty = bodyText.closed && rawBody === '';
        const isCommentOnly = bodyText.closed && !isBareEmpty && effectiveBody === '';
        if (isBareEmpty || isCommentOnly) {
          // Is the failure observable by the code around the catch? A
          // fallthrough alternative, or a target the next statement tests, is
          // a handled branch rather than a swallow. Only worth asking about a
          // bare empty catch that would otherwise block.
          const guard = (isBareEmpty && !isHarness)
            ? classifyEmptyCatch(masked, i, catchOnLine.index)
            : { guarded: false };
          issues += this._flag(
            result,
            `error-swallow:empty-catch:${rel}:${i + 1}`,
            this._emptyCatchDetails({ rel, line: i + 1, isHarness, isBareEmpty, guard }),
          );
        } else if (bodyText.closed && this._isLogAndEat(bodyText.body)) {
          issues += this._flag(result, `error-swallow:log-and-eat:${rel}:${i + 1}`, {
            severity: isHarness ? 'info' : 'error',
            file: rel,
            line: i + 1,
            message: `${rel}:${i + 1} catch block only logs and does not re-throw — visible in logs but invisible to callers, breaks downstream error handling`,
            suggestion: 'Either re-throw after logging, call `next(err)` in Express, or convert to a typed Result. Don\'t pretend the operation succeeded.',
          });
        }
      }

      // 2. `.catch(() => {})` / `.catch(() => null)` / `.catch(noop)`
      // Suppressed when the chain is part of a `void expression`
      // statement — the idiomatic JS fire-and-forget pattern.
      const catchNoop = line.match(/\.catch\s*\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:\{\s*\}|null|undefined|void\s+0)\s*\)/);
      if (catchNoop && !isInString(line, catchNoop.index) && this._isExecutableAt(masked, i, line, catchNoop.index) && !this._isSuppressed(lines, i) && !this._isVoidFireAndForget(lines, i)) {
        issues += this._flag(result, `error-swallow:catch-noop:${rel}:${i + 1}`, {
          severity: isHarness ? 'warning' : 'error',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} has \`.catch(() => {})\` or equivalent — Promise rejection is silently dropped`,
          suggestion: 'Replace with `.catch((err) => log.error({ err }, "context"))` and either rethrow or surface a typed error. If this is intentional fire-and-forget, use `void promise` (the JS idiom) or add `// gatetest-fire-and-forget` on the line above.',
        });
      }
      // `.catch(noop)` / `.catch(ignore)` / `.catch(() => { /* ignore */ })`
      // — same void-prefix suppression applies.
      const catchNamedNoop = line.match(/\.catch\s*\(\s*(?:noop|ignore|swallow|_)\s*\)/);
      if (catchNamedNoop && !isInString(line, catchNamedNoop.index) && this._isExecutableAt(masked, i, line, catchNamedNoop.index) && !this._isSuppressed(lines, i) && !this._isVoidFireAndForget(lines, i)) {
        issues += this._flag(result, `error-swallow:catch-noop:${rel}:${i + 1}`, {
          severity: isHarness ? 'warning' : 'error',
          file: rel,
          line: i + 1,
          message: `${rel}:${i + 1} passes a known noop (\`noop\`/\`ignore\`/\`swallow\`/\`_\`) to \`.catch()\``,
          suggestion: 'Give the handler a real body, or use `void promise` for fire-and-forget, or add `// gatetest-fire-and-forget`.',
        });
      }

      // 3. Global silent handlers
      const globalHandler = line.match(/process\.on\s*\(\s*['"`](uncaughtException|unhandledRejection)['"`]/);
      if (globalHandler && !isInString(line, globalHandler.index) && this._isExecutableAt(masked, i, line, globalHandler.index) && !this._isSuppressed(lines, i)) {
        // Look at next ~8 lines for a throw/exit/log-with-rethrow
        const windowText = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
        const hasExit = /\bprocess\.exit\s*\(/.test(windowText);
        const hasThrow = /\bthrow\b/.test(windowText);
        if (!hasExit && !hasThrow) {
          issues += this._flag(result, `error-swallow:global-silent-handler:${rel}:${i + 1}`, {
            severity: 'warning',
            file: rel,
            line: i + 1,
            event: globalHandler[1],
            message: `${rel}:${i + 1} attaches a \`process.on('${globalHandler[1]}', ...)\` handler that doesn't re-throw or exit — crashes become silent`,
            suggestion: 'Log with structured context, then `process.exit(1)` or rethrow. A silent `uncaughtException` handler turns every crash into data corruption.',
          });
        }
      }

      // 4. Node-callback `(err, ...) => { ... }` / `function (err, ...) { }`
      //    that doesn't branch on err. The classic `function` form is how
      //    every legacy Mongo/Redis/fs API takes its callback — the
      //    arrow-only regex missed all of them (2026-08-18 audit residue).
      //    Conservative: only flag if the callback BODY never mentions
      //    `err`, scanning to the brace-balanced end of the callback (the
      //    old fixed 5-line window false-fired on bodies that handle the
      //    error on line 6+). We look ONLY after the opening brace to
      //    avoid counting the param itself.
      const nodeCb = line.match(/\(\s*(err|error)\s*,\s*[^)]+\)\s*=>\s*\{/)
        || line.match(/function\s*(?:[A-Za-z_$][\w$]*\s*)?\(\s*(err|error)\s*,\s*[^)]+\)\s*\{/);
      if (nodeCb && !isInString(line, nodeCb.index) && this._isExecutableAt(masked, i, line, nodeCb.index) && !this._isSuppressed(lines, i)) {
        const errName = nodeCb[1];
        // Body starts right after the `{` on this line; scan until the
        // callback's braces balance (capped at 60 lines for pathological
        // files — a longer body that still never says `err` has earned it).
        const braceOffset = line.indexOf('{', nodeCb.index + nodeCb[0].length - 1);
        const sameLineBody = braceOffset >= 0 ? line.slice(braceOffset + 1) : '';
        const bodyLines = [sameLineBody];
        let depth = 1;
        for (const ch of sameLineBody) {
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
        }
        for (let k = i + 1; k < Math.min(lines.length, i + 61) && depth > 0; k += 1) {
          bodyLines.push(lines[k]);
          for (const ch of lines[k]) {
            if (ch === '{') depth += 1;
            else if (ch === '}') { depth -= 1; if (depth === 0) break; }
          }
        }
        const bodyWindow = bodyLines.join('\n');
        const mentionsErr = new RegExp(`\\b${errName}\\b`).test(bodyWindow);
        if (!mentionsErr) {
          issues += this._flag(result, `error-swallow:callback-err-ignored:${rel}:${i + 1}`, {
            severity: 'warning',
            file: rel,
            line: i + 1,
            message: `${rel}:${i + 1} Node-style callback \`(${errName}, ...)\` never references \`${errName}\` — every error is dropped`,
            suggestion: `Branch on \`if (${errName}) { /* handle or rethrow */ }\` or, better, promisify the API.`,
          });
        }
      }

      // 5. Floating promise heuristic — statement-level call to a
      //    known promise-returning method, NOT preceded by `await`,
      //    `return`, `void`, `=` etc., and NOT followed on the same
      //    line by `.then(` or `.catch(`. Deliberately narrow.
      if (!isHarness) {
        const flt = line.match(/^(\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)\s*\(/);
        if (flt && !isInString(line, flt.index) && this._isExecutableAt(masked, i, line, flt.index) && !this._isSuppressed(lines, i)) {
          const indent = flt[1];
          const receiver = flt[2];
          const method = flt[3];
          const topLevel = receiverTopLevel(receiver).toLowerCase();
          // Skip well-known sync receivers (res.send, app.delete, ctx.body,
          // stream.write, logger.send, etc.) — these would produce a flood
          // of false positives on any Express / Koa / Fastify / Hapi app.
          if (SYNC_RECEIVER_NAMES.has(topLevel)) continue;
          // Collection/cookie .delete() guard: Map/Set/WeakMap.delete(key) and
          // cookieStore.delete(name) return a boolean/void, not a promise, and
          // take a BARE KEY. An ORM delete (prisma.user.delete({where:{id}}))
          // takes an OBJECT LITERAL. So only treat `.delete(` as promise-ish
          // when its first argument opens with `{`. Kills the Map/Set/cookie
          // false-positive class without losing real floating DB deletes.
          if (method.toLowerCase() === 'delete') {
            const afterOpen = line.slice(flt.index + flt[0].length).trimStart();
            if (!afterOpen.startsWith('{')) continue;
          }
          if (PROMISE_METHOD_HINTS.includes(method.toLowerCase())) {
            // Prefix check — is the statement preceded by await/return/void/= ?
            const before = line.slice(0, flt.index + indent.length);
            const head = line.slice(flt.index + indent.length);
            const prevNonWs = before.trim();
            const looksAwaited = /\b(?:await|return|void|yield)\s*$/.test(prevNonWs)
              || /[=!?([,]\s*$/.test(prevNonWs);
            const chained = /\.(?:then|catch|finally)\s*\(/.test(head);
            if (!looksAwaited && !chained) {
              issues += this._flag(result, `error-swallow:floating-promise:${rel}:${i + 1}`, {
                severity: 'warning',
                file: rel,
                line: i + 1,
                method,
                message: `${rel}:${i + 1} calls \`.${method}()\` without \`await\` / \`.then(...)\` / \`.catch(...)\` — a rejection here becomes an unhandled promise rejection`,
                suggestion: `Add \`await\` if this is inside an async function, or chain \`.catch()\` to handle the rejection.`,
              });
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * Is the match at `idx` executable code, or prose that looks like it?
   *
   * Found by self-scan 2026-09-04: the doc comment at the top of
   * `src/core/guarded-catch.js` shows `try { await db.commit(); } catch {}` as
   * the example of a genuine swallow, and this module reported it — twice, at
   * ERROR, blocking our own repo on its own documentation. `_isCommentLine`
   * only covers a whole line starting with `//`; a `/** ... *\/` block or a
   * trailing comment slipped straight through, and `isInString` answers a
   * different question.
   *
   * The masked copy already blanks comment and string content while keeping
   * every offset, so the test is simply: is the character still there?
   */
  _isExecutableAt(masked, lineIdx, line, idx) {
    const m = masked && masked[lineIdx];
    if (typeof m !== 'string') return true;
    let p = idx;
    while (p < line.length && /\s/.test(line[p])) p += 1;
    return m[p] === line[p];
  }

  /**
   * The finding for an empty / comment-only catch, at the severity its
   * evidence supports.
   *
   *   error    a bare `catch {}` in shipped code whose failure nothing
   *            downstream can observe — the real swallow
   *   warning  a comment-only catch (a comment documents intent, it does not
   *            handle the error), a catch in a test/benchmark harness, or a
   *            GUARDED ATTEMPT: the try's success path exits and code follows,
   *            or the try only assigns a target the next statement tests
   *
   * A guarded attempt is downgraded, never dropped. "The repo went quiet" is
   * not evidence that a rule got smarter, so the finding stays on the report
   * with the reason it is not blocking written into it.
   */
  _emptyCatchDetails({ rel, line, isHarness, isBareEmpty, guard }) {
    const at = `${rel}:${line}`;
    if (!isBareEmpty) {
      return {
        severity: 'warning',
        file: rel,
        line,
        message: `${at} catch block contains only comments — a comment documents intent but does not handle the error`,
        suggestion: 'A comment alone doesn\'t handle the error — if it\'s genuinely safe to ignore, keep the comment AND add a log call so the swallow is visible in production.',
      };
    }
    if (guard && guard.guarded) {
      const why = guard.shape === 'fallthrough'
        ? 'the try block exits on success, so the code after the catch IS the failure path'
        : `the try block only sets \`${guard.target}\`, which the code after the catch then tests`;
      return {
        severity: 'warning',
        file: rel,
        line,
        guarded: guard.shape,
        message: `${at} has an empty catch block, but the failure is handled by the surrounding control flow — ${why}`,
        suggestion: 'Not blocking: this reads as an attempted operation with a fallback path, not a swallowed error. Confirm the fallback covers every failure (a bare `catch` also swallows programmer errors such as TypeError); one comment naming the fallback makes that explicit.',
      };
    }
    return {
      severity: isHarness ? 'warning' : 'error',
      file: rel,
      line,
      message: `${at} has an empty catch block — any error thrown in the try is erased`,
      suggestion: 'At minimum log the error with context; preferably rethrow or handle it. If the error is genuinely expected and benign, comment WHY.',
    };
  }

  // Best-effort block-body extractor. Starting at `lines[lineIdx]`
  // with `{` at `openIdx` on that line, walk forward counting braces
  // (string-aware) and return the concatenated body (excluding the
  // outermost braces) plus whether the block was closed.
  _collectBlockBody(lines, lineIdx, hintIdx) {
    const startLine = lines[lineIdx];
    const braceIdx = startLine.indexOf('{', hintIdx);
    if (braceIdx === -1) return { body: '', closed: false };

    let depth = 1;
    let body = '';
    let firstLineRemainder = startLine.slice(braceIdx + 1);
    const walkLine = (text) => {
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') { depth += 1; body += ch; }
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) return { closed: true, rest: text.slice(i + 1) };
          body += ch;
        }
        else body += ch;
      }
      return { closed: false, rest: '' };
    };
    // Process first-line remainder
    const first = walkLine(firstLineRemainder);
    if (first.closed) return { body: body.trim(), closed: true };

    body += '\n';
    for (let j = lineIdx + 1; j < lines.length && j < lineIdx + 40; j += 1) {
      const res = walkLine(lines[j]);
      if (res.closed) return { body: body.trim(), closed: true };
      body += '\n';
    }
    return { body: body.trim(), closed: false };
  }

  // True if the catch body only contains `console.*` calls (or a
  // comment) and no throw / reject / return with an error.
  _isLogAndEat(body) {
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    if (lines.length === 0) return false;
    // Must not throw or reject or return an error value
    if (/\bthrow\b/.test(body)) return false;
    if (/\breject\s*\(/.test(body)) return false;
    if (/\breturn\s+.*\berr(?:or)?\b/.test(body)) return false;
    if (/\bnext\s*\(\s*\w+/.test(body)) return false; // Express-style next(err)
    // A catch that ends the process is the opposite of a swallow: nothing
    // downstream runs to be misled. `console.error(...); process.exit(2)`
    // is the standard CLI shape and was reported as log-and-eat until
    // 2026-09-05 (bin/gatetest.js verify-report).
    if (/\bprocess\.(?:exit\s*\(|exitCode\s*=)/.test(body)) return false;
    // Every non-empty line must look like a log call
    return lines.every((l) => /^console\.(?:log|warn|error|info|debug)\s*\(/.test(l)
      || /^(?:log|logger)\.(?:log|warn|error|info|debug)\s*\(/.test(l));
  }

  _flag(result, name, details) {
    result.addCheck(name, false, details);
    return 1;
  }
}

module.exports = ErrorSwallowModule;
