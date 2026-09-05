'use strict';
/**
 * ai-hallucination harvests imports from the MASKED source (source-strip.js),
 * so a `require()` in a trailing comment, a block comment or a string is not
 * an import. Found 2026-09-05 by our own scanner on src/core/ts-tokens.js:
 * `return null; // import x = require('…')` was reported as a hallucinated
 * package named `…` — the whole-line comment guard could not see a comment
 * that follows code. Control pair: every silence has a positive control.
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
  return r.checks.filter((c) => !c.passed && c.name.startsWith('ai-hallucination:unknown-pkg:')).map((c) => c.name);
}

describe('ai-hallucination — imports in comments and strings are not imports', () => {
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-halluc-'));
    write('package.json', JSON.stringify({ name: 'p', dependencies: { express: '4' } }));
    write('src/trailing.js', "const e = require('express');\nfunction f() { return null; } // import x = require('ghost-trailing')\n");
    write('src/block.js', "/* const g = require('ghost-block'); */\nconst e = require('express');\n");
    write('src/string.js', "const s = \"const x = require('ghost-string');\";\nconst t = `import y from 'ghost-template'`;\n");
    write('src/real.js', "const g = require('ghost-real');\nimport h from 'ghost-import';\n");
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it('NEGATIVE CONTROL — a require in a trailing comment, a block comment, a string or a template is silent', async () => {
    const names = await scan();
    for (const ghost of ['ghost-trailing', 'ghost-block', 'ghost-string', 'ghost-template']) {
      assert.ok(!names.some((n) => n.includes(ghost)), `${ghost} must not be reported: ${names.join(', ')}`);
    }
  });

  it('POSITIVE CONTROL — a real require and a real import of an undeclared package are still reported', async () => {
    const names = await scan();
    assert.ok(names.some((n) => n.includes('ghost-real')), `ghost-real must be reported: ${names.join(', ')}`);
    assert.ok(names.some((n) => n.includes('ghost-import')), `ghost-import must be reported: ${names.join(', ')}`);
  });
});
