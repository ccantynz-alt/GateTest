// ============================================================================
// SELF-HOST IMAGE BUILD-CONTEXT GUARD
// ============================================================================
// The Dockerfile at the repo root is the documented self-hosted deployment
// path (docker-compose.yml builds it for both `app` and `worker`). Its builder
// stage runs `npm run build` inside /app/website, which fires the website's
// npm `prebuild` hook. If a file that hook needs was never COPY'd into the
// stage, npm exits 1 with MODULE_NOT_FOUND *before* `next build` ever runs and
// the image cannot be produced at all.
//
// This test reads the real Dockerfile and the real website/package.json and
// asserts every host path the build hooks touch is present in the builder
// stage at the moment `npm run build` executes.
// ============================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Logical lines of the Dockerfile (backslash continuations joined). */
function dockerfileLines() {
  const raw = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const out = [];
  let buf = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.endsWith('\\')) {
      buf += trimmed.slice(0, -1).trim() + ' ';
      continue;
    }
    out.push((buf + trimmed).trim());
    buf = '';
  }
  if (buf) out.push(buf.trim());
  return out;
}

/**
 * Walk the named stage and return, for the point at which `stopRe` matches,
 * the set of absolute in-image paths created by COPY plus the WORKDIR in force.
 */
function stageStateAt(stageAlias, stopRe) {
  const lines = dockerfileLines();
  let inStage = false;
  let workdir = '/';
  const copied = [];

  const resolveInImage = (dest) => {
    if (dest.startsWith('/')) return path.posix.normalize(dest);
    return path.posix.normalize(path.posix.join(workdir, dest));
  };

  for (const line of lines) {
    const from = line.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/i);
    if (from) {
      inStage = (from[1] || '').toLowerCase() === stageAlias.toLowerCase();
      continue;
    }
    if (!inStage) continue;

    const wd = line.match(/^WORKDIR\s+(\S+)/i);
    if (wd) {
      workdir = resolveInImage(wd[1]);
      continue;
    }

    const copy = line.match(/^COPY\s+(.*)$/i);
    if (copy) {
      const args = copy[1]
        .split(/\s+/)
        .filter((a) => a && !a.startsWith('--'));
      if (args.length < 2) continue;
      const dest = args[args.length - 1];
      for (const src of args.slice(0, -1)) {
        // Destination ending in "/" (or "." / a bare dir) receives the source
        // basename; otherwise the destination IS the resulting path.
        const base = path.posix.basename(src);
        const target = /[/.]$/.test(dest)
          ? path.posix.join(resolveInImage(dest), base)
          : resolveInImage(dest);
        copied.push({ src, target });
      }
      continue;
    }

    if (stopRe.test(line)) return { workdir, copied, reached: true };
  }
  return { workdir, copied, reached: false };
}

/** Does `imagePath` exist in the image given what has been COPY'd so far? */
function presentInImage(copied, imagePath) {
  return copied.some(({ src, target }) => {
    if (target === imagePath) return true;
    if (!imagePath.startsWith(target.replace(/\/$/, '') + '/')) return false;
    // The COPY brought in a directory — the file must exist under that source
    // directory on the host for the image path to resolve.
    const rest = imagePath.slice(target.length + 1);
    return fs.existsSync(path.join(ROOT, src, rest));
  });
}

/** Host script paths referenced by the website's npm build hooks. */
function buildHookScriptPaths() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'website', 'package.json'), 'utf8')
  );
  const cmds = ['prebuild', 'build', 'postbuild']
    .map((k) => pkg.scripts && pkg.scripts[k])
    .filter(Boolean);
  const paths = [];
  for (const cmd of cmds) {
    for (const m of cmd.matchAll(/(\.\.?\/[\w./-]+\.(?:m?js|cjs|sh|ts))/g)) {
      paths.push(m[1]);
    }
  }
  return paths;
}

/**
 * Host directories that website/tsconfig.json path aliases point at from
 * OUTSIDE website/ — next build cannot resolve those imports unless the
 * directory is in the image too.
 */
function externalAliasDirs() {
  const tsconfigPath = path.join(ROOT, 'website', 'tsconfig.json');
  const raw = fs
    .readFileSync(tsconfigPath, 'utf8')
    .replace(/^\s*\/\/.*$/gm, ''); // tsconfig allows // comments
  const cfg = JSON.parse(raw);
  const opts = cfg.compilerOptions || {};
  const base = path.join(path.dirname(tsconfigPath), opts.baseUrl || '.');
  const dirs = new Set();
  for (const targets of Object.values(opts.paths || {})) {
    for (const target of targets) {
      const abs = path.resolve(base, target.replace(/\*.*$/, ''));
      const rel = path.relative(path.join(ROOT, 'website'), abs);
      if (!rel.startsWith('..')) continue; // inside website/, already copied
      if (!fs.existsSync(abs)) continue; // alias points at nothing on disk
      dirs.add(path.relative(ROOT, abs));
    }
  }
  return [...dirs];
}

describe('Dockerfile builder stage — website build context', () => {
  const state = stageStateAt('builder', /^RUN\s+npm\s+run\s+build\b/i);

  it('reaches `RUN npm run build` inside the builder stage', () => {
    assert.ok(state.reached, 'builder stage does not run `npm run build`');
    assert.strictEqual(state.workdir, '/app/website');
  });

  for (const rel of buildHookScriptPaths()) {
    it(`copies the build-hook script ${rel} into the image`, () => {
      const imagePath = path.posix.normalize(
        path.posix.join(state.workdir, rel)
      );
      assert.ok(
        fs.existsSync(path.join(ROOT, path.posix.relative('/app', imagePath))),
        `${rel} does not exist on the host — fix the hook, not the Dockerfile`
      );
      assert.ok(
        presentInImage(state.copied, imagePath),
        `npm \`prebuild\` runs ${rel}, but nothing COPYs it into the builder ` +
          `stage before \`npm run build\` — the image cannot build ` +
          `(MODULE_NOT_FOUND, exit 1).`
      );
    });
  }

  for (const rel of externalAliasDirs()) {
    it(`copies ${rel}/, which a website tsconfig path alias resolves to`, () => {
      assert.ok(
        presentInImage(state.copied, path.posix.join('/app', rel)),
        `website/tsconfig.json aliases imports into ${rel}/, but the builder ` +
          `stage never COPYs it — next build fails with "Module not found".`
      );
    });
  }

  it('copies CLAUDE.md, which generate-build-info.js reads for the version', () => {
    assert.ok(
      presentInImage(state.copied, '/app/CLAUDE.md'),
      'without CLAUDE.md the build stamps version "dev" instead of the release'
    );
  });
});
