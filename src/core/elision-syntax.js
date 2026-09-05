'use strict';
/**
 * The syntax questions the elision scanner (src/core/import-elision.js) asks
 * of a token stream, kept apart from the scanner's state machine so each has
 * one small answer: which identifiers start a statement or a declaration,
 * which tokens can precede an expression or continue a type, whether a `<` is
 * a generic argument list or a comparison, what a `(` is the parameter list
 * of, and what a `{` opens. Pure functions over the tokens and the scanner's
 * current frame — nothing here mutates the scanner.
 */

const STATEMENT_START = new Set(['export', 'import', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'declare', 'abstract', 'async', 'return', 'if', 'for', 'while', 'do', 'switch', 'try', 'throw', 'namespace', 'module', 'break', 'continue', 'default', 'case']);
const LABEL_TARGETS = new Set(['for', 'while', 'do', 'switch', 'if', 'try']);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const MODIFIERS = new Set(['static', 'public', 'private', 'protected', 'readonly', 'async', 'get', 'set', 'override', 'abstract', 'declare', 'accessor']);
const DECL_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'namespace', 'module']);
// Tokens after which `{` opens an object literal and `<` cannot be a binary operator.
const EXPR_START = new Set(['=', '(', ',', '[', 'return', '=>', '?', '||', '&&', '??', '!', '...', 'throw', 'yield', 'await', 'in', 'of', 'typeof', 'void', 'delete', 'case', ':', '{', '}', ';', '|', '&', '+', '-', '*', '/', '%', '<', '>', '==', '===', '!=', '!==', '<=', '>=', 'new', 'default', 'async']);
// Tokens after which a `{` continues a type rather than opening a body.
const TYPE_CONTINUES = new Set([':', '=>', '|', '&', '=', '<', ',', '(', '[', '?', 'keyof', 'readonly', 'extends', 'implements', 'typeof', 'infer', 'in']);
// Identifiers that continue a type after a line break (`Foo\n  extends Bar`).
const TYPE_CONTINUES_ID = new Set(['extends', 'is', 'in', 'keyof', 'infer', 'readonly', 'implements', 'asserts']);
const TYPE_ONLY_TOKENS = new Set(['.', ',', '|', '&', '[', ']', '(', ')', '=>', ':', '?', '{', '}', ';', '<', '>', '-', '...', '=', '*']);

const EOF_TOKEN = { t: 'eof', v: '', nl: true };

/**
 * Is `<` at index i a generic argument list (vs a comparison)? In value
 * context a generic list only ever precedes a call, a `new`, a tagged
 * template or a class body, and it never closes a bracket it did not open —
 * `if (a < b) {` reaches the `)` first and is a comparison.
 */
function looksGeneric(tokens, i) {
  let depth = 0;
  let pdepth = 0;
  for (let k = i; k < tokens.length && k < i + 400; k += 1) {
    const tk = tokens[k];
    const v = tk.v;
    if (v === '<') depth += 1;
    else if (v[0] === '>') {
      depth -= v.replace(/=/g, '').length;
      if (depth <= 0) { const n = (tokens[k + 1] || EOF_TOKEN).v; return depth === 0 && (n === '(' || n === '{' || n === 'implements' || n === '`'); }
    } else if (v === '(' || v === '[') pdepth += 1;
    else if (v === ')' || v === ']') { if (pdepth === 0) return false; pdepth -= 1; }
    else if (v === ';' || v === '=' || v === '}') return false;
    else if (tk.t === 'p' && !TYPE_ONLY_TOKENS.has(v)) return false;
    else if (tk.t === 'id' && (STATEMENT_START.has(v) || v === 'await' || v === 'yield' || v === 'new')) return false;
  }
  return false;
}

/**
 * What is the `(` at index i the parameter list of? 'function' / 'method'
 * (defaults evaluate at call time), 'control' (`if (`), or null (a call, a
 * grouping). `function f<T>(` / `m<T>(`: the head is the token before the
 * generic list, which the scanner remembers as `lastGenericHead`.
 */
function parenParamsOf(tokens, i, frame, lastGenericHead) {
  const at = (k) => tokens[k] || EOF_TOKEN;
  const h = at(i - 1).v === '>' && lastGenericHead >= 0 ? lastGenericHead : i - 1;
  const head = at(h);
  const beforeHead = at(h - 1);
  if (head.v === 'function' || head.v === 'constructor' || (head.t === 'id' && beforeHead.v === 'function')) return 'function';
  if (CONTROL.has(head.v)) return 'control';
  if (frame.kind === 'class' && head.t === 'id' && !frame.initExpr) return 'method';
  if (frame.kind === 'obj' && head.t === 'id' && (beforeHead.v === ',' || beforeHead.v === '{' || MODIFIERS.has(beforeHead.v))) return 'method';
  return null;
}

const isFnParams = (frame) => !!frame && (frame.paramsOf === 'function' || frame.paramsOf === 'method');

/**
 * What does the `{` at index i open? 'hole' (template / JSX expression),
 * 'typelit', 'fnbody', 'class', 'enum', 'export' (`export { a }`), 'obj', or
 * 'block'. `bodyOf` is the parameter-list frame when this brace ends a return
 * type annotation; `inType` is whether the scanner is still in type mode once
 * that annotation has been closed.
 */
function braceKind(tokens, i, frame, { tsx, inType, bodyOf, lastDecl, lastClosedParen }) {
  const at = (k) => tokens[k] || EOF_TOKEN;
  const tok = at(i);
  const prev = at(i - 1);
  if (tok.hole || (tsx && (frame.jsxTag || prev.v === '>' || (prev.v === '}' && frame.kind !== 'block')))) return 'hole';
  if (prev.v === 'type' && at(i - 2).v === 'export') return 'typelit'; // `export type { A }`
  if (inType) return 'typelit';
  if (bodyOf) return isFnParams(bodyOf) ? 'fnbody' : 'block';
  if (lastDecl === 'class') return 'class';
  if (lastDecl === 'interface') return 'typelit';
  if (lastDecl === 'enum') return 'enum';
  if (prev.v === 'export' || prev.v === 'type') return 'export';
  if (prev.v === ')') return isFnParams(lastClosedParen) ? 'fnbody' : 'block';
  if (prev.v === '=>') return 'fnbody';
  if (EXPR_START.has(prev.v) || prev.t === 'str' || frame.kind === 'obj') return 'obj';
  return 'block';
}

module.exports = {
  STATEMENT_START, LABEL_TARGETS, MODIFIERS, DECL_KEYWORDS, EXPR_START, TYPE_CONTINUES, TYPE_CONTINUES_ID,
  looksGeneric, parenParamsOf, braceKind,
};
