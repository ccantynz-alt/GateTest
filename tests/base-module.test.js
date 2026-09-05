const { describe, it } = require('node:test');
const assert = require('node:assert');

const BaseModule = require('../src/modules/base-module');

describe('BaseModule#_exec — timeout vs crash detection', () => {
  it('returns exitCode 0, timedOut false on a clean command', () => {
    const mod = new BaseModule('test', 'test');
    const r = mod._exec('node -e "process.exit(0)"', { timeout: 5000 });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.timedOut, false);
    assert.strictEqual(r.signal, null);
  });

  it('flags timedOut when the command outlives its timeout budget', () => {
    const mod = new BaseModule('test', 'test');
    const r = mod._exec('node -e "setTimeout(()=>{}, 5000)"', { timeout: 300 });
    assert.strictEqual(r.timedOut, true, 'a killed-by-timeout command must be distinguishable from a real crash');
    assert.strictEqual(r.signal, 'SIGTERM');
  });

  it('does not flag timedOut on a real non-zero exit', () => {
    const mod = new BaseModule('test', 'test');
    const r = mod._exec('node -e "process.exit(2)"', { timeout: 5000 });
    assert.strictEqual(r.exitCode, 2);
    assert.strictEqual(r.timedOut, false, 'a real crash/non-zero exit must not be mistaken for a timeout');
  });
});

describe('BaseModule#_isInsideStringLiteral', () => {
  const mod = new BaseModule('test', 'test');

  it('is false for a real top-level statement (the case that must still be flagged)', () => {
    const line = 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";';
    const idx = line.indexOf('process');
    assert.strictEqual(mod._isInsideStringLiteral(line, idx), false);
  });

  it('is true when the same text is nested inside an outer string literal (test fixture data)', () => {
    const line = "write(tmp, 'src/a.js', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = \"0\";\\n');";
    const idx = line.indexOf('process');
    assert.strictEqual(mod._isInsideStringLiteral(line, idx), true);
  });

  it('is true inside a single-quoted config value', () => {
    const line = "secret: 'changeme'";
    const idx = line.indexOf('changeme');
    assert.strictEqual(mod._isInsideStringLiteral(line, idx), true);
  });

  it('handles escaped quotes without losing track of string state', () => {
    const line = String.raw`const s = 'it\'s fine'; process.env.X = "0";`;
    const idx = line.indexOf('process');
    assert.strictEqual(mod._isInsideStringLiteral(line, idx), false);
  });
});

describe('BaseModule#_stripJsStrings — regex literals', () => {
  const mod = new BaseModule('test', 'test');

  it('blanks a regex literal used in a test assertion, keeping delimiters', () => {
    const { stripped } = mod._stripJsStrings('assert.doesNotMatch(result, /rejectUnauthorized: false/);', false);
    assert.ok(!stripped.includes('rejectUnauthorized'), `expected regex body blanked, got: ${stripped}`);
    assert.strictEqual(stripped, 'assert.doesNotMatch(result, /                         /);');
  });

  it('still flags a real object literal (not a regex) unaffected by the new branch', () => {
    const { stripped } = mod._stripJsStrings('const agent = new https.Agent({ rejectUnauthorized: false });', false);
    assert.ok(stripped.includes('rejectUnauthorized: false'), 'real code must still be visible after stripping');
  });

  it('does not mistake division for a regex literal', () => {
    const { stripped } = mod._stripJsStrings('const half = total / 2;', false);
    assert.strictEqual(stripped, 'const half = total / 2;');
  });

  it('handles a character class containing a slash inside the regex', () => {
    const { stripped } = mod._stripJsStrings('const re = /[a/b]:false/;', false);
    assert.ok(!stripped.includes('false'), `expected regex with char-class blanked, got: ${stripped}`);
  });
});

describe('BaseModule#_isCommentLine', () => {
  const mod = new BaseModule('test', 'test');

  it('recognises the comment forms modules actually meet', () => {
    for (const l of [
      '// line comment',
      '  // indented',
      '/* block open',
      ' * jsdoc continuation',
      '# shell or python comment',
    ]) {
      assert.strictEqual(mod._isCommentLine(l), true, JSON.stringify(l));
    }
  });

  it('does not claim real code', () => {
    for (const l of [
      'const a = 1;',
      'await sleep(5);',
      'const url = "http://x/*y";',
      'a = b / c; // trailing note',   // code with a trailing comment is CODE
      '',
      '   ',
    ]) {
      assert.strictEqual(mod._isCommentLine(l), false, JSON.stringify(l));
    }
  });

  it('tolerates junk input', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      assert.strictEqual(mod._isCommentLine(v), false);
    }
  });
});

// `${…}` inside a template literal is CODE. Until 2026-09-05 the guard read
// `apiKey = \`${Math.random()}\`` as prose, so the security module anchored
// its regex at the line start to dodge the guard — and then fired on
// Math.random() inside a plain string (the inert-fixture sweep caught it).
describe('BaseModule#_isInsideStringLiteral — template expressions are code', () => {
  const mod = new BaseModule('t', 'd');
  const at = (line, word) => mod._isInsideStringLiteral(line, line.indexOf(word));
  it('a call inside ${…} is not inside a string', () => {
    assert.strictEqual(at('const apiKey = `${Math.random()}`;', 'Math'), false);
    assert.strictEqual(at('t = `${ `${Math.random()}` }`', 'Math'), false);
  });
  it('POSITIVE CONTROL: text after a closed ${…}, or in a plain string, is still inside the string', () => {
    assert.strictEqual(at('s = `a ${f("}")} Math`', 'Math'), true);
    assert.strictEqual(at('s = `a ${ {a:1} } Math`', 'Math'), true);
    assert.strictEqual(at('x = "const token = Math.random()"', 'Math'), true);
  });
});
