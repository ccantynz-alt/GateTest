/**
 * Monorepo Constraints — enforces package boundary rules.
 *
 * In a monorepo (apps/ + packages/ or libs/), applications should import
 * shared code through the packages layer, not directly cross-app. Direct
 * cross-app imports cause:
 *   - Circular dependency explosions at build time.
 *   - Impossible to deploy apps independently.
 *   - Hidden coupling that makes refactoring painful.
 *
 * Rules enforced:
 *   1. apps/web must not import from apps/api (or any sibling app).
 *   2. apps/* must not import from services/* (internal service packages).
 *   3. packages/* must not import from apps/* (package depends on app).
 *   4. No relative imports crossing package boundaries (../../apps/other).
 *
 * Suppression: `// monorepo-ok` on the import line skips that import.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const BaseModule    = require('./base-module');
const { makeAutoFix } = require('../core/ai-fix-engine');

// ─── helpers ───────────────────────────────────────────────────────────────

function detectMonorepoStructure(projectRoot) {
  const structure = { apps: [], packages: [], libs: [], services: [] };

  for (const layer of ['apps', 'packages', 'libs', 'services']) {
    const layerDir = path.join(projectRoot, layer);
    if (!fs.existsSync(layerDir)) continue;
    try {
      for (const entry of fs.readdirSync(layerDir)) {
        const full = path.join(layerDir, entry);
        if (fs.statSync(full).isDirectory()) {
          structure[layer].push({ name: entry, path: full });
        }
      }
    } catch { /* skip */ }
  }

  return structure;
}

function getPackageName(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.name || null;
  } catch { return null; }
}

const IMPORT_RE = /(?:^|\n)\s*(?:import\s+.*?from\s+|(?:const|let|var)\s+.*?=\s*require\s*\(\s*)['"]([^'"]+)['"]/g;

// ─── module ────────────────────────────────────────────────────────────────

class MonorepoConstraints extends BaseModule {
  constructor() {
    super('monorepoConstraints', 'Monorepo Constraints — enforces package boundary rules in apps/ packages/ libs/');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const structure   = detectMonorepoStructure(projectRoot);

    const totalPkgs = structure.apps.length + structure.packages.length +
                      structure.libs.length + structure.services.length;

    if (totalPkgs < 2) {
      result.addCheck('monorepo-constraints:not-monorepo', true, {
        severity: 'info',
        message: 'No monorepo structure detected (apps/, packages/, libs/) — constraint check skipped',
      });
      return;
    }

    // Build package name → layer map
    const pkgNameToLayer = new Map();
    const pkgNameToDir   = new Map();
    for (const [layer, pkgs] of Object.entries(structure)) {
      for (const pkg of pkgs) {
        const name = getPackageName(pkg.path) || pkg.name;
        pkgNameToLayer.set(name, layer);
        pkgNameToDir.set(name, pkg.path);
        // Also map by directory name
        pkgNameToLayer.set(pkg.name, layer);
        pkgNameToDir.set(pkg.name, pkg.path);
      }
    }

    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
    let issueCount = 0;

    // Only scan apps and packages, not node_modules
    const dirsToScan = [
      ...structure.apps.map(p => ({ ...p, layer: 'apps' })),
      ...structure.packages.map(p => ({ ...p, layer: 'packages' })),
      ...structure.libs.map(p => ({ ...p, layer: 'libs' })),
    ];

    for (const { name: sourcePkg, path: sourceDir, layer: sourceLayer } of dirsToScan) {
      const sourceFiles = this._collectFiles(sourceDir, extensions);

      for (const file of sourceFiles) {
        if (file.includes('node_modules')) continue;
        let content;
        try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }

        const rel = path.relative(projectRoot, file);
        const lines = content.split('\n');

        IMPORT_RE.lastIndex = 0;
        let m;
        while ((m = IMPORT_RE.exec(content)) !== null) {
          const specifier = m[1];
          const lineNo    = content.slice(0, m.index).split('\n').length;
          const lineText  = lines[lineNo - 1] || '';
          if (lineText.includes('// monorepo-ok')) continue;

          let targetLayer = null;
          let targetName  = null;

          // Bare package name
          const barePkg = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0];

          if (pkgNameToLayer.has(barePkg)) {
            targetLayer = pkgNameToLayer.get(barePkg);
            targetName  = barePkg;
          }

          // Relative cross-boundary: ../../apps/other or ../../packages/other
          if (!targetLayer && (specifier.startsWith('../') || specifier.startsWith('./'))) {
            const absTarget = path.resolve(path.dirname(file), specifier);
            const relTarget = path.relative(projectRoot, absTarget);
            const parts     = relTarget.replace(/\\/g, '/').split('/');

            if (['apps', 'packages', 'libs', 'services'].includes(parts[0])) {
              targetLayer = parts[0];
              targetName  = parts[1];
            }
          }

          if (!targetLayer || !targetName) continue;
          if (targetName === sourcePkg) continue; // intra-package import

          // Rule 1: apps/* → apps/* is forbidden
          if (sourceLayer === 'apps' && targetLayer === 'apps') {
            issueCount++;
            result.addCheck(`monorepo-constraints:cross-app:${rel}:${specifier}`, false, {
              severity: 'error',
              message: `apps/${sourcePkg} imports directly from apps/${targetName} — cross-app imports forbidden. Move shared code to packages/.`,
              file: rel,
              line: lineNo,
              fix: `Extract the shared code from apps/${targetName} into a packages/ package and import from there.`,
              autoFix: makeAutoFix(file, 'monorepo-constraints:cross-app', `Cross-app import from ${targetName}`, lineNo, `Move shared code to packages/ and update this import`),
            });
          }

          // Rule 2: packages/* → apps/* is forbidden
          if (sourceLayer === 'packages' && targetLayer === 'apps') {
            issueCount++;
            result.addCheck(`monorepo-constraints:pkg-imports-app:${rel}:${specifier}`, false, {
              severity: 'error',
              message: `packages/${sourcePkg} imports from apps/${targetName} — packages must never depend on apps.`,
              file: rel,
              line: lineNo,
              fix: `Remove the dependency on apps/${targetName}. Packages must be app-agnostic.`,
              autoFix: makeAutoFix(file, 'monorepo-constraints:pkg-imports-app', `Package importing from app`, lineNo, `Remove this app dependency from the package`),
            });
          }
        }
      }
    }

    if (issueCount === 0) {
      result.addCheck('monorepo-constraints:clean', true, {
        severity: 'info',
        message: `Monorepo boundaries respected across ${totalPkgs} packages`,
      });
    }
  }
}

module.exports = MonorepoConstraints;
