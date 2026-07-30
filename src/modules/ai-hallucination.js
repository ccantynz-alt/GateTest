/**
 * AI Hallucination Detector — catches packages and APIs that don't exist.
 *
 * When AI coding assistants generate code they occasionally:
 *   1. Import npm packages that were never published or have been deleted.
 *   2. Call methods that don't exist on well-known APIs (fs.readAllFiles,
 *      Array.prototype.flatten on Node <11, etc.).
 *   3. Use non-existent named exports from popular packages.
 *   4. Reference APIs from the wrong library (calling OpenAI SDK methods
 *      on the Anthropic client).
 *
 * Detection:
 *   - Cross-reference every bare `import` / `require` against package.json
 *     dependencies + devDependencies. Unknown packages = error.
 *   - Scan for known-hallucinated method shapes on popular library objects.
 *   - AI engine (Claude) analyses the diff for invented API calls when
 *     ANTHROPIC_API_KEY is set.
 *
 * Suppression: `// hallucination-ok` on the import line skips that import.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const BaseModule    = require('./base-module');
const { makeAutoFix } = require('../core/ai-fix-engine');

// ─── known-hallucinated method patterns ───────────────────────────────────

const HALLUCINATED_METHODS = [
  // Node built-ins that never existed
  { re: /\bfs\.readAllFiles\b/,            msg: '`fs.readAllFiles` does not exist — use `fs.readdirSync` + `fs.readFileSync`' },
  { re: /\bfs\.readDirectory\b/,           msg: '`fs.readDirectory` does not exist — use `fs.readdirSync`' },
  { re: /\bfs\.writeAll\b/,                msg: '`fs.writeAll` does not exist — use `fs.writeFileSync`' },
  { re: /\bpath\.combine\b/,               msg: '`path.combine` does not exist — use `path.join`' },
  { re: /\bArray\.flatten\b/,              msg: '`Array.flatten` does not exist — use `Array.prototype.flat()`' },
  { re: /\bObject\.entries\(.*\)\.toMap\b/,msg: '`Object.entries().toMap` does not exist — convert manually' },
  { re: /\bString\.prototype\.replaceAll\b.*Node\s*(?:[0-9]|1[0-4])\b/, msg: '`replaceAll` requires Node 15+' },
  // Express invented methods
  { re: /\bapp\.middleware\s*\(/,           msg: '`app.middleware()` does not exist — use `app.use()`' },
  { re: /\bres\.sendStatus\s*\(\s*(?!1\d\d|2\d\d|3\d\d|4\d\d|5\d\d)/, msg: 'Suspicious `res.sendStatus()` — should be a 3-digit HTTP status code' },
  // React invented hooks
  { re: /\buseServerState\s*\(/,            msg: '`useServerState` is not a real React hook' },
  { re: /\buseServerSideProps\s*\(/,        msg: '`useServerSideProps` is not a real hook — use Next.js `getServerSideProps` or server components' },
  // Prisma invented methods
  { re: /\bprisma\.\w+\.findByPk\b/,       msg: '`findByPk` is a Sequelize method — Prisma uses `findUnique`' },
  { re: /\bprisma\.\w+\.bulkCreate\b/,     msg: '`bulkCreate` is Sequelize — Prisma uses `createMany`' },
  { re: /\bprisma\.\w+\.findOrCreate\b/,   msg: '`findOrCreate` is Sequelize — Prisma uses `upsert`' },
  // Anthropic / OpenAI cross-contamination
  { re: /anthropic\.chat\.completions/,     msg: '`chat.completions` is OpenAI SDK API — Anthropic uses `anthropic.messages.create()`' },
  { re: /openai\.messages\.create/,         msg: '`messages.create` is Anthropic SDK API — OpenAI uses `openai.chat.completions.create()`' },
  // Mongoose invented methods
  { re: /\.\s*findOneAndUpsert\s*\(/,       msg: '`findOneAndUpsert` does not exist — use `findOneAndUpdate` with `{upsert:true}`' },
  // Next.js invented exports
  { re: /export\s+(?:const|function)\s+getInitialProps\b/, msg: '`getInitialProps` must be a static method on the component class, not a named export' },
];

// ─── path alias prefixes that are always local or framework-virtual ──────────
// These resolve to local files even though they look like bare specifiers.
const PATH_ALIAS_PREFIXES = [
  '@/', '~/', '#/', '$env/', '$app/', '$lib/', '@components/', '@utils/',
  '@hooks/', '@store/', '@types/', '@assets/', '@pages/', '@layouts/',
  '@lib/', // this repo's own tsconfig path alias (see website/tsconfig.json)
];

function isPathAlias(specifier) {
  return PATH_ALIAS_PREFIXES.some(p => specifier.startsWith(p));
}

// ─── common stdlib / well-known builtins (never flag these as unknown) ─────

const BUILT_IN_MODULES = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster',
  'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns',
  'dns/promises', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2',
  'https', 'inspector', 'inspector/promises', 'module', 'net', 'os', 'path',
  'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'readline/promises', 'repl', 'sea', 'sqlite',
  'stream', 'stream/consumers', 'stream/promises', 'stream/web',
  'string_decoder', 'sys', 'test', 'test/reporters', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url',
  'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  // Bun
  'bun', 'bun:sqlite', 'bun:ffi', 'bun:test',
  // Deno
  'deno',
  // Virtual / framework conventions
  'next/server', 'next/navigation', 'next/headers', 'next/image',
  'next/link', 'next/font/google', 'react', 'react/jsx-runtime',
  'react-dom', 'react-dom/client', 'react-dom/server',
  // Webpack / Vite virtual
  '$env/static/public', '$app/environment', '$app/stores',
  // VS Code extension host — injected at runtime, never an npm dependency
  'vscode',
]);

// `node:`-prefixed specifiers (e.g. `node:fs`, `node:test`) are the modern,
// explicit way to import a Node built-in — functionally identical to the
// bare form. BUILT_IN_MODULES lists bare names only; strip the prefix
// before checking so both forms resolve the same way.
function stripNodePrefix(specifier) {
  return specifier.startsWith('node:') ? specifier.slice(5) : specifier;
}

// prefixes that are always local
function isLocalImport(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

// bare package name (first path segment, strip @scope)
function barePackage(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

// ─── import harvester ─────────────────────────────────────────────────────

const IMPORT_RE  = /^\s*import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const REQUIRE_RE = /(?:^|[^/])\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function harvestImports(content) {
  const imports = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) imports.push({ specifier: m[1], index: m.index });
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(content)) !== null) imports.push({ specifier: m[1], index: m.index });
  return imports;
}

// ─── module ────────────────────────────────────────────────────────────────

/** Dependency names declared by one package.json. null when there is no file. */
function readPkgDeps(pkgPath) {
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, 'utf-8');
  } catch {
    return null; // no manifest here — not an error
  }
  const names = new Set();
  try {
    const pkg = JSON.parse(raw);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const key of Object.keys(pkg[field] || {})) names.add(key);
    }
    // A workspace package can import itself by name (`@acme/ui` -> its own root).
    if (typeof pkg.name === 'string' && pkg.name) names.add(pkg.name);
  } catch {
    return null; // malformed manifest — treat as absent rather than guessing
  }
  return names;
}

class AiHallucinationDetector extends BaseModule {
  constructor() {
    super('aiHallucination', 'AI Hallucination Detector — fake imports, invented APIs, non-existent methods');
  }

  /**
   * Dependencies visible to a file, by its directory: the nearest package.json
   * plus every manifest between it and the project root, unioned.
   *
   * Before this existed, dependency resolution walked only UP from projectRoot,
   * so a manifest BELOW the root was invisible. Any nested package — a monorepo
   * workspace, a test fixture, an examples/ directory with its own deps — had
   * every one of its imports reported as a possible hallucination. On this repo
   * that was ~100 of 136 warnings (`playwright`, `express`, `openai`, `helmet`
   * under benchmarks/bench-target/), and for a customer with a monorepo it means
   * false positives across every workspace, which is the fastest way to teach
   * someone to ignore a scanner.
   *
   * Ancestors are unioned rather than shadowed on purpose: npm and pnpm hoist,
   * so a workspace package legitimately resolves the root's dependencies too.
   * Reporting a hoisted import as missing would just trade one false positive
   * class for another.
   *
   * Memoised per directory, and directories without a manifest SHARE the parent's
   * Set rather than copying it — otherwise this is O(files x depth) allocations
   * on a large monorepo, which is the cost that made this "more invasive" to
   * begin with.
   */
  _depsForDir(dir, projectRoot, cache, rootDeps) {
    const cached = cache.get(dir);
    if (cached) return cached;

    const parent = path.dirname(dir);
    const atOrAboveRoot = dir === projectRoot || parent === dir || dir.length <= projectRoot.length;
    const inherited = atOrAboveRoot
      ? rootDeps
      : this._depsForDir(parent, projectRoot, cache, rootDeps);

    const own = readPkgDeps(path.join(dir, 'package.json'));
    // No manifest here → same visibility as the parent. Share the object.
    const set = own === null ? inherited : new Set([...inherited, ...own]);

    cache.set(dir, set);
    return set;
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Load known dependencies — check local package.json AND walk up to find
    // root workspace package.json (monorepos install deps at root, not per-package)
    const rootDeps = new Set();
    const pkgRoots = [projectRoot];
    // Walk up to find workspace root (stop at fs root or after 4 levels)
    let cur = projectRoot;
    for (let i = 0; i < 4; i++) {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      if (fs.existsSync(path.join(parent, 'package.json'))) pkgRoots.push(parent);
      cur = parent;
    }
    for (const root of pkgRoots) {
      const pkgPath = path.join(root, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        for (const key of Object.keys(pkg.dependencies || {})) rootDeps.add(key);
        for (const key of Object.keys(pkg.devDependencies || {})) rootDeps.add(key);
        for (const key of Object.keys(pkg.peerDependencies || {})) rootDeps.add(key);
        for (const key of Object.keys(pkg.optionalDependencies || {})) rootDeps.add(key);
      } catch { /* skip */ }
    }

    // Also scan workspaces / monorepo packages
    const workspaceNames = this._collectWorkspaceNames(projectRoot);

    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
    const files = this._collectFiles(projectRoot, extensions);

    let issueCount = 0;

    // dir -> deps visible from it. Populated lazily by _depsForDir.
    const depsCache = new Map();

    for (const file of files) {
      const rel = path.relative(projectRoot, file);
      if (rel.includes('node_modules') || rel.includes('.next')) continue;

      // Nearest-manifest resolution, so a nested package's own dependencies count.
      const knownDeps = this._depsForDir(path.dirname(file), projectRoot, depsCache, rootDeps);

      let content;
      try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }

      const lines = content.split(/\r?\n/);

      // 1. Unknown package imports
      const imports = harvestImports(content);
      for (const { specifier, index } of imports) {
        if (isLocalImport(specifier)) continue;
        if (isPathAlias(specifier)) continue; // @/utils, ~/components, etc.
        const pkg = barePackage(specifier);
        if (BUILT_IN_MODULES.has(stripNodePrefix(pkg)) || BUILT_IN_MODULES.has(stripNodePrefix(specifier))) continue;
        if (knownDeps.has(pkg)) continue;
        if (workspaceNames.has(pkg)) continue;

        const lineNo  = content.slice(0, index).split(/\r?\n/).length;
        const lineText = lines[lineNo - 1] || '';
        if (lineText.includes('// hallucination-ok')) continue;

        // An "import" inside a string literal or a comment is not an import.
        //
        // This module had NO string guard — it was one of the unguarded modules
        // KI #77 recorded — and it is the single biggest remaining source of its
        // false positives. Measured on this repo: 30 findings from
        // tests/security-policy-applier.test.js and 17 from
        // tests/prompt-safety.test.js, all of them FIXTURES, e.g.
        //   assert.equal(detectFramework("const express = require('express');"), 'express')
        // A module that tests framework detection has to contain sample code as
        // data, and scanning that data as if it were code reports the fixture's
        // dependencies as the project's hallucinations. The giveaway was two of
        // the top "packages" being `${importPath}` and `*.node`, which cannot
        // appear in a real specifier.
        //
        // Guarded by COLUMN, not by line: a genuine `import x from 'pkg'` has its
        // match at the start of the line, so the quoted specifier never makes it
        // look string-enclosed.
        if (this._isCommentLine(lineText)) continue;
        const lineStart = content.lastIndexOf('\n', index - 1) + 1;
        if (this._isInsideStringLiteral(lineText, index - lineStart)) continue;
        // Type-only imports are erased at compile time — treat as warning, not error
        const isTypeOnly = /^\s*import\s+type\b/.test(lineText);

        issueCount++;
        result.addCheck(`ai-hallucination:unknown-pkg:${rel}:${pkg}`, false, {
          severity: isTypeOnly ? 'info' : 'warning',
          message: `Import of \`${pkg}\` not found in package.json (checked the nearest manifest and every one up to the project root) — possible AI hallucination or missing install`,
          file: rel,
          line: lineNo,
          fix: `Run \`npm install ${pkg}\` if the package is real, or remove the import if it was hallucinated.`,
          autoFix: makeAutoFix(
            file,
            'ai-hallucination:unknown-pkg',
            `Package "${pkg}" is not in package.json`,
            lineNo,
            `Either run npm install ${pkg} or remove this import if it was AI-hallucinated`
          ),
        });
      }

      // 2. Known-hallucinated method patterns
      for (const { re, msg } of HALLUCINATED_METHODS) {
        re.lastIndex = 0;
        let m;
        const reGlobal = new RegExp(re.source, (re.flags.includes('g') ? re.flags : re.flags + 'g'));
        while ((m = reGlobal.exec(content)) !== null) {
          const lineNo   = content.slice(0, m.index).split(/\r?\n/).length;
          const lineText = lines[lineNo - 1] || '';
          if (lineText.includes('// hallucination-ok')) continue;

          issueCount++;
          result.addCheck(`ai-hallucination:method:${rel}:L${lineNo}`, false, {
            severity: 'warning',
            message: `${msg} (${rel}:${lineNo})`,
            file: rel,
            line: lineNo,
            fix: msg,
            autoFix: makeAutoFix(file, 'ai-hallucination:method', msg, lineNo, msg),
          });
        }
      }
    }

    if (issueCount === 0) {
      result.addCheck('ai-hallucination:clean', true, {
        severity: 'info',
        message: 'No hallucinated imports or invented API calls detected',
      });
    }
  }

  _collectWorkspaceNames(projectRoot) {
    const names = new Set();
    const workspaceDirs = ['packages', 'apps', 'libs', 'services'];
    for (const dir of workspaceDirs) {
      const full = path.join(projectRoot, dir);
      if (!fs.existsSync(full)) continue;
      try {
        for (const entry of fs.readdirSync(full)) {
          const pkgJson = path.join(full, entry, 'package.json');
          if (fs.existsSync(pkgJson)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
              if (pkg.name) names.add(pkg.name);
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }
    return names;
  }
}

module.exports = AiHallucinationDetector;
