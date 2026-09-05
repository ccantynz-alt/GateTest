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

// Slice-based scanner: runs of code are copied with slice() and a masked run
// is produced with one replace(), instead of one push per character — 2.6x
// faster over the 9,751-file corpus (2,986 ms → 1,157 ms), and this
// stripper runs two or three times per file per scan (syntax, the elision
// tokenizer, aiHallucination). Byte-identical to the character machine it
// replaced on 9,740 of those files; the 11 that differ were the old
// machine's defects, both now pinned in tests/source-strip.test.js:
//   - a line comment inside a `${ … }` hole returned to the plain state, so
//     the closing backtick opened a NEW template and the rest of the file
//     was blanked (trpc's www/src/theme/BlogPostPage/Metadata/index.tsx —
//     every import below that point vanished from the graph);
//   - a backslash-newline inside a template or string masked the newline to
//     a space, moving every line number after it.
// Comments never change state here; the newline after a backslash stays.
const REGEX_PRECEDERS = /[=(,;:!&|?{}[\n+\-*<>%^~]/;
const FLAG_RE = /[gimsuy]/;
const NL_RE = /[^\n]/g;
const mask = (s) => s.replace(NL_RE, ' ');

function stripStringsAndComments(src) {
  const n = src.length;
  const parts = [];
  let copyFrom = 0; // start of the pending run of unmasked text
  const emitCode = (end) => { if (end > copyFrom) parts.push(src.slice(copyFrom, end)); copyFrom = end; };
  const emitMasked = (from, to) => { emitCode(from); parts.push(mask(src.slice(from, to))); copyFrom = to; };
  // States: 0 normal, 6 template-expr (a `${ … }` hole — code).
  let state = 0;
  const returnTo = [];
  const holeDepths = [];
  let templateExprDepth = 0;
  let lastSig = '\n';

  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    // ── code (normal or inside a template hole) ──
    if (c === 47 /* / */) {
      const next = src.charCodeAt(i + 1);
      if (next === 47) { // line comment
        let j = src.indexOf('\n', i + 2); if (j === -1) j = n;
        emitMasked(i, j); i = j; lastSig = '\n';
        continue;
      }
      if (next === 42) { // block comment
        let j = src.indexOf('*/', i + 2); j = j === -1 ? n : j + 2;
        emitMasked(i, j); i = j;
        continue;
      }
      if (REGEX_PRECEDERS.test(lastSig)) { // regex literal
        let j = i + 1; let inClass = false;
        emitCode(i); parts.push('/'); copyFrom = i + 1;
        for (; j < n; j += 1) {
          const d = src.charCodeAt(j);
          if (d === 92 /* \ */) { j += 1; continue; }
          if (inClass) { if (d === 93 /* ] */) inClass = false; continue; }
          if (d === 91 /* [ */) { inClass = true; continue; }
          if (d === 47 /* / */ || d === 10 /* \n */) break;
        }
        if (j >= n) { parts.push(mask(src.slice(i + 1, n))); copyFrom = n; i = n; continue; }
        if (src.charCodeAt(j) === 10) { // unterminated: keep the newline as code
          parts.push(mask(src.slice(i + 1, j))); copyFrom = j; i = j; lastSig = '\n';
          // the newline itself is emitted as code by the normal path
          parts.push('\n'); copyFrom = j + 1; i = j + 1;
          continue;
        }
        parts.push(mask(src.slice(i + 1, j))); parts.push('/'); let k = j + 1;
        while (k < n && FLAG_RE.test(src[k])) k += 1;
        if (k > j + 1) parts.push(src.slice(j + 1, k));
        copyFrom = k; i = k; lastSig = '/';
        continue;
      }
      lastSig = '/'; i += 1; continue;
    }
    if (c === 39 || c === 34) { // ' or "
      const q = c;
      let j = i + 1;
      for (; j < n; j += 1) {
        const d = src.charCodeAt(j);
        if (d === 92) { j += 1; continue; }
        if (d === q) break;
      }
      emitCode(i); parts.push(src[i]); copyFrom = i + 1;
      if (j >= n) { parts.push(mask(src.slice(i + 1, n))); copyFrom = n; i = n; continue; }
      parts.push(mask(src.slice(i + 1, j))); parts.push(src[j]); copyFrom = j + 1; i = j + 1; lastSig = src[j];
      continue;
    }
    if (c === 96) { // ` — template literal
      emitCode(i); parts.push('`'); copyFrom = i + 1;
      let j = i + 1;
      for (; j < n; j += 1) {
        const d = src.charCodeAt(j);
        if (d === 92) { j += 1; continue; }
        if (d === 96) break;
        if (d === 36 && src.charCodeAt(j + 1) === 123) break; // ${
      }
      if (j >= n) { parts.push(mask(src.slice(i + 1, n))); copyFrom = n; i = n; continue; }
      parts.push(mask(src.slice(i + 1, j))); copyFrom = j;
      if (src.charCodeAt(j) === 96) { parts.push('`'); copyFrom = j + 1; i = j + 1; lastSig = '`'; continue; }
      // `${` — enter a hole
      parts.push('${'); copyFrom = j + 2; i = j + 2;
      returnTo.push(state); holeDepths.push(templateExprDepth);
      state = 6; templateExprDepth = 1;
      continue;
    }
    if (state === 6) {
      if (c === 123) templateExprDepth += 1;
      else if (c === 125) {
        templateExprDepth -= 1;
        if (templateExprDepth === 0) {
          // back into the template body
          emitCode(i + 1); lastSig = '}';
          let j = i + 1;
          for (;;) {
            for (; j < n; j += 1) {
              const d = src.charCodeAt(j);
              if (d === 92) { j += 1; continue; }
              if (d === 96) break;
              if (d === 36 && src.charCodeAt(j + 1) === 123) break;
            }
            break;
          }
          if (j >= n) { parts.push(mask(src.slice(i + 1, n))); copyFrom = n; i = n; continue; }
          parts.push(mask(src.slice(i + 1, j))); copyFrom = j;
          if (src.charCodeAt(j) === 96) { parts.push('`'); copyFrom = j + 1; i = j + 1; state = returnTo.pop(); templateExprDepth = holeDepths.pop(); lastSig = '`'; continue; }
          parts.push('${'); copyFrom = j + 2; i = j + 2; templateExprDepth = 1;
          continue;
        }
      }
    }
    if (c > 32) lastSig = src[i];
    i += 1;
  }
  emitCode(n);
  return parts.join('');
}
module.exports = { stripStringsAndComments };
