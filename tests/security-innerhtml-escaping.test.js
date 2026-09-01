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
const fs = require('fs');
const path = require('path');

const SecurityModule = require('../src/modules/security');
const { innerHtmlAssignmentIsSafe } = require('../src/core/inner-html-safety');
const { DEFAULT_CONFIG } = require('../src/core/config');

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

describe('security — ONE predicate, both innerHTML rules', () => {
  // The engine carries two independent innerHTML rules: this module's, and
  // the forbidden-pattern entry in src/core/config.js that codeQuality runs.
  // Guarding only the first one still failed the gate on escaped output,
  // because the second kept reporting the same line. Two rules for one
  // concept means fixing the concept once is not enough.
  it('the security module delegates rather than keeping a copy', () => {
    const line = `el.innerHTML = "<div>" + escapeHtml(n) + "</div>";`;
    assert.strictEqual(mod._innerHtmlAssignmentIsSafe(line), innerHtmlAssignmentIsSafe(line));
    assert.strictEqual(mod._innerHtmlAssignmentIsSafe(line), true);
  });

  it("codeQuality's innerHTML pattern carries the same guard", () => {
    const patterns = DEFAULT_CONFIG.modules.codeQuality.forbiddenPatterns;
    const rule = patterns.find((p) => /innerHTML/.test(p.pattern.source));
    assert.ok(rule, 'codeQuality no longer has an innerHTML forbidden pattern');
    assert.strictEqual(
      rule.safeIf,
      innerHtmlAssignmentIsSafe,
      'codeQuality must share the security module predicate, not its own copy',
    );
  });

  it('no module re-implements the predicate inline', () => {
    // The whole point is one home. If a second definition appears, this fails.
    const roots = ['src/modules', 'src/core'];
    const offenders = [];
    for (const rel of roots) {
      const dir = path.join(__dirname, '..', rel);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.js') || f === 'inner-html-safety.js') continue;
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        // A local copy would need its own escaper allow-list.
        if (/escapeHtml\|escapeHTML\|htmlEscape/.test(src)) offenders.push(`${rel}/${f}`);
      }
    }
    assert.deepStrictEqual(
      offenders, [],
      `these files carry their own escaper allow-list — import it from ` +
      `src/core/inner-html-safety.js instead:\n  ${offenders.join('\n  ')}`,
    );
  });
});

describe('security — the assignment expression, not the rest of the line', () => {
  // Found auditing our OWN side of the cross-engine diff against
  // ccantynz/Gluecron.com @e168803 (gluecron.com, org ccantynz). A static
  // literal assignment inside a single-line if-block was reported, because the
  // right-hand side ran to end-of-line and swallowed `; return; }` — which is
  // not a static literal, so the safety check failed on code that is provably
  // safe. src/routes/demo.tsx:181, 182, 187 and 188 are all this shape.
  const CASES = {
    'static literal followed by return in a one-line if':
      `if(!d.items.length){el.innerHTML='<li class="empty">none</li>';return;}`,
    'static literal followed by another statement':
      `el.innerHTML = '<hr>'; doSomethingElse();`,
    'escaped concatenation followed by return':
      `if(x){el.innerHTML='<b>'+escapeHtml(n)+'</b>';return;}`,
    'escHtml is a recognised escaper':
      `d.innerHTML='<span>'+escHtml(u.username)+'</span>';`,
  };

  for (const [why, line] of Object.entries(CASES)) {
    it(`safe: ${why}`, () => {
      assert.strictEqual(isSafe(line), true, `should be safe:\n  ${line}`);
    });
  }

  it('a semicolon inside a string does not truncate the expression', () => {
    // If the split were naive, this would become `el.innerHTML = "a` and fail
    // to parse — declining to judge rather than clearing it. Still safe here,
    // but for the right reason.
    assert.strictEqual(isSafe(`el.innerHTML = "a;b<hr>";`), true);
  });

  it('an unescaped value after a one-line if STILL fires', () => {
    // The load-bearing negative for this fix.
    assert.strictEqual(
      isSafe(`if(x){el.innerHTML='<b>'+req.query.name+'</b>';return;}`), false,
    );
  });

  it('a bare esc() is NOT trusted', () => {
    // Three letters could be escape, escaped, or nothing to do with HTML.
    assert.strictEqual(isSafe(`el.innerHTML = '<b>' + esc(x) + '</b>';`), false);
  });
});
