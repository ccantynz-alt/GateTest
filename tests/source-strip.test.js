'use strict';
/**
 * src/core/source-strip.js — the one definition of where a string, comment
 * or regex literal begins and ends (Doctrine §4). syntax.js counts brackets
 * on its output, the elision tokenizer reads import specifiers from it, and
 * aiHallucination harvests imports through it: 63 files depend on it
 * transitively, so every guarantee it makes is pinned here.
 *
 * Contract: the output is OFFSET-PRESERVING — same length, every newline in
 * the same place, every masked character a space — so an index into the
 * stripped text is the same index into the source.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { stripStringsAndComments } = require('../src/core/source-strip');

function strip(src) {
  const out = stripStringsAndComments(src);
  assert.strictEqual(out.length, src.length, 'offset-preserving: same length');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') assert.strictEqual(out[i], '\n', `newline preserved at ${i}`);
  }
  return out;
}

describe('source-strip — comments', () => {
  it('a line comment is blanked to the end of the line, the newline stays', () => {
    assert.strictEqual(strip('a = 1; // require("x")\nb = 2;'), 'a = 1;                \nb = 2;');
  });
  it('a block comment is blanked across lines', () => {
    const out = strip('/* one\n two */ c = 3;');
    assert.strictEqual(out, '      \n        c = 3;');
  });
  it('NEGATIVE CONTROL — `//` inside a string is not a comment', () => {
    assert.strictEqual(strip("u = 'http://x'; v = 1;"), "u = '        '; v = 1;");
  });
  it('NEGATIVE CONTROL — `/*` inside a regex literal is not a comment', () => {
    const out = strip('r = /\\/\\*/g; s = 1;');
    assert.ok(out.endsWith(' s = 1;'), out);
  });
});

describe('source-strip — strings and templates', () => {
  it('string contents are blanked, the quotes stay, escapes do not end the string', () => {
    assert.strictEqual(strip('a = "x\\"y"; b = 1;'), 'a = "    "; b = 1;');
    assert.strictEqual(strip("a = 'it\\'s'; b = 1;"), "a = '     '; b = 1;");
  });
  it('a template literal is blanked but its `${}` holes are kept as code', () => {
    const out = strip('t = `a ${f("q")} b`; c = 1;');
    assert.strictEqual(out, 't = `  ${f(" ")}  `; c = 1;');
  });
  it('a nested template inside a hole ends the inner template, not the outer', () => {
    const out = strip('t = `x ${`y ${z} w`} v`; u = 1;');
    assert.ok(out.endsWith('; u = 1;'), out);
    assert.ok(!/[xyvw]/.test(out), 'template text blanked: ' + out);
    assert.ok(out.includes('${z}'), 'inner hole kept: ' + out);
  });
  it('an object literal brace inside a hole does not end the template early', () => {
    const out = strip('t = `${ {a:1}.a } end`; u = 1;');
    assert.ok(out.endsWith('; u = 1;'), out);
    assert.ok(!out.includes('end'), out);
  });
});

describe('source-strip — regex versus division', () => {
  it('a regex literal is blanked (its `/` delimiters stay); a division is code', () => {
    const re = strip('r = /ab+c/gi.test(s);');
    assert.strictEqual(re, 'r = /    /gi.test(s);');
    const div = strip('q = a / b / c;');
    assert.strictEqual(div, 'q = a / b / c;');
  });
  it('a regex character class may contain `/`', () => {
    const out = strip('r = /[/]x/; y = 2;');
    assert.ok(out.endsWith('; y = 2;'), out);
  });
});

describe('source-strip — robustness', () => {
  it('CRLF: the `\\n` stays; a `\\r` inside a line comment is masked like the rest of the comment', () => {
    // Length and every `\n` position are preserved (the helper asserts both),
    // so line numbers computed on the stripped text match the source.
    const out = strip('a = "s"; // c\r\nb = 1;\r\n');
    assert.strictEqual(out, 'a = " ";      \nb = 1;\r\n');
  });
  it('an unterminated string or comment does not throw and keeps the length', () => {
    strip('a = "never closed\nb = 1;');
    strip('/* never closed\nb = 1;');
    strip('t = `never closed ${x');
  });
  it('POSITIVE CONTROL — code outside literals is untouched byte for byte', () => {
    const src = 'const { a, b } = require(mod);\nif (a < b && b > 0) { return a ?? b; }\n';
    assert.strictEqual(strip(src), src);
  });
});
