'use strict';
/**
 * Import graph — the shared dependency spine of a JS/TS codebase.
 *
 * This logic lived privately inside `src/modules/import-cycle.js`, which used
 * it for exactly one question ("is there a cycle?") and then threw it away.
 * Extracting it is deliberate: KI #77 recorded that copy-pasting `TEST_PATH_RE`
 * into 20 modules institutionalised an anti-pattern and produced a real
 * cross-platform bug, because whether a path counted as test code depended on
 * which module you asked. A second hand-rolled import resolver would be that
 * mistake again, with worse consequences — two modules disagreeing about what
 * depends on what.
 *
 * ── Edge KINDS matter, and this is the substantive addition ──────────────────
 * import-cycle deliberately ignores lazy and type-only imports, and it is right
 * to: a function-scoped `require()` defers to call time and does not form a
 * runtime cycle, and a type-only import is erased at build time.
 *
 * But those edges are still real COUPLING. A file that lazily requires forty
 * modules is coupled to forty modules; you cannot move it without moving them.
 * So the graph records all three kinds and lets each caller choose:
 *
 *   'static' — top-level runtime import/require. Forms cycles.
 *   'lazy'   — function-scoped require / dynamic import(). Coupling, not a cycle.
 *   'type'   — type-only import/export. Compile-time coupling only.
 *
 * `staticGraph` is exactly what import-cycle used to build for itself, so its
 * findings are unchanged by the extraction (asserted in tests/import-graph.test.js).
 * `fullGraph` is the coupling view that structural analysis needs.
 */

const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.claude', 'dist', 'build', 'coverage', '.gatetest',
  '.next', 'out', 'target', 'vendor', '.terraform', '__pycache__',
]);

const JS_EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const JS_EXT_SET = new Set(JS_EXTS);

/** Per-file byte ceiling. A 2 MB "source" file is generated or vendored. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SUPPRESS_RE = /\bimport-cycle-ok\b/;

// Line-level and deliberately conservative: a missed edge understates coupling,
// a wrong edge invents a dependency that does not exist. Understating is the
// safer failure for a module that reports on architecture.
const IMPORT_FROM_RE = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/;
const IMPORT_TYPE_RE = /^\s*import\s+type\b/;
const EXPORT_FROM_RE = /^\s*export\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/;
const EXPORT_TYPE_RE = /^\s*export\s+type\b/;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/;

/**
 * Walk a project root and return every JS/TS source file (absolute paths).
 * @param {string} root
 * @returns {string[]}
 */
function collectSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // error-ok — unreadable dir is skipped, never fatal
    }
    for (const e of entries) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && JS_EXT_SET.has(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/** Strip a `//` line comment that is not inside a string literal. */
function stripLineComment(line) {
  let inStr = null;
  for (let j = 0; j < line.length; j += 1) {
    const ch = line[j];
    if (inStr) {
      if (ch === '\\') { j += 1; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && line[j + 1] === '/') return line.slice(0, j);
  }
  return line;
}

/**
 * Zero indentation means module scope. Imperfect, but it catches the case that
 * matters — an ambient `const x = require('./y')` that forms a real cycle —
 * without misreading a lazy in-function require as static.
 */
function isTopLevel(line) {
  if (!line) return false;
  const m = line.match(/^(\s*)/);
  return !!m && m[1].length === 0;
}

/**
 * Resolve a relative specifier to a file that exists in `fileSet`.
 * Returns null when unresolvable — a path alias we cannot read without parsing
 * tsconfig, for instance. Silence beats inventing an edge.
 */
function resolveImport(dir, spec, fileSet) {
  const base = path.resolve(dir, spec);
  if (fileSet.has(base)) return base;
  for (const ext of JS_EXTS) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  for (const ext of JS_EXTS) {
    const cand = path.join(base, 'index' + ext);
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

/**
 * Extract every outgoing edge from one file, tagged by kind.
 * @returns {Array<{to: string, kind: 'static'|'lazy'|'type', line: number}>}
 */
function edgesForFile(absPath, fileSet) {
  const out = [];
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf-8');
  } catch {
    return out; // error-ok
  }
  if (text.length > MAX_FILE_BYTES) return out;

  const lines = text.split(/\r?\n/);
  const dir = path.dirname(absPath);
  const seen = new Set(); // dedupe identical to+kind pairs per file

  const push = (spec, kind, lineNo) => {
    if (!isRelative(spec)) return; // bare package -> external, not our graph
    const to = resolveImport(dir, spec, fileSet);
    if (!to) return;
    const key = `${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to, kind, line: lineNo });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    // The suppression marker is an import-cycle concept, but honouring it here
    // keeps the extracted staticGraph byte-identical to the old private one.
    if (SUPPRESS_RE.test(raw)) continue;

    const line = stripLineComment(raw);
    const typeOnly = IMPORT_TYPE_RE.test(line) || EXPORT_TYPE_RE.test(line);

    const mImp = IMPORT_FROM_RE.exec(line);
    if (mImp) { push(mImp[1], typeOnly ? 'type' : 'static', lineNo); continue; }

    const mExp = EXPORT_FROM_RE.exec(line);
    if (mExp) { push(mExp[1], typeOnly ? 'type' : 'static', lineNo); continue; }

    const mReq = REQUIRE_RE.exec(line);
    if (mReq) {
      push(mReq[1], isTopLevel(raw) ? 'static' : 'lazy', lineNo);
      continue;
    }

    // `await import('./x')` is lazy wherever it appears.
    const mDyn = DYNAMIC_IMPORT_RE.exec(line);
    if (mDyn) push(mDyn[1], 'lazy', lineNo);
  }

  return out;
}

/**
 * Build the import graph for a project.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string[]} [opts.files] pre-collected absolute paths (tests inject these)
 * @returns {{
 *   files: string[],
 *   fileSet: Set<string>,
 *   staticGraph: Map<string, Set<string>>,
 *   fullGraph: Map<string, Set<string>>,
 *   edges: Array<{from: string, to: string, kind: string, line: number}>,
 *   staticEdgeCount: number,
 *   rel: (abs: string) => string,
 * }}
 */
function buildImportGraph(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const files = opts.files || collectSourceFiles(projectRoot);
  const fileSet = new Set(files);

  const staticGraph = new Map();
  const fullGraph = new Map();
  const edges = [];
  let staticEdgeCount = 0;

  for (const abs of files) {
    const statics = new Set();
    const all = new Set();
    for (const e of edgesForFile(abs, fileSet)) {
      edges.push({ from: abs, to: e.to, kind: e.kind, line: e.line });
      all.add(e.to);
      if (e.kind === 'static') statics.add(e.to);
    }
    staticGraph.set(abs, statics);
    fullGraph.set(abs, all);
    staticEdgeCount += statics.size;
  }

  const rel = (abs) => path.relative(projectRoot, abs).split(path.sep).join('/');

  return { files, fileSet, staticGraph, fullGraph, edges, staticEdgeCount, rel };
}

/**
 * Reverse a graph: who depends on me, rather than who I depend on.
 * @param {Map<string, Set<string>>} graph
 * @returns {Map<string, Set<string>>}
 */
function reverseGraph(graph) {
  const rev = new Map();
  for (const n of graph.keys()) rev.set(n, new Set());
  for (const [from, tos] of graph) {
    for (const to of tos) {
      if (!rev.has(to)) rev.set(to, new Set());
      rev.get(to).add(from);
    }
  }
  return rev;
}

/**
 * Iterative Tarjan strongly-connected components. Iterative rather than
 * recursive so a deep dependency chain cannot blow the JS stack.
 *
 * @param {Map<string, Set<string>>} graph
 * @returns {string[][]} one array per SCC
 */
function tarjanSCC(graph) {
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let idx = 0;

  const run = (startNode) => {
    const work = [{ node: startNode, iter: graph.get(startNode).values(), state: 'enter' }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;

      if (frame.state === 'enter') {
        index.set(node, idx);
        lowlink.set(node, idx);
        idx += 1;
        stack.push(node);
        onStack.add(node);
        frame.state = 'iter';
      }

      let descended = false;
      for (;;) {
        const next = frame.iter.next();
        if (next.done) break;
        const w = next.value;
        if (!graph.has(w)) continue; // external / unresolved
        if (!index.has(w)) {
          work.push({ node: w, iter: graph.get(w).values(), state: 'enter' });
          descended = true;
          break;
        }
        if (onStack.has(w)) {
          lowlink.set(node, Math.min(lowlink.get(node), index.get(w)));
        }
      }
      if (descended) continue;

      if (lowlink.get(node) === index.get(node)) {
        const scc = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          scc.push(w);
          if (w === node) break;
        }
        sccs.push(scc);
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(node)));
      }
    }
  };

  for (const n of graph.keys()) {
    if (!index.has(n)) run(n);
  }
  return sccs;
}

/**
 * Transitive closure size per node — the count of nodes reachable FROM each
 * node in `graph`. Run it on a reversed graph and you get blast radius: how
 * many files a change to this one can reach.
 *
 * Memoised over SCC-free traversal order is not safe in a cyclic graph, so this
 * does a plain BFS per node. O(V*E) worst case, which is why `maxNodes` exists:
 * on a 20k-file monorepo the honest answer is "skip", not "hang the gate".
 *
 * @param {Map<string, Set<string>>} graph
 * @param {number} [maxNodes]
 * @returns {Map<string, number>|null} null when the graph is over budget
 */
function reachableCounts(graph, maxNodes = 5000) {
  if (graph.size > maxNodes) return null;
  const counts = new Map();
  for (const start of graph.keys()) {
    const seen = new Set();
    const queue = [start];
    while (queue.length > 0) {
      const n = queue.pop();
      for (const w of graph.get(n) || []) {
        if (w === start || seen.has(w)) continue;
        seen.add(w);
        queue.push(w);
      }
    }
    counts.set(start, seen.size);
  }
  return counts;
}

module.exports = {
  EXCLUDE_DIRS,
  JS_EXTS,
  MAX_FILE_BYTES,
  collectSourceFiles,
  buildImportGraph,
  reverseGraph,
  tarjanSCC,
  reachableCounts,
  resolveImport,
  stripLineComment,
  isTopLevel,
  edgesForFile,
};
