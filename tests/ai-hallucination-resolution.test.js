'use strict';
/**
 * ai-hallucination: dependency resolution + fixture-string guard (KI #48).
 *
 * Two false-positive sources, both measured on this repo before fixing:
 *
 *   1. Dependencies were resolved by walking only UP from projectRoot, so a
 *      package.json BELOW it — a monorepo workspace, a test fixture, an
 *      examples/ dir — was invisible and every one of its imports was reported
 *      as a possible hallucination.
 *
 *   2. The import harvester scanned raw file text, so package names inside
 *      FIXTURE STRINGS were harvested as real imports. A module that tests
 *      framework detection necessarily contains sample code as data:
 *        assert.equal(detectFramework("const express = require('express');"), 'express')
 *      That alone produced 30 findings from one test file and 17 from another.
 *      The giveaway was two of the top "packages" being `${importPath}` and
 *      `*.node`, neither of which can appear in a real specifier.
 *
 * Combined effect, measured: 136 unknown-pkg findings -> 31, and the 31 that
 * remain are true positives (playwright and @babel/parser really are undeclared).
 *
 * EVERY suppression here is paired with a POSITIVE CONTROL asserting a genuinely
 * fake package is still caught. A guard that quiets a scanner by blinding it is
 * worse than the noise it removed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AiHallucination = require('../src/modules/ai-hallucination');

let root;

function write(rel, body) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

async function unknownPkgs() {
  const checks = [];
  const result = { checks, addCheck(name, passed, meta) { checks.push({ name, passed, ...meta }); } };
  await new AiHallucination().run(result, { projectRoot: root });
  return checks
    .filter((c) => String(c.name).includes('unknown-pkg'))
    .map((c) => String(c.name).split(':').pop());
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ah-'));

  // Root manifest: knows `rootonly-pkg`, does NOT know express.
  write('package.json', JSON.stringify({
    name: 'fixture-root', dependencies: { 'rootonly-pkg': '^1.0.0' },
  }));

  // Nested package with its OWN manifest declaring express.
  write('packages/api/package.json', JSON.stringify({
    name: '@fixture/api', dependencies: { express: '^4.0.0' },
  }));
  write('packages/api/server.js', "const express = require('express');\nmodule.exports = express;\n");

  // Nested package using a ROOT dependency — legitimate under npm/pnpm hoisting.
  write('packages/api/hoisted.js', "const r = require('rootonly-pkg');\nmodule.exports = r;\n");

  // A sibling package WITHOUT express — must not inherit it from packages/api.
  write('packages/web/package.json', JSON.stringify({ name: '@fixture/web' }));
  write('packages/web/app.js', "const express = require('express');\nmodule.exports = express;\n");

  // Positive control: a genuinely undeclared package inside the nested package.
  write('packages/api/bogus.js', "const x = require('definitely-not-a-real-pkg-xyz');\nmodule.exports = x;\n");

  // Fixture strings: package names as DATA, not imports.
  write('fixtures.test.js', [
    "const assert = require('node:assert');",
    'const detect = (s) => s;',
    `assert.equal(detect("const express = require('fastify');"), 'x');`,
    "const sample = `import helmet from 'helmet';`;",
    "// const commented = require('commented-out-pkg');",
    'module.exports = { sample };',
  ].join('\n'));

  // Positive control in the SAME file shape: a real undeclared import.
  write('real-import.js', "const y = require('another-fake-pkg-qwerty');\nmodule.exports = y;\n");
});

after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ } // error-ok
});

describe('ai-hallucination — nearest-manifest resolution', () => {
  it('a nested package.json satisfies its own imports', async () => {
    const found = await unknownPkgs();
    assert.ok(!found.includes('express') || found.filter((p) => p === 'express').length < 2,
      `express is declared in packages/api/package.json; got: ${JSON.stringify(found)}`);
  });

  it('a nested package can still use a hoisted ROOT dependency', async () => {
    const found = await unknownPkgs();
    assert.ok(!found.includes('rootonly-pkg'),
      'ancestors are unioned, not shadowed — npm hoists, so this resolves');
  });

  it('POSITIVE CONTROL: a genuinely undeclared package is still flagged', async () => {
    const found = await unknownPkgs();
    assert.ok(found.includes('definitely-not-a-real-pkg-xyz'),
      `the nested fix must not blind the module; got: ${JSON.stringify(found)}`);
  });

  it('a sibling package does NOT inherit its neighbour\'s dependencies', async () => {
    // packages/web has no express; resolution walks UP, never sideways.
    const found = await unknownPkgs();
    assert.ok(found.includes('express'),
      `packages/web/app.js imports express with no manifest declaring it; got: ${JSON.stringify(found)}`);
  });
});

describe('ai-hallucination — fixture strings are not imports', () => {
  it('a package name inside a double-quoted string is not harvested', async () => {
    const found = await unknownPkgs();
    assert.ok(!found.includes('fastify'),
      `fastify appears only inside a fixture string; got: ${JSON.stringify(found)}`);
  });

  it('a package name inside a template literal is not harvested', async () => {
    const found = await unknownPkgs();
    assert.ok(!found.includes('helmet'), 'helmet appears only inside a template literal');
  });

  it('a commented-out import is not harvested', async () => {
    const found = await unknownPkgs();
    assert.ok(!found.includes('commented-out-pkg'), 'a commented import is not an import');
  });

  it('POSITIVE CONTROL: a real undeclared import in normal code is still flagged', async () => {
    const found = await unknownPkgs();
    assert.ok(found.includes('another-fake-pkg-qwerty'),
      `the string guard must only skip strings and comments; got: ${JSON.stringify(found)}`);
  });
});
