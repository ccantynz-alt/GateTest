'use strict';
/**
 * Token stream + import/export-statement reader for JS/TS source.
 *
 * Works on the OFFSET-PRESERVING output of source-strip.js, so a string token
 * is a run of blanks between two quotes and a comment is already gone; the
 * import specifier is sliced from the raw text at the token's offsets.
 *
 * Deliberately not a parser. It knows enough shape to (1) read an import /
 * export-from statement whole — multi-line, default + named + namespace,
 * inline `type` modifiers — and (2) hand every other token to the elision
 * scanner with its line number and its neighbours. Anything it cannot read it
 * leaves alone; the scanner's failure mode is then "an edge is kept", never
 * "an edge is invented".
 */

const { stripStringsAndComments } = require('./source-strip');

// Longest punctuators first. `<<` is one token (it never opens a type —
// prisma's `1 << bit` opened an unclosed generic when it was two `<`);
// `>>` / `>>>` / `>=` are one token here and split into closers by the
// scanner only when it is inside a type, where `Array<Array<T>>` ends in `>>`.
// `${` must precede the identifier alternative: `$` starts an identifier, and a
// hole read as `$` + `{` looks like an object literal (apollo's
// `${computeCoreSchemaHash(…)}` was skipped as an object method name).
const TOKEN_RE = /\$\{|[A-Za-z_$À-￿][\w$À-￿]*|#[A-Za-z_$][\w$]*|\d[\w.]*|'[^'\n]*'|"[^"\n]*"|=>|\.\.\.|\?\.|\?\?|===|!==|==|!=|<<=?|>>>?=?|>=|<=|&&|\|\||\+\+|--|\*\*|[-+*/%&|^<>=!~?:;,.()[\]{}@`\\]/g;
const IDENT_START_RE = /[A-Za-z_$#À-￿]/;

/**
 * @param {string} raw original source
 * @returns {{ tokens: Array<{t: string, v: string, s: number, e: number, line: number, nl: boolean}>, stripped: string }}
 *   t: 'id' | 'num' | 'str' | 'p' (punctuator) | 're' (regex literal)
 *   nl: a line break precedes this token (ASI signal)
 */
function tokenize(raw) {
  const stripped = stripStringsAndComments(raw);
  const tokens = [];
  let line = 1;
  let lastEnd = 0;
  TOKEN_RE.lastIndex = 0;
  let m = TOKEN_RE.exec(stripped);
  while (m !== null) {
    const v = m[0];
    const s = m.index;
    const gap = stripped.slice(lastEnd, s);
    let nl = false;
    for (let i = 0; i < gap.length; i += 1) if (gap[i] === '\n') { line += 1; nl = true; }
    lastEnd = s + v.length;

    let t = 'p';
    // Template text is blanked by the stripper, so between two backticks the
    // only tokens are `${` … `}` expression holes; the backtick itself is a
    // string token and `${` is a `{` the bracket stack balances like any other.
    if (v === '${') { tokens.push({ t: 'p', v: '{', s, e: lastEnd, line, nl, hole: true }); m = TOKEN_RE.exec(stripped); continue; }
    if (v === '/') {
      // A blanked regex body: `/` + ≥1 space + `/` + flags. Division never has
      // only whitespace between two slashes.
      const rest = stripped.slice(lastEnd);
      const re = /^ +\/[gimsuyd]*/.exec(rest);
      if (re) {
        lastEnd += re[0].length;
        TOKEN_RE.lastIndex = lastEnd;
        tokens.push({ t: 're', v: '/', s, e: lastEnd, line, nl });
        m = TOKEN_RE.exec(stripped);
        continue;
      }
    }
    if (IDENT_START_RE.test(v[0])) t = 'id';
    else if (/^\d/.test(v)) t = 'num';
    else if (v[0] === "'" || v[0] === '"' || v === '`') t = 'str';
    tokens.push({ t, v, s, e: lastEnd, line, nl });
    m = TOKEN_RE.exec(stripped);
  }
  return { tokens, stripped };
}

/**
 * Read the import / export-from statement starting at tokens[i].
 * Returns null when tokens[i] does not begin one we understand.
 *
 * @returns {null | {
 *   end: number,               index of the last token consumed
 *   form: 'import'|'export-from'|'side-effect',
 *   spec: string,              specifier as written (from raw text)
 *   typeOnly: boolean,         `import type` / `export type … from`
 *   star: boolean,             `import * as ns` / `export * from`
 *   bindings: Array<{ local: string, typeOnly: boolean }>,
 *   line: number, endLine: number,
 * }}
 */
function readImportStatement(tokens, i, raw) {
  const head = tokens[i];
  if (!head || head.t !== 'id' || (head.v !== 'import' && head.v !== 'export')) return null;
  let j = i + 1;
  const at = (k) => tokens[k] || { t: 'eof', v: '' };
  // `import(` dynamic, `import.meta`, `import x = require()` are not ours.
  if (head.v === 'import' && (at(j).v === '(' || at(j).v === '.')) return null;

  let typeOnly = false;
  if (at(j).v === 'type' && at(j).t === 'id') {
    const n = at(j + 1);
    // `import type X from` / `import type {` / `import type * as` — but
    // `import type from './x'` is a default import NAMED type.
    if (n.v === '{' || n.v === '*' || (n.t === 'id' && n.v !== 'from')) { typeOnly = true; j += 1; }
  }

  const bindings = [];
  let star = false;
  const readNamed = () => {
    // at `{`
    j += 1;
    while (at(j).v !== '}' && at(j).t !== 'eof') {
      let bTypeOnly = typeOnly;
      if (at(j).v === 'type' && at(j).t === 'id' && at(j + 1).t === 'id' && at(j + 1).v !== 'as' ) { bTypeOnly = true; j += 1; }
      else if (at(j).v === 'type' && at(j).t === 'id' && at(j + 1).v === 'as' && at(j + 2).t === 'id' && at(j + 3).v === 'as') { bTypeOnly = true; j += 1; }
      if (at(j).t !== 'id' && at(j).t !== 'str') { j += 1; continue; }
      let local = at(j).v;
      j += 1;
      if (at(j).v === 'as' && at(j + 1).t === 'id') { local = at(j + 1).v; j += 2; }
      bindings.push({ local, typeOnly: bTypeOnly });
      if (at(j).v === ',') j += 1;
    }
    j += 1; // past `}`
  };

  if (head.v === 'import') {
    if (at(j).t === 'str') {
      const tok = at(j);
      return { end: j, form: 'side-effect', spec: raw.slice(tok.s + 1, tok.e - 1), typeOnly: false, star: false, bindings: [], line: head.line, endLine: tok.line };
    }
    if (at(j).t === 'id' && at(j).v !== 'from') {
      if (at(j + 1).v === '=') return null; // import x = require('…')
      bindings.push({ local: at(j).v, typeOnly });
      j += 1;
      if (at(j).v === ',') j += 1;
    }
    if (at(j).v === '*') {
      star = true;
      if (at(j + 1).v === 'as' && at(j + 2).t === 'id') { bindings.push({ local: at(j + 2).v, typeOnly }); j += 3; } else j += 1;
    } else if (at(j).v === '{') {
      readNamed();
    }
    if (at(j).v !== 'from' || at(j + 1).t !== 'str') return null;
    const tok = at(j + 1);
    return { end: j + 1, form: 'import', spec: raw.slice(tok.s + 1, tok.e - 1), typeOnly, star, bindings, line: head.line, endLine: tok.line };
  }

  // export
  if (at(j).v === '*') {
    star = true;
    j += 1;
    if (at(j).v === 'as' && at(j + 1).t === 'id') j += 2;
  } else if (at(j).v === '{') {
    readNamed();
  } else {
    return null;
  }
  if (at(j).v !== 'from' || at(j + 1).t !== 'str') return null;
  const tok = at(j + 1);
  // `export { type A, B } from` is a runtime re-export; `export { type A } from` is not.
  const allType = typeOnly || (!star && bindings.length > 0 && bindings.every((b) => b.typeOnly));
  return { end: j + 1, form: 'export-from', spec: raw.slice(tok.s + 1, tok.e - 1), typeOnly: allType, star, bindings, line: head.line, endLine: tok.line };
}

/**
 * Every import / export-from statement in a file, in order, plus the token
 * stream so the caller can scan the rest for uses.
 */
function readImports(raw) {
  const { tokens, stripped } = tokenize(raw);
  const statements = [];
  const consumed = new Set(); // token indices belonging to a statement
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.t !== 'id' || (tok.v !== 'import' && tok.v !== 'export')) continue;
    const prev = tokens[i - 1];
    // Statement position only: `foo.import`, `{ export: 1 }`.
    if (prev && (prev.v === '.' || (prev.v === ':' && tokens[i + 1] && tokens[i + 1].v !== '{'))) continue;
    const st = readImportStatement(tokens, i, raw);
    if (!st) continue;
    st.start = i;
    statements.push(st);
    for (let k = i; k <= st.end; k += 1) consumed.add(k);
    i = st.end;
  }
  return { tokens, stripped, statements, consumed };
}

module.exports = { tokenize, readImports, readImportStatement };
