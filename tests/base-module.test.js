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

describe('BaseModule#_maskedLines / _insideLiteral — the one stripper, line by line', () => {
  const mod = new BaseModule('test', 'test');
  const inside = (src, word, rel = 'a.js') => {
    const lines = src.split(/\r?\n/);
    const masked = mod._maskedLines(src, rel);
    const i = lines.findIndex((l) => l.includes(word));
    return mod._insideLiteral(masked, lines, i, lines[i].indexOf(word));
  };

  it('is false for a real top-level statement (the case that must still be flagged)', () => {
    assert.strictEqual(inside('process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";', 'process'), false);
  });

  it('is true when the same text is nested inside an outer string literal (test fixture data)', () => {
    assert.strictEqual(inside("write(tmp, 'src/a.js', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = \"0\";\\n');", 'process'), true);
  });

  it('is true inside a single-quoted config value', () => {
    assert.strictEqual(inside("secret: 'changeme'", 'changeme'), true);
  });

  it('handles escaped quotes without losing track of string state', () => {
    assert.strictEqual(inside(String.raw`const s = 'it\'s fine'; process.env.X = "0";`, 'process'), false);
  });

  it('a call inside ${…} is not inside a string; text after a closed hole, or in a plain string, is', () => {
    assert.strictEqual(inside('const apiKey = `${Math.random()}`;', 'Math'), false);
    assert.strictEqual(inside('t = `${ `${Math.random()}` }`', 'Math'), false);
    assert.strictEqual(inside('s = `a ${f("}")} Math`', 'Math'), true);
    assert.strictEqual(inside('x = "const token = Math.random()"', 'Math'), true);
  });

  it('sees what a per-line counter never could: a template literal and a block comment spanning lines', () => {
    assert.strictEqual(inside('const t = `line one\nprocess.env.X = "0";\n`;', 'process'), true);
    assert.strictEqual(inside('/* opened above\nprocess.env.X = "0";\n*/', 'process'), true);
  });

  it('blanks a regex literal used in a test assertion, keeping delimiters; a real object literal stays visible', () => {
    const [m1] = mod._maskedLines('assert.doesNotMatch(result, /rejectUnauthorized: false/);');
    assert.strictEqual(m1, 'assert.doesNotMatch(result, /                         /);');
    const [m2] = mod._maskedLines('const agent = new https.Agent({ rejectUnauthorized: false });');
    assert.ok(m2.includes('rejectUnauthorized: false'), 'real code must still be visible');
    const [m3] = mod._maskedLines('const half = total / 2;');
    assert.strictEqual(m3, 'const half = total / 2;');
    const [m4] = mod._maskedLines('const re = /[a/b]:false/;');
    assert.ok(!m4.includes('false'), `expected the char-class regex blanked, got: ${m4}`);
  });

  it('a .py file is masked by the Python stripper: an apostrophe in a # comment opens nothing', () => {
    assert.strictEqual(inside("x = 1 # don't\nmodel = 'gpt-4'\n", 'model', 'a.py'), false);
  });

  it('_matchOnRaw reads a quoted value at the offset where the masked line kept the opening quote', () => {
    const line = "  secret: 'changeme',";
    const [code] = mod._maskedLines(line);
    const m = mod._matchOnRaw(code, line, /secret\s*:\s*['"]/, /secret\s*:\s*['"]([^'"]+)['"]/y);
    assert.strictEqual(m && m[1], 'changeme');
    const quoted = "const example = \"secret: 'changeme'\";";
    const [code2] = mod._maskedLines(quoted);
    assert.strictEqual(mod._matchOnRaw(code2, quoted, /secret\s*:\s*['"]/, /secret\s*:\s*['"]([^'"]+)['"]/y), null);
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
