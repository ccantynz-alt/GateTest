'use strict';

// =============================================================================
// NO UNTRUSTED TEXT MAY REACH A SHELL
// =============================================================================
// GateTest's own security module found two of these in GateTest on 2026-08-31,
// and both were real:
//
//   setup.js          the run script it GENERATES into a customer repo did
//                     `execSync(\`node ${path} ${siteUrl}\`)` — the site URL
//                     comes from argv, and the string form also broke outright
//                     on any install path containing a space.
//   src/app-server.js `execSync(\`rm -rf ${tmpDir}\`)` in a finally block,
//                     where tmpDir embeds the webhook-supplied owner and repo
//                     name. `rm -rf` is the worst sink there is.
//
// A third, `execSync(\`node … --project ${tmpDir}\`)` in the same file, was
// NOT reported: the module's rule needs the `+` or `${` on the same line as
// the exec call, and that one wraps. Fixed here too, and asserted, because a
// detector gap is not an absolution.
//
// These are source assertions rather than behavioural ones on purpose: the
// property being protected is "this file never builds a shell command string",
// which is exactly what a future edit would silently undo.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Lines calling exec/execSync with a concatenation or an interpolation. */
function shellExecWithInterpolation(source) {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter(({ line }) => /\bexecSync\s*\(\s*[^)]*(?:\+|\$\{)/.test(line)
      || /\bexec\s*\(\s*[`'"][^`'"]*(?:\+|\$\{)/.test(line))
    .map(({ line, no }) => `${no}: ${line.trim()}`);
}

describe('src/app-server.js — webhook input never reaches a shell', () => {
  const source = read('src/app-server.js');

  it('builds no shell command string at all', () => {
    assert.deepStrictEqual(shellExecWithInterpolation(source), []);
  });

  it('does not import execSync, so reaching for it is a visible change', () => {
    assert.doesNotMatch(source, /require\(['"]child_process['"]\)[\s\S]{0,80}\bexecSync\b/);
    assert.match(source, /const \{ execFileSync \} = require\('child_process'\)/);
  });

  it('cleans the clone directory with fs.rmSync, not a shelled rm -rf', () => {
    // Executable lines only — the comment above the fix names the pattern it
    // replaced, and that mention is the documentation, not the defect.
    const codeWithRmRf = source
      .split(/\r?\n/)
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && /rm\s+-rf/.test(line))
      .map(({ line, no }) => `${no}: ${line.trim()}`);
    assert.deepStrictEqual(codeWithRmRf, [],
      'rm -rf through a shell, with an owner/repo-derived path, is the finding this replaced');
    assert.match(source, /fs\.rmSync\(tmpDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/);
  });

  it('runs the scan through execFileSync with an argv array', () => {
    assert.match(
      source,
      /execFileSync\(\s*process\.execPath,\s*\[[^\]]*'--project',\s*tmpDir\]/,
      'the scan invocation must pass --project as its own argv element',
    );
  });

  it('POSITIVE CONTROL: the detector above still finds a real shell-exec bug', () => {
    // Without this the assertions could pass by matching nothing forever.
    const planted = [
      "const { execSync } = require('child_process');",
      'function clean(dir) {',
      '  execSync(`rm -rf ${dir}`);',
      '}',
    ].join('\n');
    assert.deepStrictEqual(
      shellExecWithInterpolation(planted),
      ['3: execSync(`rm -rf ${dir}`);'],
    );
  });

  it('POSITIVE CONTROL: the detector finds the concatenated form too', () => {
    const planted = "  execSync('ls ' + req.query.dir);";
    assert.strictEqual(shellExecWithInterpolation(planted).length, 1);
  });
});

describe('setup.js — the script it generates is shell-free', () => {
  const source = read('setup.js');

  it('the generated run script builds no shell command string', () => {
    assert.deepStrictEqual(shellExecWithInterpolation(source), []);
  });

  it('the generated run script uses execFileSync with an argv array', () => {
    assert.match(source, /const \{ execFileSync \} = require\('child_process'\)/,
      'the generated script must require execFileSync');
    assert.match(
      source,
      /execFileSync\(process\.execPath,\s*\[path\.join\(gateTestPath, 'src\/ai-loop\.js'\), siteUrl\]/,
      'the site URL must be its own argv element, not spliced into a command string',
    );
  });

  it('a site URL carrying shell metacharacters survives as one argument', () => {
    // The generated script embeds the URL with JSON.stringify, so what a
    // hostile value could previously do was escape the JS string's *shell*
    // context, not its JS context. Assert the value stays a single argv slot.
    const generated = source.match(/const runScript = `([\s\S]*?)\n`;/);
    assert.ok(generated, 'expected to find the generated run-script template');
    const body = generated[1];
    assert.doesNotMatch(body, /execSync/);
    assert.match(body, /\[path\.join\(gateTestPath, 'src\/ai-loop\.js'\), siteUrl\]/);
  });
});
