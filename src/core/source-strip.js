'use strict';
/**
 * Source stripper — ONE definition of "what is a string / comment / regex
 * literal" in JS/TS source (Doctrine §4).
 *
 * Lived privately in src/modules/syntax.js; extracted so the import-graph
 * elision scanner (src/core/import-elision.js) tokenises the same masked text
 * the syntax module counts brackets on. Two strippers disagreeing about where
 * a template literal ends would be two answers to one question.
 *
 * Output is offset-preserving: every masked character becomes a space (a
 * newline stays a newline), so an index into the stripped text is the same
 * index into the original. Callers that need the ORIGINAL bytes at a masked
 * position (an import specifier, say) slice the raw source at that offset.
 */

// State-machine source stripper. Walks char-by-char and replaces the
// contents of strings / template literals / regex literals / comments
// with a single space, leaving structural punctuation intact for
// downstream paren-counting. Approximate (regex vs. division heuristic
// is the standard one), but far more accurate than a single regex.
function stripStringsAndComments(src) {
  const out = [];
  const STATE = {
    NORMAL: 0,
    LINE_COMMENT: 1,
    BLOCK_COMMENT: 2,
    SQ_STRING: 3,
    DQ_STRING: 4,
    TEMPLATE: 5,
    TEMPLATE_EXPR: 6,
    REGEX: 7,
    REGEX_CLASS: 8,
  };
  let state = STATE.NORMAL;
  // Where a string / regex / template returns to when it closes. A `'` inside
  // a `${ … }` hole must come back to the hole, not to NORMAL — before this
  // stack existed, `\`${a.join(', ')}\`` left the hole open, the closing
  // backtick opened a NEW template, and the rest of the file was blanked
  // (found by bisecting a prisma file whose import the elision scanner had
  // wrongly declared unused).
  const returnTo = [];
  const holeDepths = []; // one brace depth per open template
  let templateExprDepth = 0;
  // Tokens after which `/` is interpreted as a regex literal (otherwise division).
  const REGEX_PRECEDERS = /[=(,;:!&|?{}[\n+\-*<>%^~]/;
  let lastSig = '\n';

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1] || '';
    if (state === STATE.NORMAL || state === STATE.TEMPLATE_EXPR) {
      if (c === '/' && next === '/') {
        state = STATE.LINE_COMMENT;
        out.push(' ', ' ');
        i++;
        continue;
      }
      if (c === '/' && next === '*') {
        state = STATE.BLOCK_COMMENT;
        out.push(' ', ' ');
        i++;
        continue;
      }
      if (c === "'") { returnTo.push(state); state = STATE.SQ_STRING; out.push(c); continue; }
      if (c === '"') { returnTo.push(state); state = STATE.DQ_STRING; out.push(c); continue; }
      if (c === '`') { returnTo.push(state); holeDepths.push(templateExprDepth); state = STATE.TEMPLATE; out.push(c); continue; }
      if (c === '/' && REGEX_PRECEDERS.test(lastSig)) {
        returnTo.push(state);
        state = STATE.REGEX;
        out.push(c);
        continue;
      }
      if (state === STATE.TEMPLATE_EXPR) {
        if (c === '{') templateExprDepth++;
        else if (c === '}') {
          templateExprDepth--;
          if (templateExprDepth === 0) {
            state = STATE.TEMPLATE;
            out.push(c);
            lastSig = c;
            continue;
          }
        }
      }
      out.push(c);
      if (!/\s/.test(c)) lastSig = c;
      continue;
    }
    if (state === STATE.LINE_COMMENT) {
      if (c === '\n') { state = STATE.NORMAL; out.push(c); lastSig = '\n'; }
      else out.push(' ');
      continue;
    }
    if (state === STATE.BLOCK_COMMENT) {
      if (c === '*' && next === '/') {
        state = STATE.NORMAL;
        out.push(' ', ' ');
        i++;
      } else {
        out.push(c === '\n' ? '\n' : ' ');
      }
      continue;
    }
    if (state === STATE.SQ_STRING) {
      if (c === '\\') { out.push(' '); if (next) { out.push(' '); i++; } continue; }
      if (c === "'") { state = returnTo.pop(); out.push(c); lastSig = c; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      continue;
    }
    if (state === STATE.DQ_STRING) {
      if (c === '\\') { out.push(' '); if (next) { out.push(' '); i++; } continue; }
      if (c === '"') { state = returnTo.pop(); out.push(c); lastSig = c; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      continue;
    }
    if (state === STATE.TEMPLATE) {
      if (c === '\\') { out.push(' '); if (next) { out.push(' '); i++; } continue; }
      if (c === '`') { state = returnTo.pop(); templateExprDepth = holeDepths.pop(); out.push(c); lastSig = c; continue; }
      if (c === '$' && next === '{') {
        state = STATE.TEMPLATE_EXPR;
        templateExprDepth = 1;
        out.push(c, next);
        i++;
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
      continue;
    }
    if (state === STATE.REGEX) {
      if (c === '\\') { out.push(' '); if (next) { out.push(' '); i++; } continue; }
      if (c === '[') { state = STATE.REGEX_CLASS; out.push(' '); continue; }
      if (c === '/') {
        state = returnTo.pop();
        out.push(c);
        // Consume any flag chars (gimsuy)
        let j = i + 1;
        while (j < src.length && /[gimsuy]/.test(src[j])) { out.push(src[j]); j++; }
        i = j - 1;
        lastSig = '/';
        continue;
      }
      if (c === '\n') {
        // Unterminated regex — bail back to where we came from to avoid eating the rest of the file.
        state = returnTo.pop();
        out.push(c);
        lastSig = '\n';
        continue;
      }
      out.push(' ');
      continue;
    }
    if (state === STATE.REGEX_CLASS) {
      if (c === '\\') { out.push(' '); if (next) { out.push(' '); i++; } continue; }
      if (c === ']') { state = STATE.REGEX; out.push(' '); continue; }
      out.push(c === '\n' ? '\n' : ' ');
      continue;
    }
  }
  return out.join('');
}

module.exports = { stripStringsAndComments };
