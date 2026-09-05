'use strict';
/**
 * ai-hallucination reads package imports from the one import graph
 * (src/core/import-graph.js `externals`) instead of its own harvester —
 * 2026-09-05. Every shape below is a control pair: the import the graph sees
 * that the old per-line regex could not (a re-export, a multi-line import, a
 * dynamic import()), and the silence that must hold beside it (a scheme
 * specifier, a baseUrl-relative import, a type-only import typed by
 * @types/*, a framework-provided virtual module). A file the module sees but
 * the graph never read is reported as NOT CHECKED, not passed in silence.
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
async function scan() {
  const r = { checks: [], addCheck(n, p, d = {}) { this.checks.push({ name: n, passed: p, ...d }); } };
  await new AiHallucination().run(r, { projectRoot: root });
  return r.checks;
}
const unknown = (checks) => checks.filter((c) => !c.passed && c.name.startsWith('ai-hallucination:unknown-pkg:'));
const has = (checks, pkg) => unknown(checks).some((c) => c.name.endsWith(`:${pkg}`));
const sevOf = (checks, pkg) => (unknown(checks).find((c) => c.name.endsWith(`:${pkg}`)) || {}).severity;

describe('ai-hallucination — package imports come from the one import graph', () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-halluc-graph-'));
    write('package.json', JSON.stringify({
      name: 'p',
      dependencies: { express: '4', '@docusaurus/core': '3' },
      devDependencies: { '@types/aws-lambda': '8', '@types/scope__typed': '1' },
    }));
    write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.' } }));
    // Shapes the old per-line regex could not see.
    write('src/reexport.ts', "export { x } from 'ghost-reexport';\nexport * from 'ghost-star';\n");
    write('src/multi.ts', "import {\n  a,\n  b,\n} from 'ghost-multi';\nexport const c = a + b;\n");
    write('src/dyn.mjs', "export const load = async () => (await import('ghost-dyn')).default;\n");
    // Silences that must hold beside them.
    write('src/scheme.mts', "import { bench } from 'npm:ghost-scheme';\nimport { env } from 'cloudflare:workers';\nexport const s = bench(env);\n");
    write('src/app/util.ts', 'export const u = 1;\n');
    write('src/baseurl.ts', "import { u } from 'src/app/util';\nexport const v = u;\n");
    write('src/typed.ts', "import type { Handler } from 'aws-lambda';\nimport type { T } from '@scope/typed';\nimport type { Only } from 'ghost-typeonly';\nexport const h: Handler | T | Only = null as never;\n");
    write('src/both.ts', "import type { T } from 'ghost-both';\nimport both from 'ghost-both';\nexport const b: T = both;\n");
    write('src/docs.tsx', "import Link from '@docusaurus/Link';\nexport const L = () => <Link to=\"/\" />;\n");
    write('src/ok.js', "const e = require('express');\nmodule.exports = e;\n");
    // A file under a dot-directory: read like any other since the walk
    // stopped skipping dot-directories (src/core/walk-excludes.js, 2026-09-05).
    write('.configs/build.config.js', "import ghost from 'ghost-dotdir';\nexport default ghost;\n");
    // A file over the graph's 2 MB cap: the module sees it, the graph does not.
    write('src/huge.js', "import ghost from 'ghost-huge';\n" + '/*' + ' '.repeat(2 * 1024 * 1024 + 10) + '*/\nexport default ghost;\n');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('POSITIVE CONTROLS — a re-export, a multi-line import and a dynamic import() of an undeclared package are reported', async () => {
    const checks = await scan();
    for (const pkg of ['ghost-reexport', 'ghost-star', 'ghost-multi', 'ghost-dyn']) {
      assert.ok(has(checks, pkg), `${pkg} must be reported: ${unknown(checks).map((c) => c.name).join(', ')}`);
    }
    assert.strictEqual(sevOf(checks, 'ghost-multi'), 'warning');
  });

  it('NEGATIVE CONTROLS — a scheme specifier, a baseUrl-relative import, a declared package and a framework-provided virtual module are silent', async () => {
    const checks = await scan();
    for (const pkg of ['npm:ghost-scheme', 'cloudflare:workers', 'src', 'express', '@docusaurus/Link']) {
      assert.ok(!has(checks, pkg), `${pkg} must not be reported: ${unknown(checks).map((c) => c.name).join(', ')}`);
    }
  });

  it('a type-only import is satisfied by @types/<pkg> (scoped: @types/scope__name); an untyped one is info, not warning', async () => {
    const checks = await scan();
    assert.ok(!has(checks, 'aws-lambda'), 'aws-lambda is typed by @types/aws-lambda');
    assert.ok(!has(checks, '@scope/typed'), '@scope/typed is typed by @types/scope__typed');
    assert.strictEqual(sevOf(checks, 'ghost-typeonly'), 'info');
  });

  it('a value import outranks a type import of the same package: severity is warning and the line is the value import', async () => {
    const checks = await scan();
    const c = unknown(checks).find((x) => x.name.endsWith(':ghost-both'));
    assert.ok(c, 'ghost-both must be reported');
    assert.strictEqual(c.severity, 'warning');
    assert.strictEqual(c.line, 2);
  });

  it('a dot-directory file is read like any other — its undeclared import is reported', async () => {
    const checks = await scan();
    assert.ok(has(checks, 'ghost-dotdir'), `the graph reads .configs/: ${unknown(checks).map((c) => c.name).join(', ')}`);
  });

  it('a file the graph did not read (over its size cap) is NOT CHECKED — named in the summary, its imports neither reported nor passed', async () => {
    const checks = await scan();
    assert.ok(!has(checks, 'ghost-huge'), 'the graph never read src/huge.js, so nothing can be reported from it');
    const nc = checks.find((c) => c.name === 'ai-hallucination:not-checked');
    assert.ok(nc, 'the not-checked summary must be present');
    assert.deepStrictEqual(nc.notChecked, ['src/huge.js']);
    assert.match(nc.message, /NOT checked/);
  });
});
