// =============================================================================
// KI #77, the write-path half: a fix must not rewrite the customer's line endings
// =============================================================================
// The 22 modules left out of the mechanical CRLF conversion each split a
// file AND re-joined it with '\n'. For the ones that write the result back —
// ai-review's _applyFix, code-quality's two line removers, lint's markdown
// autoFix, mutation's mutant writer — converting the split alone would have
// stripped every `\r` and silently rewritten the file. Each pair is now
// split with splitLines() and joined with the file's own ending, and these
// are the control pairs: a CRLF file keeps CRLF, an LF file keeps LF, and
// the edit itself is the same in both.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AiReviewModule = require('../src/modules/ai-review');
const CodeQualityModule = require('../src/modules/code-quality');
const LintModule = require('../src/modules/lint');
const { splitLines, joinLines, detectEol } = require('../src/core/text-lines');

function makeResult() {
  return { checks: [], addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); } };
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-crlf-write-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const write = (rel, text) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
const read = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');

for (const [label, eol] of [['CRLF', '\r\n'], ['LF', '\n']]) {
  describe(`write paths keep ${label}`, () => {
    it(`code-quality _removeLineFromFile removes one line and keeps ${label}`, () => {
      const src = ['const a = 1;', 'console.log(a);', 'module.exports = a;', ''].join(eol);
      const abs = write('src/a.js', src);
      const r = new CodeQualityModule()._removeLineFromFile(abs, 1, 'src/a.js', 'console.log');
      assert.equal(r.fixed, true);
      assert.equal(read('src/a.js'), ['const a = 1;', 'module.exports = a;', ''].join(eol));
    });

    it(`code-quality _removeLinesFromFile removes a block and keeps ${label}`, () => {
      const src = ['a();', '// b();', '// c();', 'd();', ''].join(eol);
      const abs = write('src/b.js', src);
      const r = new CodeQualityModule()._removeLinesFromFile(abs, 1, 2, 'src/b.js');
      assert.equal(r.fixed, true);
      assert.equal(read('src/b.js'), ['a();', 'd();', ''].join(eol));
    });

    it(`ai-review _applyFix replaces the line and keeps ${label}`, () => {
      write('src/c.js', ['x();', 'eval(s);', 'y();', ''].join(eol));
      const r = new AiReviewModule()._applyFix(tmp, 'src/c.js', 2, 'JSON.parse(s);');
      assert.equal(r.fixed, true);
      assert.equal(read('src/c.js'), ['x();', 'JSON.parse(s);', 'y();', ''].join(eol));
    });

    it(`lint markdown autoFix trims trailing spaces, collapses blank runs, keeps ${label}`, async () => {
      write('README.md', ['# T  ', '', '', '', 'para   ', ''].join(eol));
      const result = makeResult();
      await new LintModule().run(result, { projectRoot: tmp });
      const md = result.checks.find((c) => c.name === 'lint:markdown:README.md' && typeof c.autoFix === 'function');
      assert.ok(md, 'the markdown check with an autoFix was not produced');
      assert.equal(md.autoFix().fixed, true);
      assert.equal(read('README.md'), ['# T', '', 'para', ''].join(eol));
    });
  });
}

describe('text-lines — the one definition the write paths share', () => {
  it('joinLines follows the original text, whatever it contained', () => {
    assert.equal(joinLines(['a', 'b'], 'x\r\ny'), 'a\r\nb');
    assert.equal(joinLines(['a', 'b'], 'x\ny'), 'a\nb');
    assert.equal(detectEol(''), '\n');
    assert.deepEqual(splitLines('a\r\nb\nc'), ['a', 'b', 'c']);
  });
});
