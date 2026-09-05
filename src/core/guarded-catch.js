/**
 * Is an empty `catch {}` a swallowed error, or the failure branch of an
 * attempt the surrounding code already handles?
 *
 * WHY THIS EXISTS. Measured 2026-09-04 on colinhacks/zod @7a002366: 33 of the
 * repo's 50 blocking findings came from `errorSwallow`, and 7 of those were in
 * real shipped source (`packages/zod/src/v4/core/{schemas,compile}.ts`). Every
 * one of the 7 looked like this:
 *
 *     if (def.coerce)
 *       try {
 *         payload.value = Number(payload.value);
 *       } catch (_) {}
 *     const input = payload.value;
 *     if (typeof input === "number" && !Number.isNaN(input)) return payload;
 *     payload.issues.push({ expected: "number", code: "invalid_type", ... });
 *
 * Nothing is erased there. The try block's only job is to *attempt* a value,
 * and the line after the catch inspects whether the attempt worked and pushes
 * a validation issue when it did not. The failure is not merely survivable, it
 * is the thing the next statement measures. Telling a parsing library that its
 * coercion fallback is "an error thrown in the try is erased" is wrong on the
 * facts, and it is the difference between a gate a library adopts and one it
 * uninstalls.
 *
 * WHAT IS ACTUALLY DIFFERENT between that and a genuine swallow. In
 *
 *     try { await db.commit(); } catch {}
 *
 * nothing downstream can tell the commit failed: the try block's effect left
 * the process, and no later statement observes it. That is the discriminator
 * encoded here — not "is this file a parser", not "does the catch bind `_`",
 * but *can the code after the catch observe the failure*:
 *
 *   FALLTHROUGH     the try block's success path exits (`return` / `throw` /
 *                   `break` / `continue`) at its top level, and there is code
 *                   after the catch. Reaching that code IS the failure path;
 *                   the empty catch is a branch, not a black hole.
 *
 *   CHECKED-TARGET  every top-level statement in the try block assigns to the
 *                   same target, and the code after the catch TESTS that
 *                   target (or a variable aliased directly from it) — a
 *                   `typeof` / `instanceof` / comparison / `if` / ternary.
 *                   The attempt failed, the target kept its previous value,
 *                   and the check downstream is what notices.
 *
 *   RETHROW         the code after the catch begins with a `throw`. The
 *                   function is already on its failure path and raising the
 *                   primary cause; a secondary failure erased here would
 *                   otherwise have MASKED that cause.
 *
 *   CLEANUP         the catch sits inside a `finally` block, or inside a
 *                   function whose name says it is teardown (`close`, `end`,
 *                   `destroy`, `dispose`, `destroyConnection`,
 *                   `ownedDispose` — `isTeardownName`). The resource is being
 *                   discarded; a failure to discard it has no consumer by
 *                   construction, and thrown from a `finally` it would
 *                   REPLACE whatever the try block returned or threw. Measured
 *                   2026-09-05 on prisma @HEAD: `scripts/lint-casts.mjs:107`
 *                   (`finally { try { git('worktree','remove',...) } catch {}
 *                   rmSync(tmpDir, { force: true }) }`) and 16 `.catch(() =>
 *                   undefined)` on `close()` / `end()` / `destroy()` calls,
 *                   one of them carrying prisma's own reasoning in a comment:
 *                   "we're already about to throw a more informative error …
 *                   surfacing [the teardown error] would mask the original
 *                   cause" (`sql-runtime.ts:1036`).
 *
 * Deliberately NOT a suppression. A guarded attempt is still reported — it
 * drops from blocking to warning, the same calibration the module already
 * applies to comment-only catches. If the target is only *read* and never
 * *tested* (`try { x = await fetchUser(); } catch {} return x;`), the caller
 * cannot distinguish "no user" from "the network is down" and the finding
 * keeps blocking.
 *
 * Pure text analysis, no fs — so it can be tested against hand-written
 * snippets with known answers, positive controls included.
 */

'use strict';

// How far to look for the try's opening brace, the catch's closing brace, and
// the code after it. Bodies longer than this are pathological and fall back to
// "not guarded", which is the safe direction: the finding keeps blocking.
const LOOKBEHIND_LINES = 120;
const LOOKAHEAD_LINES = 60;
const AFTER_LINES = 40;


/**
 * Replace the *contents* of string literals, comments and regex literals with
 * spaces, keeping the text the same length (and the same newlines) so every
 * offset computed against the mask is valid against the original.
 *
 * Structural scanning has to run on this, not on the raw text: a brace inside
 * `"} catch {"` is not a brace, and `// if (x)` is not a branch.
 *
 * Regex literals are masked for a reason worth stating, because getting it
 * wrong fails toward SILENCE. A pattern like `/["']/` carries an unbalanced
 * quote; without regex handling the masker enters string state there and
 * blanks the rest of the file, so every `catch {}` below it disappears from
 * the mask — and `_isExecutableAt` then reads those findings as prose and
 * drops them. Caught by a control test before this shipped.
 */
/**
 * Walk forward from the `{` at/after `hintIdx` on `startLine` and return the
 * position of its matching `}`. `masked` must be the masked line array.
 */
function findBlockEnd(masked, startLine, hintIdx) {
  const open = (masked[startLine] || '').indexOf('{', hintIdx);
  if (open === -1) return null;
  let depth = 0;
  const last = Math.min(masked.length - 1, startLine + LOOKAHEAD_LINES);
  for (let ln = startLine; ln <= last; ln += 1) {
    const text = masked[ln] || '';
    for (let col = ln === startLine ? open : 0; col < text.length; col += 1) {
      const ch = text[col];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return { line: ln, col };
      }
    }
  }
  return null;
}

/**
 * The body of the `try` whose `catch` sits at (`catchLine`, `catchIdx`).
 * Returns the masked body text, or null when the shape cannot be resolved
 * (no preceding `}`, unbalanced braces, or the block is not a `try`).
 */
function tryBodyBefore(masked, catchLine, catchIdx) {
  const from = Math.max(0, catchLine - LOOKBEHIND_LINES);
  const chunkLines = masked.slice(from, catchLine + 1);
  chunkLines[chunkLines.length - 1] = (chunkLines[chunkLines.length - 1] || '').slice(0, catchIdx);
  const chunk = chunkLines.join('\n');

  // Walk back to the `}` that closes the try block.
  let p = chunk.length - 1;
  while (p >= 0 && /\s/.test(chunk[p])) p -= 1;
  if (p < 0 || chunk[p] !== '}') return null;
  const closeAt = p;

  let depth = 0;
  for (; p >= 0; p -= 1) {
    const ch = chunk[p];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (p < 0 || depth !== 0) return null;

  const head = chunk.slice(0, p).trimEnd();
  if (!/\btry$/.test(head)) return null;
  return chunk.slice(p + 1, closeAt);
}

// The text just before a `{` when that brace opens a control-flow body rather
// than a function. `for await (...)` is a loop like any other — without the
// `await` alternative its body read as a function named `await`. The
// condition's parentheses must BALANCE (two levels deep): the earlier
// `\([\s\S]*\)` let an `if (` a hundred characters up the head reach the
// `()` of `public async close()` and read the method as an `if` body
// (trpc `wsClient.ts:144`, 2026-09-05).
const CONTROL_FLOW_HEAD_RE = /(?:^|[\s;{}()])(?:if|else|for(?:\s+await)?|while|switch|do|try|finally|catch)(?![\w$])\s*(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?\s*$/;

/**
 * Walk backwards from a `}` to the `{` it closes, and report whether that
 * block was opened by a control-flow keyword (`if (...) {`, `else {`, `for
 * (...) {` ...) rather than by a function.
 *
 * This is what makes it safe to keep reading past the end of an enclosing
 * block: leaving an `if` body means execution continues on the next line, so
 * that line really is "after the catch". Leaving a FUNCTION body means the
 * next line belongs to the caller, which we cannot see and must not credit.
 */
function blockOpenerIsControlFlow(masked, closeLine, closeCol) {
  const from = Math.max(0, closeLine - LOOKBEHIND_LINES);
  const chunkLines = masked.slice(from, closeLine + 1);
  chunkLines[chunkLines.length - 1] = (chunkLines[chunkLines.length - 1] || '').slice(0, closeCol);
  const chunk = chunkLines.join('\n');
  let depth = 0;
  let p = chunk.length - 1;
  for (; p >= 0; p -= 1) {
    const ch = chunk[p];
    if (ch === '}') depth += 1;
    else if (ch === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (p < 0) return false;
  const head = chunk.slice(Math.max(0, p - 400), p);
  return CONTROL_FLOW_HEAD_RE.test(head);
}

/** Step over a `finally { ... }` / `else { ... }` / `else if (...) { ... }` clause. */
function skipSiblingClauses(masked, pos) {
  let { line, col } = pos;
  for (let guard = 0; guard < 8; guard += 1) {
    let ln = line;
    let cl = col;
    let rest = (masked[ln] || '').slice(cl);
    while (/^\s*$/.test(rest) && ln + 1 < masked.length && ln < line + 3) {
      ln += 1;
      cl = 0;
      rest = masked[ln] || '';
    }
    if (!/^\s*(?:finally|else)\b/.test(rest)) return { line, col };
    const closed = findBlockEnd(masked, ln, cl);
    if (!closed) return null;
    line = closed.line;
    col = closed.col + 1;
  }
  return { line, col };
}

/**
 * The code that runs after the catch block.
 *
 * Stops at the end of the enclosing FUNCTION, not at the first `}`: zod's
 * coercion catches sit inside `if (def.coerce) { ... }`, so the statement that
 * inspects the result (`const input = payload.value; if (typeof input === ...`)
 * lives one block further out. A `finally` or `else` clause is stepped over —
 * neither is the code that runs after the attempt, they are other branches.
 */
function codeAfter(masked, end) {
  let pos = skipSiblingClauses(masked, { line: end.line, col: end.col + 1 });
  if (!pos) return '';
  const collected = [];
  const stopLine = Math.min(masked.length - 1, end.line + AFTER_LINES);

  for (let pops = 0; pops <= 3; pops += 1) {
    let depth = 0;
    let closedAt = null;
    for (let ln = pos.line; ln <= stopLine && !closedAt; ln += 1) {
      const text = masked[ln] || '';
      let buf = '';
      for (let c = ln === pos.line ? pos.col : 0; c < text.length; c += 1) {
        const ch = text[c];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          if (depth === 0) { closedAt = { line: ln, col: c }; break; }
          depth -= 1;
        }
        buf += ch;
      }
      collected.push(buf);
    }
    const text = collected.join('\n');
    // Ran out of window, or found real code before the block ended.
    if (!closedAt || text.trim()) return text;
    // Nothing followed the catch inside this block. If the block is a
    // control-flow wrapper, execution continues after it; if it is a function
    // body, it does not, and the failure really is unobserved.
    if (!blockOpenerIsControlFlow(masked, closedAt.line, closedAt.col)) return text;
    const next = skipSiblingClauses(masked, { line: closedAt.line, col: closedAt.col + 1 });
    if (!next) return text;
    pos = next;
  }
  return collected.join('\n');
}

/** Does `body` exit its own top level (not from inside a nested function)? */
function hasTopLevelExit(body) {
  let depth = 0;
  const re = /\b(?:return|throw|break|continue)\b/g;
  const depthAt = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    depthAt[i] = depth;
  }
  let m = re.exec(body);
  while (m) {
    if ((depthAt[m.index] || 0) === 0) return true;
    m = re.exec(body);
  }
  return false;
}

/** Split `body` into statements at top-level `;` and newlines. */
function topLevelStatements(body) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (ch === ';' || ch === '\n')) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

const ASSIGN_RE = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:=|\+=|-=|\|\|=|\?\?=|&&=)\s*[^=]/;

/**
 * Every top-level statement assigns to something → the list of targets.
 * Anything else (a call, a declaration whose scope dies with the try, a
 * branch) → null: that body is doing work, not attempting a value.
 */
function assignedTargets(body) {
  const statements = topLevelStatements(body);
  if (statements.length === 0) return null;
  const targets = [];
  for (const st of statements) {
    const m = st.match(ASSIGN_RE);
    if (!m) return null;
    if (!targets.includes(m[1])) targets.push(m[1]);
  }
  return targets;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is `target` (or a variable aliased straight from it) TESTED in `after`?
 *
 * Read alone is not enough — a value that is only returned carries no signal
 * that the attempt failed, so `try { x = await fetchUser(); } catch {} return
 * x;` keeps blocking. The caller cannot tell "no user" from "network down".
 *
 * Every pattern anchors the name with an explicit boundary that excludes `.`
 * on the left. Without it, measured on zod's `scripts/compile-fuzz.ts:370`,
 * the target `code` matched `(...).code ?? ""` — an unrelated property on
 * another object, three statements away, in a nested closure. `\b` is not a
 * boundary between `.` and an identifier, and that near-miss is exactly the
 * kind of accident that turns a precision fix into a silent hole.
 */
function isTestedAfter(target, after) {
  const names = [target];
  for (let pass = 0; pass < 2; pass += 1) {
    for (const name of [...names]) {
      const alias = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=;\\n]+)?=\\s*${escapeRe(name)}\\s*(?:;|\\n|$)`, 'g');
      let m = alias.exec(after);
      while (m) {
        if (!names.includes(m[1])) names.push(m[1]);
        m = alias.exec(after);
      }
    }
  }
  return names.some((name) => {
    const n = `(?<![\\w$.])${escapeRe(name)}(?![\\w$])`;
    const tests = [
      new RegExp(`\\btypeof\\s+${n}`),
      new RegExp(`${n}\\s+instanceof\\b`),
      new RegExp(`${n}\\s*(?:===|!==|==|!=|<=|>=|<|>)`),
      new RegExp(`(?:===|!==|==|!=)\\s*${n}`),
      new RegExp(`\\b(?:if|while)\\s*\\(\\s*[!(\\s]*${n}`),
      new RegExp(`\\bswitch\\s*\\(\\s*${n}`),
      new RegExp(`${n}\\s*\\?[^.]`),
      new RegExp(`[!]\\s*${n}`),
      new RegExp(`${n}\\s*(?:\\?\\?|\\|\\||&&)`),
    ];
    return tests.some((re) => re.test(after));
  });
}

// Verbs that name teardown. A bare verb is teardown on its own (`close()`,
// `client.end()`, `conn.destroy(err)`); the first word of a compound is
// teardown only when a RESOURCE noun follows it (`destroyDatabasePool`,
// `closeDb`), because `closeAccount()` is a business operation whose failure
// matters; the LAST word of a compound is accepted only for the four words
// that never name anything but teardown (`ownedDispose`, `ngOnDestroy`,
// `runCleanup`) — `onClose` / `handleClose` are event handlers, not teardown.
const TEARDOWN_VERBS = new Set([
  'close', 'end', 'destroy', 'dispose', 'disconnect', 'quit', 'terminate',
  'shutdown', 'teardown', 'cleanup', 'release', 'stop', 'unsubscribe',
]);
const TEARDOWN_TAIL_WORDS = new Set(['dispose', 'destroy', 'teardown', 'cleanup']);
const RESOURCE_NOUNS = new Set([
  'connection', 'connections', 'conn', 'pool', 'pools', 'client', 'clients',
  'socket', 'sockets', 'server', 'db', 'database', 'stream', 'streams',
  'worker', 'workers', 'browser', 'page', 'session', 'handle', 'handles',
  'resource', 'resources', 'process', 'watcher', 'watchers', 'timer', 'timers',
  'channel', 'channels', 'transport', 'subscription', 'subscriptions',
  'listener', 'listeners', 'runtime', 'driver', 'store', 'cache', 'file',
  'files', 'fd', 'workspace', 'workspaces', 'tmp', 'temp', 'dir', 'directory',
  'all',
]);

/** Split `destroyDatabasePool` / `owned_dispose` / `#closeDb` into lower-case words. */
function nameWords(name) {
  return String(name || '')
    .replace(/^[#_$]+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_$-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does this identifier name a teardown — a function whose contract is that
 * the resource is being discarded?
 */
function isTeardownName(name) {
  const words = nameWords(name);
  if (words.length === 0) return false;
  if (words.length === 1) return TEARDOWN_VERBS.has(words[0]);
  if (TEARDOWN_TAIL_WORDS.has(words[words.length - 1])) return true;
  return TEARDOWN_VERBS.has(words[0]) && words.slice(1).some((w) => RESOURCE_NOUNS.has(w));
}

const RESERVED_HEAD_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'await',
  'yield', 'typeof', 'new', 'else', 'do', 'try', 'finally', 'with', 'class',
  'import', 'export', 'default', 'async', 'in', 'of', 'delete', 'void',
]);
const PARAMS = '\\((?:[^()]|\\([^()]*\\))*\\)';
const NAMED_FUNCTION_HEADS = [
  // `async close(): Promise<void>` / `function destroyPool(a, b)` / `public override end()`
  new RegExp(`(?:^|[\\s;{}(,])(?:(?:export|default|public|private|protected|static|async|override|readonly|get|set|function)\\s+)*\\*?\\s*([A-Za-z_$][\\w$]*)\\s*(?:<[^{}]*>)?\\s*${PARAMS}\\s*(?::\\s*[^{;=]+)?\\s*$`),
  // `const destroyConnection = async (reason: unknown): Promise<void> =>` / `x = (a) =>` / `x = a =>`
  new RegExp(`([A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=]+?)?\\s*=\\s*(?:async\\s+)?(?:${PARAMS}|[A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=]+?)?\\s*=>\\s*$`),
  // `x = async function name(...)` / `x = function (...)`
  new RegExp(`([A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=]+?)?\\s*=\\s*(?:async\\s+)?function\\s*\\*?\\s*(?:[A-Za-z_$][\\w$]*)?\\s*${PARAMS}\\s*(?::\\s*[^{;=]+)?\\s*$`),
  // object property: `close: async () =>` / `close: function ()`
  new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*(?:async\\s+)?(?:function\\s*\\*?\\s*(?:[A-Za-z_$][\\w$]*)?\\s*${PARAMS}|${PARAMS}\\s*(?::\\s*[^=]+?)?\\s*=>)\\s*$`),
];

/** The name of the function a `{` opens, given the text before the brace; null if anonymous or not a function. */
function namedFunctionHead(head) {
  for (const re of NAMED_FUNCTION_HEADS) {
    const m = head.match(re);
    if (m && !RESERVED_HEAD_WORDS.has(m[1])) return m[1];
  }
  return null;
}

const CONTEXT_LOOKBEHIND_LINES = 300;

/**
 * What encloses position (`line`, `col`)? Walks outward through the blocks
 * that contain it, stepping through control-flow bodies and anonymous
 * callbacks, and stops at the first `finally` or the first NAMED function.
 *
 * @returns {{finally: boolean, fn: string|null, teardown: boolean}}
 */
function enclosingContext(masked, line, col) {
  const from = Math.max(0, line - CONTEXT_LOOKBEHIND_LINES);
  const chunkLines = masked.slice(from, line + 1);
  chunkLines[chunkLines.length - 1] = (chunkLines[chunkLines.length - 1] || '').slice(0, col);
  const chunk = chunkLines.join('\n');
  const none = { finally: false, fn: null, teardown: false };
  let depth = 0;
  let hops = 0;
  for (let p = chunk.length - 1; p >= 0 && hops < 16; p -= 1) {
    const ch = chunk[p];
    if (ch === '}') { depth += 1; continue; }
    if (ch !== '{') continue;
    if (depth > 0) { depth -= 1; continue; }
    hops += 1;
    const head = chunk.slice(Math.max(0, p - 500), p);
    if (/(?:^|[\s;{}()])finally\s*$/.test(head)) return { finally: true, fn: null, teardown: false };
    if (CONTROL_FLOW_HEAD_RE.test(head)) continue;
    const fn = namedFunctionHead(head);
    if (fn) return { finally: false, fn, teardown: isTeardownName(fn) };
  }
  return none;
}

/**
 * Classify the empty catch whose `catch` keyword matched at
 * (`catchLine`, `catchIdx`).
 *
 * @param {string[]} masked - stripStringsAndComments(fileContent).split('\n')
 * @returns {{guarded: boolean, shape?: string, target?: string}}
 */
function classifyEmptyCatch(masked, catchLine, catchIdx) {
  const end = findBlockEnd(masked, catchLine, catchIdx);
  if (!end) return { guarded: false };

  const body = tryBodyBefore(masked, catchLine, catchIdx);
  if (body === null || !body.trim()) return { guarded: false };

  const context = enclosingContext(masked, catchLine, catchIdx);
  if (context.finally) return { guarded: true, shape: 'cleanup', context: 'finally' };
  if (context.teardown) return { guarded: true, shape: 'cleanup', context: context.fn };

  const after = codeAfter(masked, end);
  if (!after.trim()) return { guarded: false };

  if (/^\s*throw\b/.test(after)) return { guarded: true, shape: 'rethrow' };
  if (hasTopLevelExit(body)) return { guarded: true, shape: 'fallthrough' };

  const targets = assignedTargets(body);
  if (!targets) return { guarded: false };
  const checked = targets.find((t) => isTestedAfter(t, after));
  if (checked) return { guarded: true, shape: 'checked-target', target: checked };

  return { guarded: false };
}

module.exports = {
  classifyEmptyCatch,
  enclosingContext,
  isTeardownName,
  // exported for direct unit tests of the individual judgements
  findBlockEnd,
  tryBodyBefore,
  codeAfter,
  hasTopLevelExit,
  assignedTargets,
  isTestedAfter,
};
