// =============================================================================
// SECURITY MODULE — correctly-escaped innerHTML is not an XSS finding
// =============================================================================
// The rule was a bare `/\.innerHTML\s*=(?!=)/` match on the sink, with no
// look at what was being assigned. So it reported, at BLOCKING severity:
//
//     el.innerHTML = '';                                  // clearing a node
//     el.innerHTML = "<div>" + escapeHtml(name) + "</div>" // correctly escaped
//
// Measured 2026-09-01 against a positive/negative control pair: 1 of 2
// innerHTML findings was a false positive on escaped output. A rule that
// fails the gate on correct code teaches customers to bypass the gate —
// Bible Forbidden #25, "we are the painkiller, not the bottleneck".
//
// The suppression is deliberately narrow, and these tests exist to prove it
// stayed narrow. Every SAFE case below must be silent; every UNSAFE case must
// still fire. Without the unsafe half, tightening the rule until the repo
// goes quiet would be indistinguishable from the rule working — which is the
// failure mode this repo has shipped before (commit 695f7700).
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

const SecurityModule = require('../src/modules/security');

const mod = new SecurityModule();
const isSafe = (line) => mod._innerHtmlAssignmentIsSafe(line);

describe('security — innerHTML assignments that cannot inject', () => {
  const SAFE = [
    ["clearing a node", `el.innerHTML = '';`],
    ["clearing a node, double quotes", `el.innerHTML = "";`],
    ["a wholly static literal", `el.innerHTML = "<hr>";`],
    ["a static template literal", 'el.innerHTML = `<hr>`;'],
    ["a single escaper call", `el.innerHTML = escapeHtml(name);`],
    ["concatenation, every hole escaped", `el.innerHTML = "<div>" + escapeHtml(name) + "</div>";`],
    ["template literal, every hole escaped", 'el.innerHTML = `<div>${escapeHtml(name)}</div>`;'],
    ["DOMPurify", `el.innerHTML = DOMPurify.sanitize(dirty);`],
    ["encodeURIComponent percent-encodes < and >", `el.innerHTML = "<a>" + encodeURIComponent(u) + "</a>";`],
    // The `+` here is INSIDE a call argument. A naive split on '+' would see
    // two operands, decide `b)` is not escaped, and fire.
    ["a + inside the escaper's own argument", `el.innerHTML = escapeHtml(a + b);`],
  ];

  for (const [why, line] of SAFE) {
    it(`silent: ${why}`, () => {
      assert.strictEqual(isSafe(line), true, `should be treated as safe:\n  ${line}`);
    });
  }
});

describe('security — innerHTML assignments that still fire', () => {
  const UNSAFE = [
    ["raw concatenation of user input", `el.innerHTML = "<div>" + req.query.name + "</div>";`],
    ["raw interpolation", 'el.innerHTML = `<div>${req.query.name}</div>`;'],
    ["a bare variable", `el.innerHTML = userInput;`],
    // The whole point of the narrowness: one escaped operand does not
    // launder the unescaped one sitting next to it.
    ["partial escaping — escaped + unescaped", `el.innerHTML = escapeHtml(a) + b;`],
    ["partial escaping, template literal", 'el.innerHTML = `${escapeHtml(a)}${b}`;'],
    // A '+' inside a string literal must not be mistaken for concatenation
    // and turn an unescaped assignment into a "safe" one.
    ["a + character inside a string literal", `el.innerHTML = "a + b" + userInput;`],
    ["a property read is not an escaper", `el.innerHTML = user.escapeHtml;`],
    // Naming is not evidence. A function called cleanse() is not on the list.
    ["an unrecognised 'reassuring' function name", `el.innerHTML = cleanse(x);`],
  ];

  for (const [why, line] of UNSAFE) {
    it(`fires: ${why}`, () => {
      assert.strictEqual(isSafe(line), false, `should still be reported:\n  ${line}`);
    });
  }
});

describe('security — declines to judge what it cannot parse', () => {
  // Returning "safe" on a bad parse would silence findings invisibly. When
  // the expression is not fully on this line, or brackets/quotes do not
  // balance, the finding must stand.
  const UNPARSEABLE = [
    ["assignment continues on the next line", `el.innerHTML =`],
    ["unbalanced parens", `el.innerHTML = escapeHtml(name;`],
    ["unterminated string", `el.innerHTML = "<div>;`],
  ];

  for (const [why, line] of UNPARSEABLE) {
    it(`does not claim safe: ${why}`, () => {
      assert.strictEqual(isSafe(line), false, `should decline to clear:\n  ${line}`);
    });
  }

  it('_splitTopLevel returns null rather than a bad parse', () => {
    assert.strictEqual(mod._splitTopLevel('escapeHtml(a + b', '+'), null);
    assert.strictEqual(mod._splitTopLevel('"unclosed + x', '+'), null);
    assert.deepStrictEqual(mod._splitTopLevel('"a" + b', '+'), ['"a"', 'b']);
    assert.deepStrictEqual(mod._splitTopLevel('f(a + b) + c', '+'), ['f(a + b)', 'c']);
  });
});
