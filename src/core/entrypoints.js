'use strict';
/**
 * Entrypoints — the one definition of "a file nobody needs to import".
 *
 * Reachability analysis (deadCode's orphan-file rule) asks "does any file
 * import this one?". The honest answer is only meaningful once the files
 * that are RUN rather than imported are set aside: package mains and bins,
 * CLI scripts, test files, framework route files, git hooks, browser assets,
 * tool configs, and fixture corpora that are data rather than code. KI #96
 * measured three false-positive classes before this file existed:
 *   - a nested Next.js app (`website/app/...`) never matched `app/` because
 *     the check was a prefix on the repo-relative path, not a segment;
 *   - tool configs (eslint.config.mjs, next.config.ts, playwright.config.ts)
 *     are loaded by their tooling, never imported;
 *   - fixture corpora (a reliability corpus, benchmark targets) are inputs.
 * Segments, not substrings (Doctrine §5).
 */

const fs = require('fs');
const path = require('path');
const { compiledToSources } = require('./module-resolution');

// Not `app`: a Next.js app directory holds ordinary components and libs
// beside its route files, and only the route files (FRAMEWORK_FILE_RE) are
// entrypoints — exempting the whole segment hid a planted orphan in the
// module's own positive control. `pages` stays: every file there is a route.
const ENTRYPOINT_SEGMENTS = new Set([
  'bin', 'tests', 'test', '__tests__', 'scripts', 'migrations', 'pages',
  'api', 'public', 'integrations', 'hooks', 'assets', 'static',
]);

// Inputs and scaffolding, not modules: fixture data, example apps, docs,
// benchmark scripts, and the application-under-test trees an integration
// or e2e suite spins up (nest's `integration/<case>/src` is imported only by
// `integration/<case>/e2e/*.spec.ts` — test code by any honest reading; 134
// findings on nest before this segment was added).
const FIXTURE_SEGMENTS = new Set([
  'fixtures', '__fixtures__', '__mocks__', 'mocks', 'examples', 'example', 'docs', 'sandbox',
  'demo', 'sample', 'samples', 'bench', 'benchmarks', 'corpus', 'integration', 'e2e', 'testing',
]);

const ENTRYPOINT_BASENAMES = new Set([
  'index.js', 'index.ts', 'index.mjs', 'index.cjs', 'index.jsx', 'index.tsx',
  'main.js', 'main.ts', 'main.py', '__init__.py', '__main__.py',
  'app.js', 'app.ts', 'server.js', 'server.ts',
  'conftest.py', 'setup.py', 'manage.py',
]);

// Framework conventions: Next.js route files and metadata files, plus the
// files Next / Vite / test runners load by name.
const FRAMEWORK_FILE_RE = /\b(page|layout|route|loading|error|not-found|template|default|global-error)\.(tsx?|jsx?)$/;
const METADATA_FILE_RE = /^(opengraph-image|twitter-image|icon|apple-icon|favicon|robots|sitemap|manifest)(\.[^.]+)?\.(tsx?|jsx?|ts|js)$/;
const TOOL_FILE_RE = /^(?:[\w.-]+\.config\.(?:[cm]?js|ts)|instrumentation(?:-client)?\.[jt]s|middleware\.[jt]s|next-env\.d\.ts|[\w.-]+\.d\.ts)$/;

/** package.json fields whose string values name files that are run, not imported. */
const MANIFEST_FILE_FIELDS = ['main', 'module', 'browser', 'bin', 'types', 'typings', 'exports', 'scripts'];
const FILE_TOKEN_RE = /(?:^|[\s"'=])(\.?\/?[A-Za-z0-9_\-./]+\.(?:[cm]?js|jsx|tsx?|mts|cts))(?=$|[\s"'&|;)])/g;

function collectStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
}

/**
 * Every file a package.json in `dirs` names as main / bin / module / exports /
 * a script's argument — resolved to absolute paths. One package.json per
 * directory, read once; unreadable or unparseable manifests contribute
 * nothing rather than throwing.
 * @param {Iterable<string>} dirs absolute directories to look in
 * @returns {Set<string>}
 */
function manifestEntrypoints(dirs) {
  const out = new Set();
  for (const dir of new Set(dirs)) {
    const file = path.join(dir, 'package.json');
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { continue; } // error-ok — no manifest here
    for (const field of MANIFEST_FILE_FIELDS) {
      const strings = [];
      collectStrings(pkg[field], strings);
      for (const s of strings) {
        if (field === 'scripts') {
          FILE_TOKEN_RE.lastIndex = 0;
          let m = FILE_TOKEN_RE.exec(s);
          while (m !== null) { out.add(path.resolve(dir, m[1])); m = FILE_TOKEN_RE.exec(s); }
        } else if (/\.(?:[cm]?js|jsx|tsx?|mts|cts)$/.test(s)) {
          out.add(path.resolve(dir, s));
          for (const src of compiledToSources(dir, s)) out.add(src);
        }
      }
    }
  }
  return out;
}

/**
 * @param {string} file absolute path
 * @param {string} projectRoot
 * @param {Set<string>} [manifestRefs] from manifestEntrypoints()
 */
function isEntryPoint(file, projectRoot, manifestRefs) {
  const rel = path.relative(projectRoot, file).split(path.sep).join('/');
  const base = path.basename(file);
  if (ENTRYPOINT_BASENAMES.has(base)) return true;
  if (FRAMEWORK_FILE_RE.test(base) || METADATA_FILE_RE.test(base) || TOOL_FILE_RE.test(base)) return true;
  const segments = rel.split('/').slice(0, -1);
  for (const seg of segments) {
    if (ENTRYPOINT_SEGMENTS.has(seg) || FIXTURE_SEGMENTS.has(seg) || seg.endsWith('-corpus')) return true;
  }
  if (manifestRefs && manifestRefs.has(path.resolve(file))) return true;
  return false;
}

module.exports = { isEntryPoint, manifestEntrypoints };
