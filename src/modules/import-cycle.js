/**
 * Import-Cycle / Circular-Dependency Detector Module.
 *
 * Circular imports are the silent killer of large JS/TS codebases.
 * They don't crash at build time (webpack/esbuild/Next.js all
 * tolerate them with varying degrees of correctness), but at
 * runtime one of the two modules wins the race and the other gets
 * an `undefined` for the symbol it imported. The bug reproduces
 * randomly — test order, hot-reload state, module-cache warmth —
 * and the fix is always a refactor because you can't patch a
 * circular dependency without breaking the cycle.
 *
 * Why this matters more than ever:
 *
 *   - Next.js 16 App Router splits server/client boundaries; a
 *     cycle that was fine in v12 now yields "Cannot read property
 *     of undefined" on the server-rendered side.
 *   - ES modules are strictly live bindings. A cycle that CJS
 *     would silently paper over (via the mutable `module.exports`
 *     object) becomes a TDZ error under ESM.
 *   - TypeScript `isolatedModules` + `--verbatimModuleSyntax`
 *     turn a cycle into a hard error if any type is re-exported.
 *
 * We build an import graph from JS/TS source files, run Tarjan's
 * SCC algorithm to find every strongly-connected component of size
 * ≥ 2 (= a cycle), and report one error per distinct cycle. Single-
 * node self-loops (file imports itself) are also flagged because
 * they're always bugs.
 *
 * Design choices:
 *
 *   - Type-only imports (`import type { X } from`, `import { type X }`)
 *     are erased at build time. They don't create runtime cycles.
 *     Skipped.
 *
 *   - Function-scoped `require(...)` / dynamic `import(...)` expressions
 *     are LAZY. They defer resolution to call time, which is the
 *     standard workaround for breaking a cycle. Skipped.
 *
 *   - Only relative imports (`./`, `../`) form cycles. Bare-package
 *     imports (`react`, `lodash`) are external and skipped.
 *
 *   - Resolved to real files via `path.resolve` + extension-retry
 *     (`./x` → `./x.ts`, `./x.tsx`, `./x/index.ts`, etc.). If we
 *     can't resolve, we skip silently — don't false-positive on
 *     path-alias configs (`@/components/x`) that we can't read
 *     without a tsconfig parse.
 *
 * Rules:
 *
 *   error:   runtime cycle of 2+ files. One error per distinct SCC.
 *            (rule: `import-cycle:cycle:<a>|<b>|...|<a>`)
 *
 *   error:   file imports itself (self-loop).
 *            (rule: `import-cycle:self-loop:<rel>`)
 *
 *   info:    summary — number of files, edges, cycles.
 *            (rule: `import-cycle:summary`)
 *
 * Suppressions:
 *   - `// import-cycle-ok` on the import line (tells us this
 *     specific edge is expected and can be ignored for cycle-
 *     formation).
 *   - Test / spec / fixture paths downgrade error → warning.
 *
 * Competitors:
 *   - `madge --circular` (standalone CLI, separate install, no
 *     gate integration).
 *   - `eslint-plugin-import/no-cycle` (opt-in, needs per-project
 *     config, slow, and doesn't handle TS path aliases out of the
 *     box).
 *   - `dependency-cruiser` (heavy config, enterprise-pitch).
 *   - TypeScript itself catches NOTHING — tsc happily compiles
 *     circular modules.
 *   - Nothing unifies JS + TS + cycle reporting + gate-native
 *     enforcement + suppression markers at one call site.
 *
 * TODO(gluecron): host-neutral — pure static scan.
 */

const BaseModule = require('./base-module');
const path = require('path');
// The graph builder was extracted to src/core so structural analysis could share
// ONE definition of "what depends on what" — see the note at the top of that
// file. `staticGraph` is exactly the graph this module used to build privately;
// tests/import-graph.test.js pins that equivalence.
const { collectSourceFiles, buildImportGraph, tarjanSCC } = require('../core/import-graph');

class ImportCycleModule extends BaseModule {
  constructor() {
    super('importCycle', 'Import-cycle detector — catches circular dependencies that cause runtime TDZ / undefined-import bugs');
  }

  async run(result, config) {
    const projectRoot = (config && config.projectRoot) || process.cwd();
    const files = collectSourceFiles(projectRoot);

    if (files.length === 0) {
      result.addCheck('import-cycle:no-files', true, {
        severity: 'info',
        message: 'No source files to scan',
      });
      return;
    }

    result.addCheck('import-cycle:scanning', true, {
      severity: 'info',
      message: `Scanning ${files.length} file(s)`,
      fileCount: files.length,
    });

    // Only STATIC edges form runtime cycles: a function-scoped require defers
    // to call time (the standard cycle workaround) and a type-only import is
    // erased at build time. The shared builder also records those as 'lazy' and
    // 'type' edges, which spineHealth uses for coupling — deliberately not here.
    const { staticGraph: graph, staticEdgeCount: edgeCount } = buildImportGraph({ projectRoot, files });

    // SCCs via iterative Tarjan — iterative so a deep chain can't blow the stack.
    const sccs = tarjanSCC(graph);

    // A cycle = SCC with 2+ nodes, OR a single-node SCC that has
    // an edge to itself.
    const cycles = [];
    const selfLoops = [];
    for (const scc of sccs) {
      if (scc.length >= 2) {
        cycles.push(scc);
      } else if (scc.length === 1) {
        const n = scc[0];
        if (graph.get(n)?.has(n)) selfLoops.push(n);
      }
    }

    // Report self-loops
    for (const abs of selfLoops) {
      const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
      const isTest = this._isTestPath(rel);
      result.addCheck(`import-cycle:self-loop:${rel}`, false, {
        severity: isTest ? 'warning' : 'error',
        message: `${rel} imports itself — runtime undefined import`,
        file: rel,
      });
    }

    // Report cycles. Rotate each cycle to start at the lexicographically
    // smallest member for a stable rule name, and include a closing
    // repeat for human readability.
    for (const scc of cycles) {
      const ordered = this._orderCycle(scc, graph, projectRoot);
      const rels = ordered.map((a) => path.relative(projectRoot, a).replace(/\\/g, '/'));
      const isTest = rels.some((r) => this._isTestPath(r));
      const display = [...rels, rels[0]].join(' -> ');
      const ruleKey = rels.join('|');
      result.addCheck(`import-cycle:cycle:${ruleKey}`, false, {
        severity: isTest ? 'warning' : 'error',
        message: `Import cycle (${rels.length} files): ${display}`,
        files: rels,
      });
    }

    result.addCheck('import-cycle:summary', true, {
      severity: 'info',
      message: `${files.length} file(s) scanned, ${edgeCount} edge(s), ${cycles.length} cycle(s), ${selfLoops.length} self-loop(s)`,
      fileCount: files.length,
      edgeCount,
      cycleCount: cycles.length,
      selfLoopCount: selfLoops.length,
    });
  }

  /**
   * Rotate the cycle so it starts at the lexicographically smallest
   * member (stable key for the rule name). Also try to order around
   * the actual cycle direction using the graph edges.
   */
  _orderCycle(scc, graph, projectRoot) {
    const rels = scc.map((a) => ({ abs: a, rel: path.relative(projectRoot, a).replace(/\\/g, '/') }));
    rels.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    const start = rels[0].abs;

    // Walk edges to produce a traversal order from `start`
    const visited = new Set([start]);
    const order = [start];
    const sccSet = new Set(scc);
    let cur = start;
    while (order.length < scc.length) {
      const outs = graph.get(cur) || new Set();
      let picked = null;
      for (const n of outs) {
        if (sccSet.has(n) && !visited.has(n)) {
          picked = n;
          break;
        }
      }
      if (!picked) {
        // Fallback — append any remaining node
        for (const r of rels) {
          if (!visited.has(r.abs)) { picked = r.abs; break; }
        }
      }
      if (!picked) break;
      visited.add(picked);
      order.push(picked);
      cur = picked;
    }
    return order;
  }
}

module.exports = ImportCycleModule;
