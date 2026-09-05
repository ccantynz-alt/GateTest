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
 *   'static'    — top-level runtime import/require, resolved directly. Forms cycles.
 *   'ts-esm'    — the same, resolved by the `.js`-for-`.ts` swap (TypeScript NodeNext).
 *   'multiline' — the same, written across lines. (Kept as its own kind so the
 *                 pre-elision `staticGraph` stays what the equivalence tests pinned.)
 *   'lazy'      — function-scoped require / dynamic import(). Coupling, not a cycle.
 *   'type'      — `import type`, `export type … from`, OR a plain import whose
 *                 every binding is used only in type positions — elided by tsc
 *                 (src/core/import-elision.js). Compile-time coupling only.
 *   'alias' / 'workspace' / 'path-literal' — resolved through tsconfig paths, a
 *                 workspace package, or a bare path string. Coupling; not yet cycles.
 *
 * Runtime import edges also carry `use`: 'load' (read at module evaluation) or
 * 'deferred' (read only inside function bodies / instance initialisers /
 * parameter defaults — the ESM shape of a lazy require), and `via` says how
 * the specifier resolved.
 *
 * Views: `staticGraph` (kind 'static' only — the pre-elision cycle view the
 * extraction tests pinned), `runtimeGraph` (static + ts-esm + multiline, post-
 * elision), `loadGraph` (runtimeGraph minus deferred edges — what import-cycle
 * blocks on), `fullGraph` (every kind — the coupling view structural analysis needs).
 */

const fs = require('fs');
const path = require('path');
const { workspacePackageMap } = require('./workspaces');
const { resolveAlias, resolvePackageEntry, resolvePackageSubpath, tsEquivalents, elisionMode } = require('./module-resolution');
const { readImports } = require('./ts-tokens');
const { classifyUses, statementUses } = require('./import-elision');

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
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/;
// import / export-from statements are read WHOLE by ./ts-tokens (multi-line,
// inline `type` modifiers) and classified by ./import-elision; only require(),
// dynamic import() and path strings are still read line by line here.
const TS_EXT_SET = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JSX_EXT_SET = new Set(['.tsx', '.jsx']);
// The kinds import-cycle sees: every import statement the emitted JavaScript
// still executes, however its specifier was resolved.
const RUNTIME_KINDS = new Set(['static', 'ts-esm', 'multiline']);
// A relative path written as a plain STRING, outside any import/require. This
// is how plugin registries, route tables and DI manifests reference code:
// `registry.js` maps every module as `accessibility: '../modules/accessibility.js'`.
// Treating those as non-edges made 115 live files look unreachable from
// production (KI #96 — measured on this repo before the pass was added).
// Global: one line can list several.
const PATH_LITERAL_RE = /['"`](\.\.?\/[A-Za-z0-9_\-./]+?\.(?:js|mjs|cjs|jsx|ts|tsx))['"`]/g;
// The same reference written from the project root — `path.join(ROOT,
// "src/core/x.js")`, a manifest listing "lib/y.js". No `./` prefix, at least
// one `/`, a JS extension, and it must resolve from the project root or it is
// just a string. KI #96 step 3: two files looked unreachable for this shape.
const ROOT_LITERAL_RE = /['"`]([A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)+\.(?:js|mjs|cjs|jsx|ts|tsx))['"`]/g;

function resolveWorkspace(spec, workspaces, fileSet) {
  for (const [name, dir] of workspaces) {
    if (spec !== name && !spec.startsWith(`${name}/`)) continue;
    const sub = spec === name ? null : spec.slice(name.length + 1);
    if (sub !== null) {
      const direct = resolveImport(dir, `./${sub}`, fileSet) || resolveImportTsEsm(dir, `./${sub}`, fileSet);
      if (direct) return direct;
      const viaExports = resolvePackageSubpath(dir, sub);
      return viaExports && fileSet.has(viaExports) ? viaExports : null;
    }
    const entry = resolvePackageEntry(dir, JS_EXTS);
    return entry && fileSet.has(entry) ? entry : null;
  }
  return null;
}

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

/**
 * `./x.js` written for a `x.ts` on disk (TypeScript NodeNext / ESM). Kept
 * apart from resolveImport on purpose: an edge found only this way is
 * recorded as kind 'ts-esm', outside staticGraph. Letting it into the static
 * set surfaced 15 import-cycle findings on nest and 2 on apollo-server in
 * one corpus run — real cycles through barrel files and `.interface.ts`
 * imports that TypeScript elides at compile time, which import-cycle cannot
 * yet tell from runtime ones. Reachability needs the edge; the cycle rule
 * needs the elision work first (KI #96 follow-up).
 */
function resolveImportTsEsm(dir, spec, fileSet) {
  const base = path.resolve(dir, spec);
  for (const cand of tsEquivalents(base)) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

function isRelative(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

/**
 * Resolve one specifier from `dir`; returns [absPath, resolutionKind] or null.
 * The resolution kind says HOW the edge was found (direct / `.js`-for-`.ts`
 * swap / tsconfig alias / workspace package) — the caller decides what it
 * means for the graph.
 */
function resolveSpec(dir, absPath, spec, fileSet, ctx) {
  if (isRelative(spec)) {
    const to = resolveImport(dir, spec, fileSet);
    if (to) return [to, 'static'];
    const swapped = resolveImportTsEsm(dir, spec, fileSet);
    return swapped ? [swapped, 'ts-esm'] : null;
  }
  // A bare specifier is external unless a path alias or a workspace package
  // of THIS project names it. Those edges are real coupling but never enter
  // the cycle views (kinds 'alias' / 'workspace') — the conservative half of
  // KI #96; cycles through aliases are their own corpus-validated change.
  if (!ctx.projectRoot) return null;
  const bases = resolveAlias(absPath, spec, ctx.projectRoot);
  const viaAlias = bases
    ? bases.map((b) => resolveImport(path.dirname(b), `./${path.basename(b)}`, fileSet) || resolveImportTsEsm(path.dirname(b), `./${path.basename(b)}`, fileSet)).find(Boolean)
    : null;
  if (viaAlias) return [viaAlias, 'alias'];
  const viaWs = ctx.workspaces && ctx.workspaces.size ? resolveWorkspace(spec, ctx.workspaces, fileSet) : null;
  return viaWs ? [viaWs, 'workspace'] : null;
}

/**
 * Read every import / export-from statement whole and decide what the emitted
 * JavaScript does with it. Returns the edges plus the set of source lines the
 * statements occupy (so the line reader below does not see them twice).
 */
function importStatementEdges(absPath, text, ctx, full) {
  // No import / export-from statement at a line start → nothing to read, and
  // no reason to tokenise (this repository is CommonJS: 1,341 files, most of
  // them `require` only — Doctrine §14).
  if (!IMPORT_STATEMENT_HINT_RE.test(text)) return { edges: [], consumedLines: EMPTY_SET, unchecked: null };
  const lines = text.split(/\r?\n/);
  const ext = path.extname(absPath).toLowerCase();
  const isTs = TS_EXT_SET.has(ext);
  const jsx = JSX_EXT_SET.has(ext);
  const { tokens, statements, consumed } = readImports(text);
  const kept = statements.filter((st) => {
    for (let l = st.line; l <= st.endLine; l += 1) if (SUPPRESS_RE.test(lines[l - 1] || '')) return false;
    return true;
  });
  const names = new Set();
  for (const st of kept) for (const b of st.bindings) if (!b.typeOnly) names.add(b.local);
  // A declaration file has no runtime at all: every import in a `.d.ts` is
  // type-level by definition, so there is nothing to scan (prisma: 348 files,
  // 6.8 MB of its 30 MB — Doctrine §14).
  const dts = /\.d\.[cm]?ts$/i.test(absPath);
  const mode = isTs && !jsx && !dts ? elisionMode(path.dirname(absPath), ctx.projectRoot) : { elide: false };
  // JSX is NOT checked: its text can hold an apostrophe or a brace that a
  // character-level stripper reads as syntax, and a scanner that can be
  // knocked off course by prose would elide edges it should keep. A .tsx
  // import is therefore what it always was — kept, load-time — and the
  // file is reported as unchecked (Doctrine §6). Measured against tsc on the
  // corpus: every remaining disagreement in the dangerous direction was .tsx.
  //
  // The use-scan runs only when asked (`full`): elision can only REMOVE
  // edges, so a file outside every cycle of the unscanned graph cannot be in
  // one after scanning — buildImportGraph scans just the files inside a
  // strongly connected component. Without the scan a statement whose bindings
  // are values is provisionally load-time and the file is marked `pending`.
  let useOf;
  let pending = false;
  if (dts) useOf = kept.map(() => 'type');
  else if (jsx) useOf = kept.map((st) => (st.typeOnly ? 'type' : 'load'));
  else if (full) useOf = statementUses(kept, classifyUses(tokens, consumed, names, {}), mode);
  else {
    useOf = provisionalUses(kept, mode);
    pending = useOf.includes('pending');
  }
  const edges = [];
  kept.forEach((st, i) => {
    const use = useOf[i] === 'pending' ? 'load' : useOf[i];
    const multiline = st.endLine !== st.line;
    edges.push({ spec: st.spec, line: st.line, use, kind: use === 'type' ? 'type' : (multiline ? 'multiline' : null) });
  });
  const consumedLines = new Set();
  for (const st of statements) for (let l = st.line; l <= st.endLine; l += 1) consumedLines.add(l);
  return { edges, consumedLines, unchecked: jsx && kept.length ? 'jsx' : null, pending };
}

/**
 * What can be decided about each statement WITHOUT scanning the file: an
 * explicit `import type`, a statement whose every binding carries an inline
 * `type`, a side-effect import, a re-export, a file whose tsconfig disables
 * elision. Anything else is 'pending' — provisionally load-time until the
 * scanner has looked, and only worth looking at inside a candidate cycle.
 */
function provisionalUses(statements, mode) {
  return statements.map((st) => {
    if (st.typeOnly) return 'type';
    if (st.form === 'side-effect' || st.form === 'export-from') return 'load';
    if (!mode.elide) return 'load';
    const valueBindings = st.bindings.filter((b) => !b.typeOnly);
    if (valueBindings.length === 0) return st.bindings.length ? 'type' : 'load';
    return 'pending';
  });
}

const IMPORT_STATEMENT_HINT_RE = /^\s*(?:import\s+[^(.]|export\s+(?:type\s+)?(?:\*|\{))/m;
const EMPTY_SET = new Set();

// One parse per file per process. Three quick-suite modules (importCycle,
// deadCode, spineHealth) each build the graph; the file has not changed
// between them. Keyed on size + mtime so a --watch rescan sees edits.
const fileEdgeCache = new Map();
const FILE_EDGE_CACHE_MAX = 50000;

/**
 * Extract every outgoing edge from one file, tagged by kind.
 * @returns {Array<{to: string, kind: string, line: number, via: 'static'|'ts-esm'|'alias'|'workspace', use?: 'load'|'deferred'}>}
 *   kind — what the edge MEANS (static / type / lazy / multiline / …); via — how the specifier RESOLVED.
 */
function edgesForFile(absPath, fileSet, ctx = {}, full = true) {
  let cacheKey = null;
  try {
    const st = fs.statSync(absPath);
    cacheKey = `${absPath}|${st.size}|${st.mtimeMs}|${ctx.projectRoot || ''}|${fileSet.size}|${full ? 'full' : 'cheap'}`;
    const hit = fileEdgeCache.get(cacheKey);
    if (hit) { const copy = hit.edges.map((e) => ({ ...e })); if (hit.unchecked) copy.unchecked = hit.unchecked; if (hit.pending) copy.pending = true; return copy; }
  } catch {
    cacheKey = null; // error-ok — unreadable stat, just don't cache
  }
  const out = edgesForFileUncached(absPath, fileSet, ctx, full);
  if (cacheKey) {
    if (fileEdgeCache.size >= FILE_EDGE_CACHE_MAX) fileEdgeCache.clear();
    fileEdgeCache.set(cacheKey, { edges: out.map((e) => ({ ...e })), unchecked: out.unchecked || null, pending: !!out.pending });
  }
  return out;
}

function edgesForFileUncached(absPath, fileSet, ctx, full = true) {
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

  const record = (to, kind, lineNo, use, via) => {
    const key = `${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const edge = { to, kind, line: lineNo, via };
    if (use) edge.use = use;
    out.push(edge);
  };
  // `kind` null means "whatever the resolution says"; a named kind (type,
  // multiline, lazy, path-literal) overrides it because it says something the
  // resolution does not — an `import type` through an alias is still elided.
  const push = (spec, kind, lineNo, use) => {
    const r = resolveSpec(dir, absPath, spec, fileSet, ctx);
    if (r) record(r[0], kind || r[1], lineNo, use, r[1]);
  };

  const { edges: stmtEdges, consumedLines, unchecked, pending } = importStatementEdges(absPath, text, ctx, full);
  for (const e of stmtEdges) push(e.spec, e.kind, e.line, e.use === 'type' ? undefined : e.use);
  if (unchecked) out.unchecked = unchecked;
  if (pending) out.pending = true;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (consumedLines.has(lineNo)) continue;
    // The suppression marker is an import-cycle concept, but honouring it here
    // keeps the extracted staticGraph byte-identical to the old private one.
    if (SUPPRESS_RE.test(raw)) continue;

    const line = stripLineComment(raw);

    const mReq = REQUIRE_RE.exec(line);
    if (mReq) {
      const top = isTopLevel(raw);
      push(mReq[1], top ? null : 'lazy', lineNo, top ? 'load' : undefined);
      continue;
    }

    // `await import('./x')` is lazy wherever it appears.
    const mDyn = DYNAMIC_IMPORT_RE.exec(line);
    if (mDyn) { push(mDyn[1], 'lazy', lineNo); continue; }

    // Dynamic-registry reference: a relative path string that resolves to a
    // real file in this project, with no import syntax around it. Only reached
    // for lines that produced no import/require/dynamic edge above, and only
    // recorded when the path RESOLVES — an unresolvable string is just a
    // string. This kind never enters the cycle views.
    PATH_LITERAL_RE.lastIndex = 0;
    let mLit = PATH_LITERAL_RE.exec(line);
    while (mLit !== null) {
      push(mLit[1], 'path-literal', lineNo);
      mLit = PATH_LITERAL_RE.exec(line);
    }
    if (ctx.projectRoot) {
      ROOT_LITERAL_RE.lastIndex = 0;
      let mRoot = ROOT_LITERAL_RE.exec(line);
      while (mRoot !== null) {
        const to = resolveImport(ctx.projectRoot, `./${mRoot[1]}`, fileSet);
        if (to && to !== absPath) record(to, 'path-literal', lineNo, undefined, 'static');
        mRoot = ROOT_LITERAL_RE.exec(line);
      }
    }
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
 *   staticGraph: Map<string, Set<string>>,   kind 'static' only — the pre-elision-era cycle view, kept for the equivalence tests
 *   runtimeGraph: Map<string, Set<string>>,  every import the emitted JS executes (static + ts-esm + multiline, post-elision)
 *   loadGraph: Map<string, Set<string>>,     runtimeGraph minus edges whose only value uses are deferred to call time
 *   fullGraph: Map<string, Set<string>>,
 *   edges: Array<{from: string, to: string, kind: string, line: number}>,
 *   staticEdgeCount: number,
 *   runtimeEdgeCount: number,
 *   unchecked: { jsx: string[] },              files whose imports were kept without elision analysis, by reason
 *   elision: { scanned: number, pending: number }, files the use-scan ran on (inside a candidate cycle) / files it never needed to
 *   rel: (abs: string) => string,
 * }}
 */
function buildImportGraph(opts = {}) {
  const projectRoot = opts.projectRoot || process.cwd();
  const files = opts.files || collectSourceFiles(projectRoot);
  const fileSet = new Set(files);

  const staticGraph = new Map();
  const runtimeGraph = new Map();
  const loadGraph = new Map();
  const fullGraph = new Map();
  const edges = [];
  let staticEdgeCount = 0;
  let runtimeEdgeCount = 0;
  const unchecked = { jsx: [] }; // files whose imports were kept unexamined, by reason
  const ctx = { projectRoot, workspaces: workspacePackageMap(projectRoot) };

  // Phase 1 — every file, no use-scan. Phase 2 — the use-scan, only for files
  // whose provisional (over-approximate) runtime edges put them inside a
  // strongly connected component: elision only removes edges, so a file that
  // is in no cycle now is in no cycle after scanning, and its provisional
  // labels are already right for every cycle view. prisma: 4,551 files, of
  // which a few dozen sit in a candidate cycle (Doctrine §14).
  const perFile = new Map();
  const provisional = new Map();
  for (const abs of files) {
    const fileEdges = edgesForFile(abs, fileSet, ctx, false);
    perFile.set(abs, fileEdges);
    provisional.set(abs, new Set(fileEdges.filter((e) => RUNTIME_KINDS.has(e.kind)).map((e) => e.to)));
  }
  const elision = { scanned: 0, pending: 0 };
  for (const scc of tarjanSCC(provisional)) {
    const cyclic = scc.length >= 2 || (provisional.get(scc[0]) || EMPTY_SET).has(scc[0]);
    if (!cyclic) continue;
    for (const abs of scc) {
      if (!perFile.get(abs).pending) continue;
      perFile.set(abs, edgesForFile(abs, fileSet, ctx, true));
      elision.scanned += 1;
    }
  }
  for (const fileEdges of perFile.values()) if (fileEdges.pending) elision.pending += 1;

  for (const abs of files) {
    const statics = new Set();
    const runtime = new Set();
    const load = new Set();
    const all = new Set();
    const fileEdges = perFile.get(abs);
    if (fileEdges.unchecked) unchecked[fileEdges.unchecked].push(abs);
    for (const e of fileEdges) {
      const edge = { from: abs, to: e.to, kind: e.kind, line: e.line, via: e.via };
      if (e.use) edge.use = e.use;
      edges.push(edge);
      all.add(e.to);
      if (e.kind === 'static') statics.add(e.to);
      if (RUNTIME_KINDS.has(e.kind)) {
        runtime.add(e.to);
        if (e.use !== 'deferred') load.add(e.to);
      }
    }
    staticGraph.set(abs, statics);
    runtimeGraph.set(abs, runtime);
    loadGraph.set(abs, load);
    fullGraph.set(abs, all);
    staticEdgeCount += statics.size;
    runtimeEdgeCount += runtime.size;
  }

  const rel = (abs) => path.relative(projectRoot, abs).split(path.sep).join('/');

  return { files, fileSet, staticGraph, runtimeGraph, loadGraph, fullGraph, edges, staticEdgeCount, runtimeEdgeCount, unchecked, elision, rel };
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
