const { stripStringsAndComments, literalKindAt, splitTopLevel: splitTopLevelMasked } = require('./source-strip');
/**
 * One definition of "this `.innerHTML =` cannot inject markup".
 *
 * The engine had TWO independent innerHTML rules — `src/modules/security.js`
 * and the forbidden-pattern list in `src/core/config.js` (run by codeQuality).
 * Both were bare sink matches. Guarding only the security one on 2026-09-01
 * left codeQuality still failing the gate on this line:
 *
 *     el.innerHTML = "<div>" + escapeHtml(name) + "</div>";
 *
 * which is correctly escaped. Two rules for one concept means fixing the
 * concept once is not enough — so the predicate lives here and both import
 * it. Do not re-inline a copy.
 *
 * The contract is deliberately conservative: return true ONLY when the
 * assignment provably cannot inject. Anything unparseable returns false and
 * the finding stands, because a rule that guesses "safe" when unsure fails
 * silently, and silence is invisible.
 */

// Recognised escapers. A NAMED list, not a substring test for "escape" or
// "clean" — trusting any reassuring-sounding function name is trusting the
// author's naming rather than the code. encodeURIComponent qualifies: it
// percent-encodes `<` and `>`, so its output cannot open a tag.
// `escHtml` / `escapeHtml` / `htmlEscape` are the same function under three
// spellings; `escHtml` was added 2026-09-01 after the cross-engine diff found
// src/lib/mention-autocomplete.ts:46 on Gluecron using it correctly and being
// reported anyway.
//
// Still a NAMED list. A bare `esc(` is deliberately NOT here: it appears in
// the same repo (src/routes/demo.tsx:177) and could equally be "escape",
// "escaped", or something with no HTML semantics at all. Trusting a
// three-letter abbreviation is trusting the author's naming, which is the
// thing this list exists not to do.
const ESCAPER = /\b(?:escapeHtml|escapeHTML|escHtml|escHTML|htmlEscape|escapeHtmlAttr|sanitizeHtml|sanitizeHTML|sanitize|escapeExpression|encodeURIComponent)\s*\(|\bDOMPurify\s*\.\s*sanitize\s*\(|\bpurify\s*\.\s*sanitize\s*\(/;

const STATIC_LITERAL = /^'(?:[^'\\]|\\.)*'$|^"(?:[^"\\]|\\.)*"$|^`(?:[^`\\$]|\\.|\$(?!\{))*`$/;

/**
 * Split `expr` on a separator appearing at bracket depth 0 and outside any
 * string literal. Returns null when the expression is unbalanced or a quote
 * never closes — the caller must then decline to judge rather than work from
 * a bad parse.
 */
function splitTopLevel(expr, sep) {
  // One walk (src/core/source-strip.js): depth and separators on the masked
  // expression, pieces from the raw one. Unbalanced brackets, or a string
  // that never closes, mean the caller must decline to judge.
  const code = stripStringsAndComments(expr);
  let depth = 0;
  for (const ch of code) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
  }
  if (depth !== 0 || /['"`]\s*$/.test(code.replace(/['"`]\s*['"`]/g, '')) && (code.match(/['"`]/g) || []).length % 2 === 1) return null;
  return splitTopLevelMasked(expr, sep).map((p) => p.trim()).filter(Boolean);
}

/**
 * Take just the assignment's own expression from the text after the `=`.
 *
 * Stops at the first top-level `;` — and also at a closing bracket that has no
 * opener in this text, which is what a single-line if-block leaves behind:
 *
 *     if (!d.items.length) { el.innerHTML = '<li>none</li>'; return; }
 *                                          ^^^^^^^^^^^^^^^^ this much
 *
 * Splitting with the general splitTopLevel helper does not work here, because
 * that trailing `}` makes the fragment unbalanced and the helper correctly
 * refuses to parse it — so the caller fell back to the whole line, and a
 * provably static assignment was reported. Four findings on
 * ccantynz/Gluecron.com @e168803 were exactly this shape.
 *
 * Returns null when a string literal never closes, so the caller can decline
 * rather than judge a fragment.
 */
function takeExpression(text) {
  // Brackets and `;` are judged on the masked twin (string, template and
  // regex bodies blanked, offsets kept); the expression is sliced from the
  // raw text at the same offsets. A literal that never closes leaves its
  // last character blanked, and literalKindAt reports it as a string.
  const masked = stripStringsAndComments(text);
  let depth = 0;
  let end = text.length;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { end = i; break; } // belongs to an enclosing block, not to us
      depth--;
      continue;
    }
    if (ch === ';' && depth === 0) { end = i; break; }
  }
  if (end > 0 && literalKindAt([text], [masked], 0, end - 1) === 'string') return null;
  return text.slice(0, end).trim();
}

/**
 * True when an `.innerHTML = …` assignment provably cannot inject markup.
 *
 * Two safe shapes, and only two:
 *   1. The right-hand side is a single static literal — `''` (clearing a
 *      node) or `"<hr>"`. No user input can reach it.
 *   2. Every DYNAMIC segment is wrapped in a recognised escaper. Segments are
 *      the `${…}` holes of a template literal, or the non-literal operands of
 *      a `+` chain. One unescaped segment and the assignment still fires —
 *      `escapeHtml(a) + b` is not safe.
 */
function innerHtmlAssignmentIsSafe(line) {
  const sink = line.indexOf('.innerHTML');
  if (sink === -1) return false;
  const eq = line.indexOf('=', sink);
  if (eq === -1) return false;

  // Take the assignment's own expression, not the rest of the line. A
  // single-line if-block puts further statements after the semicolon:
  //
  //     if (!d.items.length) { el.innerHTML = '<li>none</li>'; return; }
  //
  // Running to end-of-line captured `'<li>none</li>'; return; }`, which is not
  // a static literal, so a demonstrably safe constant assignment was reported.
  // Found 2026-09-01 auditing our own side of the cross-engine diff against
  // ccantynz/Gluecron.com @e168803 (gluecron.com) — src/routes/demo.tsx:181,
  // 182, 187, 188 are all this shape.
  //
  // Split at the first TOP-LEVEL semicolon so a `;` inside a string or a call
  // argument does not truncate the expression early.
  const afterEq = line.slice(eq + 1);
  const rhs = takeExpression(afterEq);
  if (rhs === null) return false; // unterminated string — decline to judge
  // Assignment continues on another line — we only see part of it.
  if (!rhs) return false;

  if (STATIC_LITERAL.test(rhs)) return true;

  // Balance gate. `escapeHtml(name` — truncated or continued — otherwise
  // reached the bare-expression check below, matched the escaper regex, and
  // was cleared as safe. Silencing a finding on an expression we could not
  // parse is the invisible failure this predicate must never introduce.
  if (splitTopLevel(rhs, ' ') === null) return false;

  // Template literal — inspect each ${…} hole.
  if (/^`[\s\S]*`$/.test(rhs)) {
    const holes = rhs.match(/\$\{[^{}]*\}/g);
    if (!holes) return true; // no interpolation at all
    // A nested brace defeats this extraction; don't guess.
    if (/\$\{[^{}]*\{/.test(rhs)) return false;
    return holes.every((h) => ESCAPER.test(h));
  }

  // `+` chain — every operand that is not a static literal must be escaped.
  // A plain split('+') is wrong twice over: it cuts a `+` inside a string
  // ("a + b") and one inside a call argument (escapeHtml(a + b)).
  if (rhs.includes('+')) {
    const operands = splitTopLevel(rhs, '+');
    if (!operands) return false;
    // Two or more operands means it really is a concatenation. A single
    // operand means every `+` was nested, so the bare check below judges it.
    if (operands.length >= 2) {
      return operands.every((op) => STATIC_LITERAL.test(op) || ESCAPER.test(op));
    }
  }

  // A single bare expression: safe only if it is itself an escaper call.
  return ESCAPER.test(rhs);
}

module.exports = { innerHtmlAssignmentIsSafe, splitTopLevel };
