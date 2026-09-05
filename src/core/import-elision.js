'use strict';
/**
 * Type-only import elision — what TypeScript, esbuild, swc and Babel all do to
 * an `import { A } from './a.js'` whose A is only ever used as a TYPE: the
 * import is dropped from the emitted JavaScript, so it never loads `./a.js`
 * and cannot form a runtime cycle. The import graph was blind to this: it
 * kept the edge (kind 'ts-esm' / 'static') or, for NodeNext `.js` specifiers,
 * kept it OUT of the cycle view entirely so as not to invent cycles through
 * `.interface.ts` files — and so reported silence on every NodeNext project
 * (Doctrine §1). This module answers, per import statement:
 *
 *   'type'      every binding is used only in type positions → elided
 *   'load'      some binding is used as a value at module-evaluation time
 *               (top level, class heritage, decorator, static initializer)
 *   'deferred'  value uses exist but only inside function / method / arrow
 *               bodies or instance-field initializers — the import is emitted
 *               and the edge is real, but nothing reads the binding while the
 *               module graph is still loading (the ESM analogue of a
 *               function-scoped `require`, which the graph already calls 'lazy')
 *
 * It is a token scanner with a bracket stack, not a parser. The scanner's
 * failure direction is documented at each heuristic; where it is unsure it
 * keeps the binding as a VALUE use, so a wrong answer keeps an edge rather
 * than inventing an elision — an invented elision would hide a real cycle.
 *
 * Elision is disabled — exactly as in tsc — under `verbatimModuleSyntax`,
 * `preserveValueImports`, or `importsNotUsedAsValues: preserve | error`.
 * `isolatedModules` alone does NOT disable it (it restricts re-exports of
 * types and `const enum`, not import elision).
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

/**
 * @param {import('./ts-tokens').tokenize extends (...a:any)=>infer R ? R['tokens'] : never} tokens
 * @param {Set<number>} skip token indices to ignore (the import statements)
 * @param {Set<string>} names imported local bindings to classify
 * @param {{ tsx?: boolean }} [opts]
 * @returns {Map<string, { type: number, load: number, deferred: number, loadLines: number[] }>}
 */
function classifyUses(tokens, skip, names, opts = {}) {
  const counts = new Map();
  for (const n of names) counts.set(n, { type: 0, load: 0, deferred: 0, loadLines: [] });
  if (names.size === 0) return counts;

  const root = { open: '', kind: 'block', ternary: 0, arrowExpr: 0, initExpr: false, deferred: false, forceLoad: false, casePending: false };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let typeMode = null; // { depth, afterParen, kind }
  let lastDecl = null; // decl keyword governing the next `{`
  let memberStatic = false;
  let lastClosedParen = null;
  let lastGenericHead = -1; // token index before the most recently closed `<…>`
  let afterAt = false;

  const at = (k) => tokens[k] || { t: 'eof', v: '', nl: true };
  const inType = () => typeMode !== null || top().typeCtx;
  const isDeferred = () => {
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      const f = stack[k];
      if (f.arrowExpr > 0 || f.initExpr || f.deferred) return true;
      if (f.forceLoad) return false;
    }
    return false;
  };
  const endTypeMode = () => { typeMode = null; };
  const record = (name, cls, line) => { const c = counts.get(name); if (!c) return; c[cls] += 1; if (cls === 'load' && c.loadLines.length < 5) c.loadLines.push(line); };
  const endExprAt = (f) => { if (f.arrowExpr > 0) f.arrowExpr = 0; f.initExpr = false; };

  // Is `<` at index i a generic argument list (vs a comparison)? In value
  // context a generic list only ever precedes a call, a `new`, a tagged
  // template or a class body, and it never closes a bracket it did not open —
  // `if (a < b) {` reaches the `)` first and is a comparison.
  const looksGeneric = (i) => {
    let depth = 0;
    let pdepth = 0;
    for (let k = i; k < tokens.length && k < i + 400; k += 1) {
      const tk = tokens[k];
      const v = tk.v;
      if (v === '<') depth += 1;
      else if (v[0] === '>') { depth -= v.replace(/=/g, '').length; if (depth <= 0) { const n = at(k + 1).v; return depth === 0 && (n === '(' || n === '{' || n === 'implements' || n === '`'); } }
      else if (v === '(' || v === '[') pdepth += 1;
      else if (v === ')' || v === ']') { if (pdepth === 0) return false; pdepth -= 1; }
      else if (v === ';' || v === '=' || v === '}') return false;
      else if (tk.t === 'p' && !TYPE_ONLY_TOKENS.has(v)) return false;
      else if (tk.t === 'id' && (STATEMENT_START.has(v) || v === 'await' || v === 'yield' || v === 'new')) return false;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    if (skip.has(i)) continue;
    const tok = tokens[i];
    const v = tok.v;
    const prev = at(i - 1);
    const next = at(i + 1);
    const f = top();

    // ── ASI-ish terminators for open-ended contexts ──────────────────────
    if (tok.nl && tok.t === 'id' && STATEMENT_START.has(v) && !f.typeCtx) {
      if (typeMode && typeMode.depth === stack.length && (typeMode.kind === 'alias' || typeMode.kind === 'as' || typeMode.kind === 'annotation')) endTypeMode();
      endExprAt(f);
      if (f.kind === 'class') memberStatic = false;
    }
    // `let c: Context` + newline + `beforeEach(() => {`: a type that ended at
    // the line break (previous token completes a type, this one cannot
    // continue it) — hono's test files left every `it()` body in type mode.
    if (tok.nl && typeMode && typeMode.depth === stack.length && typeMode.kind !== 'heritage'
      && (tok.t === 'id' || v === '@') && !TYPE_CONTINUES_ID.has(v)
      && (prev.t === 'id' || prev.v === '>' || prev.v === ']' || prev.v === ')' || prev.v === '}' || prev.t === 'str' || prev.t === 'num')) {
      endTypeMode();
    }
    if (tok.nl && f.kind === 'class' && f.initExpr && (tok.t === 'id' && (MODIFIERS.has(v) || [':', '(', '?', '!', '=', '<'].includes(next.v)) || v === '@')) {
      f.initExpr = false; memberStatic = false;
    }

    // ── brackets ─────────────────────────────────────────────────────────
    if (v === '(' || v === '[') {
      const frame = { open: v, kind: v === '(' ? 'paren' : 'bracket', ternary: 0, arrowExpr: 0, initExpr: false, deferred: false, forceLoad: false, casePending: false, typeCtx: inType() };
      if (v === '(') {
        if (afterAt || (prev.t === 'id' && at(i - 2).v === '@') || f.decoratorChain) { frame.forceLoad = true; }
        if (!inType()) {
          // `function f<T>(` / `m<T>(`: the head is the token before the generic list.
          const h = prev.v === '>' && lastGenericHead >= 0 ? lastGenericHead : i - 1;
          const head = at(h);
          const beforeHead = at(h - 1);
          if (head.v === 'function' || head.v === 'constructor' || (head.t === 'id' && beforeHead.v === 'function')) frame.paramsOf = 'function';
          else if (CONTROL.has(head.v)) frame.paramsOf = 'control';
          else if (f.kind === 'class' && head.t === 'id' && !f.initExpr) frame.paramsOf = 'method';
          else if (f.kind === 'obj' && head.t === 'id' && (beforeHead.v === ',' || beforeHead.v === '{' || MODIFIERS.has(beforeHead.v))) frame.paramsOf = 'method';
          else frame.paramsOf = null;
          if (frame.paramsOf === 'function' || frame.paramsOf === 'method') frame.deferred = true; // defaults evaluate at call time
        }
      }
      stack.push(frame);
      afterAt = false;
      continue;
    }
    if (v === '{') {
      let kind = 'block';
      let deferred = false;
      // A `{` after a complete type ends a heritage clause (`implements A {`)
      // or a return-type annotation (`(): { a: A } {`): what follows is a body.
      let bodyOf = null;
      if (typeMode && typeMode.depth === stack.length && (typeMode.afterParen || typeMode.kind === 'heritage') && !TYPE_CONTINUES.has(prev.v)) { bodyOf = typeMode.afterParen; endTypeMode(); }
      const inHead = inType(); // a `{}` inside a declaration head (`interface X<T = {}> {`) is not the body
      if (tok.hole || (opts.tsx && (f.jsxTag || prev.v === '>' || (prev.v === '}' && f.kind !== 'block')))) kind = 'hole';
      else if (prev.v === 'type' && at(i - 2).v === 'export') kind = 'typelit'; // `export type { A }`
      else if (inType()) kind = 'typelit';
      else if (bodyOf) kind = bodyOf.paramsOf === 'function' || bodyOf.paramsOf === 'method' ? 'fnbody' : 'block';
      else if (lastDecl === 'class') kind = 'class';
      else if (lastDecl === 'interface') kind = 'typelit';
      else if (lastDecl === 'enum') kind = 'enum';
      else if (prev.v === 'export' || prev.v === 'type') kind = 'export';
      else if (prev.v === ')') { kind = lastClosedParen && (lastClosedParen.paramsOf === 'function' || lastClosedParen.paramsOf === 'method') ? 'fnbody' : 'block'; }
      else if (prev.v === '=>') kind = 'fnbody';
      else if (EXPR_START.has(prev.v) || prev.t === 'str' || f.kind === 'obj') kind = 'obj';
      if (kind === 'fnbody') deferred = true;
      // `{` in type mode after a type ends heritage / return-type annotations.
      const frame = { open: '{', kind, ternary: 0, arrowExpr: 0, initExpr: false, deferred, forceLoad: false, casePending: false, typeCtx: kind === 'typelit' || (kind === 'block' && f.typeCtx) };
      if (kind === 'class') frame.memberPos = true;
      stack.push(frame);
      // The body `{` consumes the declaration; a type literal inside its head
      // (`interface X<T = {}> {`) must not — the body still has to know it is
      // an interface. Resetting on every typelit left `lastDecl` set through
      // the body, so the next `function … {` in the file opened as a type.
      if (!inHead) lastDecl = null;
      memberStatic = false;
      continue;
    }
    if (v === '<') {
      if (inType()) { stack.push({ open: '<', kind: 'generic', headIdx: i - 1, ternary: 0, arrowExpr: 0, initExpr: false, deferred: false, forceLoad: false, typeCtx: true }); continue; }
      // `return <span …>` / `return <Foo>x`: a keyword is not an operand.
      const operandBefore = (prev.t === 'id' && !EXPR_START.has(prev.v)) || prev.t === 'num' || prev.t === 'str' || prev.v === ')' || prev.v === ']';
      // `class B<T = A>`, `function f<T>(`, `foo<T>(` in a class body: a
      // declaration's type-parameter list, generic by construction.
      const declHead = prev.t === 'id' && (lastDecl !== null || at(i - 2).v === 'function' || (f.kind === 'class' && !f.initExpr));
      if (operandBefore && (declHead || ((prev.t !== 'id' || !EXPR_START.has(prev.v)) && looksGeneric(i)))) {
        stack.push({ open: '<', kind: 'generic', headIdx: i - 1, ternary: 0, arrowExpr: 0, initExpr: false, deferred: false, forceLoad: false, typeCtx: true });
        continue;
      }
      if (!operandBefore && !opts.tsx && next.t === 'id') {
        // `<Foo>expr` type assertion (.ts only — in .tsx this is JSX, a value).
        stack.push({ open: '<', kind: 'generic', headIdx: -1, ternary: 0, arrowExpr: 0, initExpr: false, deferred: false, forceLoad: false, typeCtx: true });
        continue;
      }
      // JSX opening tag: until its `>`, a `{` is an attribute expression.
      if (opts.tsx && !operandBefore && (next.t === 'id' || next.v === '>')) f.jsxTag = true;
      continue; // comparison or JSX: value context continues
    }
    if (v === ')' || v === ']' || v === '}' || v[0] === '>') {
      if (v[0] === '>' && f.open !== '<') { f.jsxTag = false; continue; } // comparison / shift, or a JSX tag closing
      if (v[0] === '>' && f.open === '<') {
        // `Array<Array<T>>` — inside a type every `>` of `>>` / `>>>` closes a generic.
        let closers = v.replace(/=/g, '').length;
        while (closers > 0 && top().open === '<') { lastGenericHead = top().headIdx; stack.pop(); closers -= 1; }
        if (typeMode && typeMode.depth > stack.length) endTypeMode();
        continue;
      }
      if (stack.length > 1) {
        const closed = stack.pop();
        if (v === ')') lastClosedParen = closed;
        if (typeMode && typeMode.depth > stack.length) endTypeMode();
        if (closed.kind === 'class') memberStatic = false;
        if (v === ')' && closed.forceLoad) top().decoratorChain = false;
      }
      continue;
    }

    // ── decorators ──────────────────────────────────────────────────────
    if (v === '@') { afterAt = true; f.decoratorChain = true; continue; }

    // ── type-mode entries / exits (value context only) ──────────────────
    if (!inType()) {
      if (v === ':') {
        if (f.ternary > 0) { f.ternary -= 1; continue; }
        if (f.casePending || prev.v === 'default') { f.casePending = false; continue; }
        // `ROUTES_LOOP: for (…)` — a labeled statement, not an annotation (hono).
        if (prev.t === 'id' && prev.nl && (f.kind === 'block' || f.kind === 'fnbody') && (LABEL_TARGETS.has(next.v) || next.v === '{')) continue;
        if (f.kind === 'obj' || f.kind === 'enum' || f.kind === 'hole' || f.kind === 'export') continue;
        if (f.kind === 'bracket') continue;
        // `{ a: 1 }` inside a paren/block when the `{` was read as obj is
        // already an obj frame. Anything else is an annotation.
        typeMode = { depth: stack.length, afterParen: prev.v === ')' ? lastClosedParen : null, kind: 'annotation' };
        continue;
      }
      if (v === '?') {
        const opt = next.v === ':' || next.v === ')' || next.v === ',' || next.v === '=' || next.v === '}' || next.v === ';' || next.v === '(' || next.v === '<';
        if (!opt) f.ternary += 1;
        continue;
      }
      if (v === 'case') { f.casePending = true; continue; }
      // `x as T` — but a member or property NAMED as/satisfies (`as<A>(alias)`,
      // `as: string`) is an identifier: prisma's query builder has an `as()` method.
      const asOperator = (v === 'as' || v === 'satisfies') && tok.t === 'id' && f.kind !== 'export'
        && ((prev.t === 'id' && !EXPR_START.has(prev.v)) || prev.t === 'num' || prev.t === 'str' || prev.v === ')' || prev.v === ']' || prev.v === '}')
        && next.v !== '<' && next.v !== ':' && next.v !== '=' && next.v !== '?' && next.v !== ',' && next.v !== ';' && next.v !== ')' && next.v !== '}'
        && !(next.v === '(' && (f.kind === 'class' || f.kind === 'obj' || f.kind === 'typelit'));
      if (asOperator) {
        typeMode = { depth: stack.length, afterParen: null, kind: 'as' };
        continue;
      }
      if (v === 'implements') { typeMode = { depth: stack.length, afterParen: null, kind: 'heritage' }; continue; }
      if (v === 'extends' && lastDecl === 'interface') { typeMode = { depth: stack.length, afterParen: null, kind: 'heritage' }; continue; }
      if (tok.t === 'id' && DECL_KEYWORDS.has(v) && prev.v !== '.' && (v !== 'type' || (next.t === 'id' && (at(i + 2).v === '=' || at(i + 2).v === '<')))) {
        if (v === 'type' || v === 'interface' || v === 'class' || v === 'enum') lastDecl = v;
        continue;
      }
      if (v === '=' && lastDecl === 'type') { typeMode = { depth: stack.length, afterParen: null, kind: 'alias' }; lastDecl = null; continue; }
      if (v === '=>' && next.v !== '{') { f.arrowExpr += 1; continue; }
      if (v === '=' && f.kind === 'class' && !memberStatic) { f.initExpr = true; continue; }
      if (v === 'static' && f.kind === 'class') { memberStatic = true; continue; }
      if (v === ',' || v === ';') { endExprAt(f); if (v === ';') { memberStatic = false; lastDecl = null; f.casePending = false; } continue; }
    } else {
      // In type mode: terminators at the mode's own depth.
      if (typeMode && typeMode.depth === stack.length) {
        // `(x): Foo => body` ends the return type at `=>`; `(): () => void {`
        // does not — a `)` right before `=>` is a function TYPE's parameter
        // list (nest's client-rmq.ts `publish(): () => void {`).
        const arrowEnds = v === '=>' && typeMode.afterParen && prev.v !== ')';
        const commaEnds = v === ',' && typeMode.kind !== 'heritage'; // `extends A, B {`
        if (v === '=' || commaEnds || v === ';' || arrowEnds) { endTypeMode(); if (v === '=>') f.arrowExpr += 1; if (v === ';') memberStatic = false; continue; }
        // `cond ? x as T\n : y` — a ternary's `:` reaches us inside the `as`
        // type; a conditional type's `:` pairs with a `?` seen in type mode.
        if (v === '?' && next.v !== ':' && next.v !== ')' && next.v !== ',' && next.v !== ';' && next.v !== '}') { typeMode.ternary = (typeMode.ternary || 0) + 1; continue; }
        if (v === ':') {
          if (typeMode.ternary > 0) { typeMode.ternary -= 1; continue; }
          if (f.ternary > 0) { endTypeMode(); f.ternary -= 1; continue; }
        }
      }
    }

    if (tok.t === 'id' && !inType()) {
      // declarations shadow, keys are not uses
      if (DECL_KEYWORDS.has(prev.v) || prev.v === '.' || prev.v === '?.' || prev.v === '#') { afterAt = false; continue; }
      if (prev.v === 'as' && f.kind === 'export') continue;
      if (next.v === ':' && !(prev.v === 'case' || (prev.v === '?' && f.ternary > 0)) && f.kind !== 'block' && f.kind !== 'paren') continue; // key / member name
      if (next.v === ':' && (f.kind === 'block' || f.kind === 'paren') && (prev.v === '(' || prev.v === ',' || prev.v === 'const' || prev.v === 'let' || prev.v === 'var' || MODIFIERS.has(prev.v) || prev.v === '@' || prev.v === ')')) continue; // param / decl name
      if ((next.v === '?' || next.v === '!') && at(i + 2).v === ':') continue;
      if (f.kind === 'class' && (prev.v === '{' || prev.v === ';' || prev.v === '}' || MODIFIERS.has(prev.v) || prev.v === '*' || (prev.v === ')' && lastClosedParen && lastClosedParen.forceLoad) || (prev.t === 'id' && at(i - 2).v === '@'))) {
        // member name position
        if (next.v === '(' || next.v === ':' || next.v === '=' || next.v === '?' || next.v === '!' || next.v === ';' || next.v === '<' || next.nl) { afterAt = false; continue; }
      }
      if (f.kind === 'enum' && (prev.v === '{' || prev.v === ',') && (next.v === '=' || next.v === ',' || next.v === '}')) continue; // member name; `A = X.B` reads X at load
      if (f.kind === 'obj' && (next.v === '(' ) && (prev.v === ',' || prev.v === '{' || MODIFIERS.has(prev.v))) continue; // method name
      if (!names.has(v)) { afterAt = false; continue; }
      if (afterAt) { record(v, 'load', tok.line); afterAt = false; continue; }
      record(v, isDeferred() ? 'deferred' : 'load', tok.line);
      continue;
    }
    if (tok.t === 'id' && inType()) {
      if (prev.v === '.' || next.v === ':') continue;
      if (names.has(v)) record(v, 'type', tok.line);
      continue;
    }
    afterAt = false;
  }
  return counts;
}

/**
 * Decide, for each import / export-from statement, whether it is elided.
 * @param {Array} statements from ts-tokens.readImports
 * @param {Map<string, {type:number, load:number, deferred:number}>} uses
 * @param {{ elide: boolean }} mode from tsconfig
 * @returns {Array<'type'|'load'|'deferred'>} parallel to `statements`
 */
function statementUses(statements, uses, mode) {
  return statements.map((st) => {
    if (st.typeOnly) return 'type';
    if (st.form === 'side-effect' || st.form === 'export-from') return 'load';
    if (!mode.elide) return 'load';
    const valueBindings = st.bindings.filter((b) => !b.typeOnly);
    if (valueBindings.length === 0) return st.bindings.length ? 'type' : 'load';
    let anyLoad = false;
    let anyDeferred = false;
    for (const b of valueBindings) {
      const u = uses.get(b.local) || { load: 0, deferred: 0, type: 0, loadLines: [] };
      if (u.load > 0) { anyLoad = true; if (st.loadLine === undefined) st.loadLine = u.loadLines[0]; }
      else if (u.deferred > 0) anyDeferred = true;
    }
    if (anyLoad) return 'load';
    if (anyDeferred) return 'deferred';
    return 'type';
  });
}

module.exports = { classifyUses, statementUses };
