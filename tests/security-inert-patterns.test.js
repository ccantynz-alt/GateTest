// =============================================================================
// SECURITY MODULE — dangerous patterns inside strings and comments are INERT
// =============================================================================
// The dangerous-pattern scan in src/modules/security.js had no string or
// comment guard, so prose ABOUT eval() was reported as a call TO eval().
//
// Measured before the fix on a fixture whose every dangerous token sat in a
// doc string or a comment: 13 BLOCKING errors on a file where nothing
// executes. False positives that stop the gate are the worst kind — Bible
// Forbidden #25, "we are the painkiller, not the bottleneck".
//
// Found 2026-07-28 by scanning a deliberately all-inert fixture rather than
// by reading the module, which is the same method that surfaced KI #85-#88.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SecurityModule = require('../src/modules/security');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sec-inert-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function scan(source) {
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(tmp, 'src', 'x.js'), source);
  const mod = new SecurityModule();
  const result = makeResult();
  await mod.run(result, { projectRoot: tmp });
  return result.checks
    .filter((c) => !c.passed && /^security:(eval|innerHTML|document|shell)/.test(c.name))
    .map((c) => c.name);
}

describe('security — dangerous tokens inside STRING literals are not calls', () => {
  it('eval() inside a doc string is not reported', async () => {
    assert.deepStrictEqual(
      await scan('const DOCS = {\n  warn: "eval(userInput) is dangerous — never do this",\n};\nmodule.exports = { DOCS };\n'),
      [],
    );
  });

  it('innerHTML / document.write / exec inside strings are not reported', async () => {
    const found = await scan([
      'const DOCS = {',
      '  a: "element.innerHTML = userInput",',
      '  b: "document.write(x) is forbidden",',
      '  c: "child_process.exec(\'rm -rf \' + dir)",',
      '};',
      'module.exports = { DOCS };',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });
});

describe('security — dangerous tokens inside COMMENTS are not calls', () => {
  it('a line comment mentioning eval() is not reported', async () => {
    assert.deepStrictEqual(
      await scan('// eval(userInput) must never be used\nconst a = 1;\nmodule.exports = { a };\n'),
      [],
    );
  });

  it('a JSDoc block mentioning innerHTML is not reported', async () => {
    assert.deepStrictEqual(
      await scan('/**\n * Never do element.innerHTML = userInput\n */\nconst a = 1;\nmodule.exports = { a };\n'),
      [],
    );
  });
});

describe('security — real dangerous code is STILL reported', () => {
  // The guard must not have turned detection off. This is the half that
  // matters: a false negative here is a security hole.
  it('a real eval() call blocks', async () => {
    const found = await scan('function r(u) {\n  eval(u);\n}\nmodule.exports = { r };\n');
    assert.ok(found.some((n) => n.includes('eval()')), `expected eval finding, got ${JSON.stringify(found)}`);
  });

  it('a real innerHTML assignment blocks', async () => {
    const found = await scan('function r(el, u) {\n  el.innerHTML = u;\n}\nmodule.exports = { r };\n');
    assert.ok(found.some((n) => n.includes('innerHTML')), `expected innerHTML finding, got ${JSON.stringify(found)}`);
  });

  it('a real document.write() blocks', async () => {
    const found = await scan('function r(u) {\n  document.write(u);\n}\nmodule.exports = { r };\n');
    assert.ok(found.some((n) => n.includes('document.write')), `expected document.write finding, got ${JSON.stringify(found)}`);
  });

  it('code on a line that also carries a trailing comment still blocks', async () => {
    // _isCommentLine is whole-line only, deliberately: real code followed by
    // a note is still real code.
    const found = await scan('function r(u) {\n  eval(u); // yes this is deliberate\n}\nmodule.exports = { r };\n');
    assert.ok(found.some((n) => n.includes('eval()')));
  });
});

describe('security — the scan carries a column for the confidence scorer', () => {
  it('findings include the match column', async () => {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    fs.writeFileSync(path.join(tmp, 'src', 'x.js'), 'function r(u) {\n  eval(u);\n}\nmodule.exports = { r };\n');
    const mod = new SecurityModule();
    const result = makeResult();
    await mod.run(result, { projectRoot: tmp });
    const hit = result.checks.find((c) => !c.passed && c.name.includes('security:eval()'));
    assert.ok(hit, 'expected an eval finding');
    assert.strictEqual(typeof hit.column, 'number',
      'without a column the scorer falls back to a whole-line guess');
  });
});

// =============================================================================
// FALSE NEGATIVE: command injection in its most common form
// =============================================================================
// Found 2026-07-28 by inverting the inert-fixture technique — scanning a
// fixture of genuinely-vulnerable code to measure what is MISSED rather than
// what is over-reported.
//
// The only shell-exec rule was /child_process.*exec\s*\(/, which requires
// `child_process` on the SAME LINE. So it caught the inline
// `require('child_process').exec(...)` and missed the ordinary shape:
//
//     const cp = require('child_process');
//     cp.execSync('ls ' + req.query.dir);
//
// Command injection is an OWASP staple and this is how it actually appears.
// =============================================================================

describe('security — command injection via an aliased child_process', () => {
  let tmp2;
  beforeEach(() => { tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sec-cmd-')); });
  afterEach(() => { fs.rmSync(tmp2, { recursive: true, force: true }); });

  async function scanCmd(source) {
    fs.mkdirSync(path.join(tmp2, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp2, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
    fs.writeFileSync(path.join(tmp2, 'src', 'x.js'), source);
    const mod = new SecurityModule();
    const result = makeResult();
    await mod.run(result, { projectRoot: tmp2 });
    return result.checks
      .filter((c) => !c.passed && /shell exec/.test(c.name))
      .map((c) => c.name);
  }

  it('flags execSync with concatenated user input', async () => {
    const found = await scanCmd([
      "const cp = require('child_process');",
      'function run(req) {',
      "  return cp.execSync('ls ' + req.query.dir);",
      '}',
      'module.exports = { run };',
    ].join('\n'));
    assert.ok(found.length > 0, `command injection must be caught, got ${JSON.stringify(found)}`);
  });

  it('flags exec with an interpolated template literal', async () => {
    const found = await scanCmd([
      "const { exec } = require('child_process');",
      'function run(req) {',
      '  return exec(`rm -rf ${req.query.path}`);',
      '}',
      'module.exports = { run };',
    ].join('\n'));
    assert.ok(found.length > 0);
  });

  // The safe alternatives must NOT be punished — flagging them would push
  // people away from the correct fix.
  it('does NOT flag execFileSync with an argv array', async () => {
    const found = await scanCmd([
      "const cp = require('child_process');",
      'function run(dir) { return cp.execFileSync("ls", [dir]); }',
      'module.exports = { run };',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('does NOT flag spawnSync with an argv array', async () => {
    const found = await scanCmd([
      "const cp = require('child_process');",
      'function run(dir) { return cp.spawnSync("ls", ["-la", dir]); }',
      'module.exports = { run };',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('does NOT flag a static command string', async () => {
    const found = await scanCmd([
      "const cp = require('child_process');",
      'function run() { return cp.execSync("git rev-parse HEAD"); }',
      'module.exports = { run };',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });

  it('does NOT flag an exec mentioned only inside a doc string', async () => {
    const found = await scanCmd([
      'const DOCS = { bad: "cp.execSync(\'ls \' + req.query.dir)" };',
      'module.exports = { DOCS };',
    ].join('\n'));
    assert.deepStrictEqual(found, []);
  });
});
