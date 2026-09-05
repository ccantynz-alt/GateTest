'use strict';

// monorepoConstraints — behavioural tests with positive AND negative controls.
// KI #106 (the Fifty, move 11): the module only ever looked in apps/ packages/
// libs/ services/. Members declared under examples/*, www (trpc) or
// packages/** (prisma) were invisible. Now reads the workspaces; the two
// layer rules are unchanged; two objective rules were added.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MonorepoConstraints = require('../src/modules/monorepo-constraints');

function makeResult() {
  const checks = [];
  return { checks, addCheck(name, passed, details) { checks.push({ name, passed, ...(details || {}) }); } };
}

describe('MonorepoConstraints', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mono-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const w = (rel, c) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof c === 'string' ? c : JSON.stringify(c)); };
  const run = async () => { const r = makeResult(); await new MonorepoConstraints().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks; };
  const failing = (c) => c.filter((x) => !x.passed).map((x) => x.name);

  it('a single package is not a monorepo', async () => {
    w('package.json', { name: 'solo' });
    w('src/index.js', "const x = require('./y');\n");
    assert.ok((await run()).some((c) => c.name === 'monorepo-constraints:not-monorepo'));
  });

  it('POSITIVE (unchanged rule 1, conventional dirs, no workspaces file): apps/web importing apps/api is an error', async () => {
    w('apps/web/package.json', { name: 'web' });
    w('apps/api/package.json', { name: 'api' });
    w('apps/web/src/a.ts', "import { db } from '../../api/src/db';\n");
    const f = failing(await run());
    const hit = f.find((n) => n.startsWith('monorepo-constraints:cross-app:'));
    assert.ok(hit, f.join());
  });

  it('POSITIVE (rule 2): packages/* importing an app by name is an error', async () => {
    w('package.json', { workspaces: ['apps/*', 'packages/*'] });
    w('apps/api/package.json', { name: '@acme/api' });
    w('packages/core/package.json', { name: '@acme/core', dependencies: { '@acme/api': 'workspace:*' } });
    w('packages/core/src/index.ts', "import { boot } from '@acme/api';\n");
    const f = failing(await run());
    assert.ok(f.some((n) => n.startsWith('monorepo-constraints:pkg-imports-app:')), f.join());
  });

  it('members under examples/* and www are seen (trpc): an undeclared sibling import is a warning; declared is quiet', async () => {
    w('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'examples/*'\n  - 'www'\n");
    w('packages/server/package.json', { name: '@trpc/server' });
    w('www/package.json', { name: 'www' });
    w('www/src/page.tsx', "import { initTRPC } from '@trpc/server';\n");
    w('examples/minimal/package.json', { name: 'minimal', dependencies: { '@trpc/server': 'workspace:*' } });
    w('examples/minimal/src/index.ts', "import { initTRPC } from '@trpc/server';\n");
    const c = await run();
    const f = failing(c);
    const hit = f.find((n) => n.startsWith('monorepo-constraints:undeclared-workspace-dep:www/'));
    assert.ok(hit, f.join());
    assert.equal(c.find((x) => x.name === hit).severity, 'warning');
    assert.ok(!f.some((n) => n.includes('examples/minimal')), `declared dep must be quiet: ${f.join()}`);
  });

  it('a relative import that walks into a sibling member (packages/**, prisma) is a warning; an intra-package relative import is not', async () => {
    w('pnpm-workspace.yaml', 'packages:\n  - packages/**\n');
    w('packages/client/package.json', { name: '@prisma/client' });
    w('packages/adapters/pg/package.json', { name: '@prisma/adapter-pg' });
    w('packages/adapters/pg/src/index.ts', "import { Driver } from '../../../client/src/runtime/driver';\nimport { local } from './local';\n");
    const c = await run();
    const f = failing(c);
    const hit = f.find((n) => n.startsWith('monorepo-constraints:relative-cross-package:packages/adapters/pg/'));
    assert.ok(hit, f.join());
    assert.equal(c.find((x) => x.name === hit).severity, 'warning');
    assert.equal(f.filter((n) => n.includes('./local')).length, 0);
  });

  it('an undeclared `import type` is quiet (erased at runtime — apollo-server plugin-response-cache); the same value import warns', async () => {
    w('package.json', { workspaces: ['packages/*'] });
    w('packages/types/package.json', { name: '@apollo/cache-control-types' });
    w('packages/plugin/package.json', { name: '@apollo/plugin' });
    w('packages/plugin/src/a.ts', "import type { CacheHint } from '@apollo/cache-control-types';\n");
    assert.deepEqual(failing(await run()), []);
    w('packages/plugin/src/a.ts', "import { CacheHint } from '@apollo/cache-control-types';\n");
    assert.ok(failing(await run()).some((n) => n.startsWith('monorepo-constraints:undeclared-workspace-dep:')));
  });

  it('NEGATIVE: a clean workspace reports clean; `// monorepo-ok` suppresses; test files are exempt from rules 3–4', async () => {
    w('package.json', { workspaces: ['packages/*'] });
    w('packages/a/package.json', { name: '@acme/a', dependencies: { '@acme/b': '*' } });
    w('packages/b/package.json', { name: '@acme/b' });
    w('packages/a/src/index.ts', "import { b } from '@acme/b';\nimport { raw } from '../../b/src/raw'; // monorepo-ok\n");
    w('packages/a/src/__tests__/a.test.ts', "import { raw } from '../../../b/src/raw';\n");
    const c = await run();
    assert.deepEqual(failing(c), []);
    assert.ok(c.some((x) => x.name === 'monorepo-constraints:clean' && /2 packages/.test(x.message)));
  });
});
