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
const ESCAPER = /\b(?:escapeHtml|escapeHTML|htmlEscape|escapeHtmlAttr|sanitizeHtml|sanitizeHTML|sanitize|escapeExpression|encodeURIComponent)\s*\(|\bDOMPurify\s*\.\s*sanitize\s*\(|\bpurify\s*\.\s*sanitize\s*\(/;

const STATIC_LITERAL = /^'(?:[^'\\]|\\.)*'$|^"(?:[^"\\]|\\.)*"$|^`(?:[^`\\$]|\\.|\$(?!\{))*`$/;

/**
 * Split `expr` on a separator appearing at bracket depth 0 and outside any
 * string literal. Returns null when the expression is unbalanced or a quote
 * never closes — the caller must then decline to judge rather than work from
 * a bad parse.
 */
function splitTopLevel(expr, sep) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];

    if (quote) {
      buf += ch;
      if (ch === '\\') { buf += expr[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; buf += ch; continue; }
    if (ch === sep && depth === 0) { parts.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }

  if (quote || depth !== 0) return null;
  parts.push(buf.trim());
  return parts.filter(Boolean);
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

  const rhs = line.slice(eq + 1).replace(/;\s*$/, '').trim();
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
