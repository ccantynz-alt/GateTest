'use strict';
/**
 * Python imports — the one definition of what a Python specifier resolves to.
 *
 * Before this file existed, deadCode's orphan-file rule fed Python specifiers
 * (`.config`, `flask.helpers`) into the JS resolver, which cannot read a dotted
 * module path, so nearly every Python file in a package was "unreachable":
 * flask reported 10 orphans, every one imported by production code; django
 * reported 351 (KI #96, measured 2026-09-05). This resolver answers the
 * question the way the interpreter does:
 *
 *   - relative imports: `from .config import Config`, `from ..x import y`,
 *     `from . import helpers` — N leading dots climb N-1 directories from the
 *     importer's package; an imported NAME that is a sibling module file is an
 *     edge to that file, not only to the package `__init__`.
 *   - absolute imports are searched on the roots an interpreter would see:
 *     the project root, `src/` (src layout), and the parent of the importer's
 *     top-level package (walk up through `__init__.py` directories).
 *   - `import pkg.sub.mod`, `from pkg import mod` (module or package), and a
 *     package resolves to its `__init__.py`.
 *   - a dotted STRING LITERAL that names a real module is an edge of kind
 *     'path-literal' — INSTALLED_APPS, AUTH_USER_MODEL, `include('app.urls')`,
 *     `import_module('x.y')` all reference code this way. The whole string is
 *     tried first, then trailing segments are dropped until a module resolves;
 *     a string that resolves to nothing is NOT an edge (mirrors the JS
 *     registry-path-string rule in import-graph.js).
 *
 * Only files in `fileSet` (absolute, normalised, every `.py` in the scan) are
 * ever returned: the stdlib and site-packages are external, and silence beats
 * inventing an edge.
 */

const fs = require('fs');
const path = require('path');
const { MAX_FILE_BYTES } = require('./import-graph');

const PY_EXT = '.py';
const INIT = '__init__.py';

// Statement forms, applied to logical lines (continuations already joined).
// Leading whitespace is allowed on purpose: an import inside a function or a
// `try:` body is lazy, but it is still a reader of the module.
const FROM_RE = /^(\s*)from\s+(\.*)([\w.]*)\s+import\s+(.+?)\s*$/;
const IMPORT_RE = /^(\s*)import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*$/;
// A dotted identifier chain in a string literal: at least one dot, every
// segment an identifier, the same quote on both sides. `'1.2.3'` (segments
// start with digits), `'e.g.'` (trailing dot) and `'Hello. World'` (space)
// never match; `'os.path'` matches and then fails to resolve — not an edge.
// A format placeholder may close the chain — django's sitemaps build
// `"django.contrib.gis.sitemaps.views.%s"`; the prefix names the module.
const DOTTED_LITERAL_RE = /(['"])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)(?:\.(?:%s|%\(\w+\)s|\{[^}'"]*\}))?\1/g;
const IDENT_RE = /^[A-Za-z_]\w*$/;

/**
 * Join the two Python statement-continuation forms into single logical lines:
 * a backslash before the newline, and a parenthesised import list. (The same
 * joiner lives in dead-code-extractor.js `extractPyImports`; that copy should
 * import this one — KI #96 follow-up.)
 */
function logicalLines(content) {
  return content
    .replace(/\\\r?\n/g, ' ')
    .replace(/^([ \t]*(?:from[ \t]+[.\w]+[ \t]+)?import[ \t][^\n(]*)\(([^)]*)\)/gm,
      (whole, head, body) => head + body.replace(/#[^\r\n]*/g, '').replace(/[\r\n]+/g, ' '))
    .split(/\r?\n/);
}

/**
 * The directory a Python interpreter would have on sys.path for this file:
 * the first ancestor that is NOT a package (has no `__init__.py`). For a file
 * outside any package that is its own directory — the script directory.
 */
function packageRoot(fromFile, fileSet) {
  let dir = path.dirname(fromFile);
  while (fileSet.has(path.join(dir, INIT))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

/** `root/a/b.py` or `root/a/b/__init__.py`, whichever the scan holds. */
function moduleFile(root, segments, fileSet) {
  const base = path.join(root, ...segments);
  if (segments.length > 0 && fileSet.has(base + PY_EXT)) return base + PY_EXT;
  const init = path.join(base, INIT);
  return fileSet.has(init) ? init : null;
}

/**
 * @param {string} fromFile absolute path of the importer
 * @param {string} spec `.config`, `..helpers`, `.`, `flask.helpers`, `os.path`
 * @param {string} projectRoot
 * @param {Set<string>} fileSet absolute normalised paths of every .py in scope
 * @returns {string|null} absolute path of the module file, or null (external)
 */
function resolvePythonImport(fromFile, spec, projectRoot, fileSet) {
  if (typeof spec !== 'string' || spec.length === 0) return null;
  let dots = 0;
  while (spec[dots] === '.') dots += 1;
  const rest = spec.slice(dots);
  const segments = rest.length ? rest.split('.') : [];
  if (segments.some((s) => !IDENT_RE.test(s))) return null;

  if (dots > 0) {
    let dir = path.dirname(fromFile);
    for (let i = 1; i < dots; i += 1) dir = path.dirname(dir);
    return moduleFile(dir, segments, fileSet);
  }
  if (segments.length === 0) return null;
  const roots = new Set([projectRoot, path.join(projectRoot, 'src'), packageRoot(fromFile, fileSet)]);
  for (const root of roots) {
    const hit = moduleFile(root, segments, fileSet);
    if (hit) return hit;
  }
  return null;
}

/** Whole string first, then drop trailing segments until a module resolves. */
function resolveDottedLiteral(fromFile, literal, projectRoot, fileSet) {
  const segments = literal.split('.');
  while (segments.length > 0) {
    const hit = resolvePythonImport(fromFile, segments.join('.'), projectRoot, fileSet);
    if (hit) return hit;
    segments.pop();
  }
  return null;
}

/** `from X import a, b as c, *` → the package X and each name that is a submodule of X. */
function fromStatementTargets(m, resolve) {
  const [, , dots, mod, names] = m;
  const spec = dots + mod;
  const targets = [resolve(spec)];
  for (const part of names.split(',')) {
    const name = (part.trim().match(/^\w+/) || [])[0];
    if (!name) continue;
    targets.push(resolve(mod ? `${spec}.${name}` : `${spec}${name}`));
  }
  return targets;
}

/**
 * Every outgoing edge from one Python file.
 * @param {string} fromFile absolute path
 * @param {string} content the file's text
 * @param {string} projectRoot
 * @param {Set<string>} fileSet
 * @returns {Array<{to: string, kind: 'static'|'lazy'|'path-literal'}>}
 */
function pythonEdges(fromFile, content, projectRoot, fileSet) {
  const out = [];
  if (typeof content !== 'string' || content.length > MAX_FILE_BYTES) return out;
  const seen = new Set();
  const record = (to, kind) => {
    if (!to || to === fromFile) return;
    const key = `${to}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to, kind });
  };
  const resolve = (spec) => resolvePythonImport(fromFile, spec, projectRoot, fileSet);

  for (const line of logicalLines(content)) {
    // An import statement carries no string, so its first `#` starts a comment.
    const code = line.replace(/#.*$/, '');
    const mFrom = FROM_RE.exec(code);
    if (mFrom) {
      const kind = mFrom[1] ? 'lazy' : 'static';
      for (const to of fromStatementTargets(mFrom, resolve)) record(to, kind);
      continue;
    }
    const mImp = IMPORT_RE.exec(code);
    if (mImp) {
      const kind = mImp[1] ? 'lazy' : 'static';
      for (const part of mImp[2].split(',')) record(resolve(part.trim().split(/\s+/)[0]), kind);
      continue;
    }
    DOTTED_LITERAL_RE.lastIndex = 0;
    let mLit = DOTTED_LITERAL_RE.exec(line);
    while (mLit !== null) {
      record(resolveDottedLiteral(fromFile, mLit[2], projectRoot, fileSet), 'path-literal');
      mLit = DOTTED_LITERAL_RE.exec(line);
    }
  }
  return out;
}

/**
 * Who imports each Python file — the reverse of `pythonEdges` over every file
 * in `files`. Every file gets an entry, importers or not, so a caller can tell
 * "no importers" from "not a Python file".
 * @param {string[]} files absolute paths of the .py files in scope
 * @param {string} projectRoot
 * @returns {Map<string, string[]>}
 */
function pythonImporters(files, projectRoot) {
  const fileSet = new Set(files.map((f) => path.normalize(f)));
  const importers = new Map();
  for (const f of fileSet) importers.set(f, new Set());
  for (const f of fileSet) {
    let content;
    try {
      content = fs.readFileSync(f, 'utf-8');
    } catch {
      continue; // error-ok — an unreadable file contributes no edges; it is still listed as a target
    }
    for (const e of pythonEdges(f, content, projectRoot, fileSet)) importers.get(e.to).add(f);
  }
  return new Map([...importers].map(([f, set]) => [f, [...set]]));
}

module.exports = { resolvePythonImport, pythonEdges, pythonImporters, logicalLines };
