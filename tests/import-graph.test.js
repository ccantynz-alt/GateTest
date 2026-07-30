/**
 * Import graph — the shared dependency spine.
 *
 * This logic was extracted from src/modules/import-cycle.js so structural
 * analysis could share ONE definition of "what depends on what". The extraction
 * was verified against the live module on 1191 real files (930 static edges,
 * byte-identical), but a one-off measurement is not a guard. These tests are the
 * guard: they pin BOTH the edge classification and the property import-cycle
 * depends on — that `staticGraph` contains only cycle-forming edges.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildImportGraph, collectSourceFiles, reverseGraph, tarjanSCC, stripLineComment, isTopLevel,
} = require('../src/core/import-graph');

let ROOT;

/** Write a fixture tree; keys are relative paths. */
function writeTree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
}

before(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-import-graph-'));
  writeTree(ROOT, {
    // static: top-level import + require + export-from
    'a.js': "import b from './b';\nconst c = require('./c');\n",
    'b.js': "export { x } from './c';\n",
    'c.js': 'module.exports = {};\n',
    // lazy: require inside a function, and a dynamic import
    'lazy.js': "function f() {\n  const c = require('./c');\n  return c;\n}\nasync function g() { await import('./b'); }\n",
    // type-only: erased at build time
    'types.ts': "import type { T } from './c';\nexport type U = T;\n",
    // external packages are not our graph
    'ext.js': "const react = require('react');\nimport fs from 'node:fs';\n",
    // extension + index resolution
    'dir/index.js': 'module.exports = 1;\n',
    'uses-dir.js': "const d = require('./dir');\n",
    'uses-ts.js': "import t from './types';\n",
    // suppression marker
    'suppressed.js': "const c = require('./c'); // import-cycle-ok\n",
    // a real 2-node cycle
    'cyc1.js': "const two = require('./cyc2');\n",
    'cyc2.js': "const one = require('./cyc1');\n",
    // must be ignored entirely
    'node_modules/pkg/index.js': "require('./other');\n",
    'notes.md': 'not source\n',
  });
});

after(() => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } // error-ok
});

const relOf = (g, p) => g.rel(p);

function edgesFrom(g, relPath) {
  const abs = path.join(ROOT, relPath);
  return g.edges.filter((e) => e.from === abs).map((e) => ({ to: g.rel(e.to), kind: e.kind }));
}

describe('collectSourceFiles', () => {
  it('finds JS/TS sources and skips node_modules and non-source files', () => {
    const files = collectSourceFiles(ROOT).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    assert.ok(files.includes('a.js'));
    assert.ok(files.includes('types.ts'));
    assert.ok(!files.some((f) => f.includes('node_modules')), 'node_modules must be excluded');
    assert.ok(!files.includes('notes.md'), 'non-source extensions must be excluded');
  });
});

describe('edge classification', () => {
  let g;
  before(() => { g = buildImportGraph({ projectRoot: ROOT }); });

  it('classifies top-level import and require as static', () => {
    const e = edgesFrom(g, 'a.js');
    assert.deepStrictEqual(
      e.sort((x, y) => (x.to < y.to ? -1 : 1)),
      [{ to: 'b.js', kind: 'static' }, { to: 'c.js', kind: 'static' }],
    );
  });

  it('classifies export-from as static', () => {
    assert.deepStrictEqual(edgesFrom(g, 'b.js'), [{ to: 'c.js', kind: 'static' }]);
  });

  it('classifies in-function require and dynamic import as lazy', () => {
    const kinds = edgesFrom(g, 'lazy.js');
    assert.strictEqual(kinds.length, 2);
    assert.ok(kinds.every((k) => k.kind === 'lazy'), `expected all lazy, got ${JSON.stringify(kinds)}`);
  });

  it('classifies import type as type', () => {
    assert.deepStrictEqual(edgesFrom(g, 'types.ts'), [{ to: 'c.js', kind: 'type' }]);
  });

  it('records no edge for bare package specifiers', () => {
    assert.deepStrictEqual(edgesFrom(g, 'ext.js'), []);
  });

  it('honours the import-cycle-ok suppression marker', () => {
    assert.deepStrictEqual(edgesFrom(g, 'suppressed.js'), []);
  });

  it('carries a 1-based line number for every edge', () => {
    const e = g.edges.find((x) => x.from === path.join(ROOT, 'b.js'));
    assert.strictEqual(e.line, 1);
    const lazyDyn = g.edges.filter((x) => x.from === path.join(ROOT, 'lazy.js'));
    assert.ok(lazyDyn.every((x) => x.line >= 1), 'line numbers must be 1-based');
  });
});

describe('specifier resolution', () => {
  let g;
  before(() => { g = buildImportGraph({ projectRoot: ROOT }); });

  it('resolves a directory to its index file', () => {
    assert.deepStrictEqual(edgesFrom(g, 'uses-dir.js'), [{ to: 'dir/index.js', kind: 'static' }]);
  });

  it('resolves an extensionless specifier by retrying extensions', () => {
    assert.deepStrictEqual(edgesFrom(g, 'uses-ts.js'), [{ to: 'types.ts', kind: 'static' }]);
  });
});

describe('staticGraph is exactly the cycle-forming view', () => {
  let g;
  before(() => { g = buildImportGraph({ projectRoot: ROOT }); });

  it('excludes lazy edges — import-cycle depends on this', () => {
    const lazyAbs = path.join(ROOT, 'lazy.js');
    assert.strictEqual(g.staticGraph.get(lazyAbs).size, 0,
      'a deferred require does not form a runtime cycle');
    assert.strictEqual(g.fullGraph.get(lazyAbs).size, 2,
      'but it IS real coupling, so the full view keeps it');
  });

  it('excludes type-only edges, which are erased at build time', () => {
    const typesAbs = path.join(ROOT, 'types.ts');
    assert.strictEqual(g.staticGraph.get(typesAbs).size, 0);
    assert.strictEqual(g.fullGraph.get(typesAbs).size, 1);
  });

  it('counts staticEdgeCount over the static view only', () => {
    let manual = 0;
    for (const s of g.staticGraph.values()) manual += s.size;
    assert.strictEqual(g.staticEdgeCount, manual);
    assert.ok(g.staticEdgeCount < g.edges.length,
      'the fixture has lazy/type edges, so static must be the smaller number');
  });
});

describe('tarjanSCC', () => {
  it('finds the planted 2-file cycle in the static view', () => {
    const g = buildImportGraph({ projectRoot: ROOT });
    const multi = tarjanSCC(g.staticGraph).filter((s) => s.length >= 2);
    assert.strictEqual(multi.length, 1, 'exactly one cycle in the fixture');
    const rels = multi[0].map((a) => g.rel(a)).sort();
    assert.deepStrictEqual(rels, ['cyc1.js', 'cyc2.js']);
  });

  it('returns one singleton SCC per node in an acyclic graph', () => {
    const graph = new Map([['a', new Set(['b'])], ['b', new Set(['c'])], ['c', new Set()]]);
    const sccs = tarjanSCC(graph);
    assert.strictEqual(sccs.length, 3);
    assert.ok(sccs.every((s) => s.length === 1));
  });

  it('survives a deep chain without blowing the stack (it is iterative)', () => {
    const graph = new Map();
    const N = 20000;
    for (let i = 0; i < N; i += 1) graph.set(`n${i}`, new Set(i + 1 < N ? [`n${i + 1}`] : []));
    assert.strictEqual(tarjanSCC(graph).length, N);
  });
});

describe('reverseGraph', () => {
  it('inverts direction so dependents can be counted', () => {
    const graph = new Map([['a', new Set(['c'])], ['b', new Set(['c'])], ['c', new Set()]]);
    const rev = reverseGraph(graph);
    assert.deepStrictEqual([...rev.get('c')].sort(), ['a', 'b']);
    assert.strictEqual(rev.get('a').size, 0);
  });
});

describe('stripLineComment', () => {
  it('removes a trailing comment', () => {
    assert.strictEqual(stripLineComment("const a = 1; // note"), 'const a = 1; ');
  });

  it('leaves a // that is inside a string literal — a URL is not a comment', () => {
    const line = "const u = 'https://example.com/x';";
    assert.strictEqual(stripLineComment(line), line);
  });

  it('respects an escaped quote rather than ending the string early', () => {
    const line = "const s = 'it\\'s // fine';";
    assert.strictEqual(stripLineComment(line), line);
  });
});

describe('isTopLevel', () => {
  it('treats zero indentation as module scope', () => {
    assert.strictEqual(isTopLevel("const x = require('./y');"), true);
    assert.strictEqual(isTopLevel("  const x = require('./y');"), false);
    assert.strictEqual(isTopLevel(''), false);
  });
});
