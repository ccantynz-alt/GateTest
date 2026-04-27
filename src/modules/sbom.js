/**
 * SBOM Module — CycloneDX 1.5 Software Bill of Materials generator.
 *
 * Enterprise customers (procurement, compliance, supply-chain audit) need
 * an SBOM for every shipped artefact. CycloneDX is the OWASP standard,
 * shipped as JSON, and the format most tools downstream (Dependency-Track,
 * Snyk, Grype, Trivy, GitHub Dependency Graph importers) consume natively.
 *
 * Honest scope: we extract package + version pairs from whichever lockfile
 * the project already maintains. We do NOT vouch for the accuracy of the
 * dependencies the lockfile declares — we faithfully encode what's there.
 *
 * Lockfile preference order (when multiple are present):
 *   1. package-lock.json    (npm — canonical and most common)
 *   2. pnpm-lock.yaml       (pnpm)
 *   3. yarn.lock            (yarn — text format, parsed inline)
 *   4. bun.lock             (bun, text format)
 *   5. Pipfile.lock         (pipenv, JSON)
 *   6. poetry.lock          (poetry, TOML-ish)
 *   7. go.sum               (go modules)
 *   8. Cargo.lock           (rust, TOML)
 *   9. Gemfile.lock         (bundler, custom format)
 *
 * Output: .gatetest/sbom.cyclonedx.json
 *
 * Zero new dependencies. JSON written by hand. Yarn/poetry/Cargo/Gemfile
 * lockfiles parsed with line-walker heuristics — good enough to pull
 * (name, version) pairs for an SBOM, not a full lockfile resolver.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BaseModule = require('./base-module');

// Order matters — first match wins when multiple lockfiles co-exist.
const LOCKFILE_PREFERENCE = [
  { file: 'package-lock.json', ecosystem: 'npm', purlType: 'npm' },
  { file: 'pnpm-lock.yaml',    ecosystem: 'pnpm', purlType: 'npm' },
  { file: 'yarn.lock',         ecosystem: 'yarn', purlType: 'npm' },
  { file: 'bun.lock',          ecosystem: 'bun', purlType: 'npm' },
  { file: 'Pipfile.lock',      ecosystem: 'pipenv', purlType: 'pypi' },
  { file: 'poetry.lock',       ecosystem: 'poetry', purlType: 'pypi' },
  { file: 'go.sum',            ecosystem: 'go', purlType: 'golang' },
  { file: 'Cargo.lock',        ecosystem: 'cargo', purlType: 'cargo' },
  { file: 'Gemfile.lock',      ecosystem: 'bundler', purlType: 'gem' },
];

class SbomModule extends BaseModule {
  constructor() {
    super(
      'sbom',
      'SBOM — CycloneDX 1.5 Software Bill of Materials generated from project lockfiles',
    );
  }

  async run(result, config) {
    const projectRoot = (config && config.projectRoot) || process.cwd();

    const lockfile = this._pickLockfile(projectRoot);
    if (!lockfile) {
      result.addCheck('sbom:no-lockfile', true, {
        severity: 'info',
        message: 'No lockfile detected — SBOM not generated',
      });
      return;
    }

    let components;
    try {
      components = this._extractComponents(lockfile.absPath, lockfile.ecosystem, lockfile.purlType);
    } catch (err) {
      result.addCheck('sbom:parse-error', false, {
        severity: 'warning',
        file: lockfile.file,
        message: `Could not parse ${lockfile.file}: ${err.message}`,
      });
      return;
    }

    const bom = this._buildCycloneDx(components);

    const outDir = path.join(projectRoot, '.gatetest');
    const outPath = path.join(outDir, 'sbom.cyclonedx.json');
    try {
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, JSON.stringify(bom, null, 2));
    } catch (err) {
      result.addCheck('sbom:write-error', false, {
        severity: 'warning',
        message: `Could not write SBOM to ${outPath}: ${err.message}`,
      });
      return;
    }

    result.addCheck('sbom:generated', true, {
      severity: 'info',
      message: `SBOM written with ${components.length} components from ${lockfile.file}`,
      file: path.relative(projectRoot, outPath),
      ecosystem: lockfile.ecosystem,
      componentCount: components.length,
    });
  }

  // -------------------------------------------------------------------------
  // Lockfile discovery
  // -------------------------------------------------------------------------

  _pickLockfile(projectRoot) {
    for (const candidate of LOCKFILE_PREFERENCE) {
      const absPath = path.join(projectRoot, candidate.file);
      if (fs.existsSync(absPath)) {
        return { ...candidate, absPath };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Component extraction — dispatch by ecosystem
  // -------------------------------------------------------------------------

  _extractComponents(absPath, ecosystem, purlType) {
    const raw = fs.readFileSync(absPath, 'utf-8');
    let pairs = [];
    switch (ecosystem) {
      case 'npm':     pairs = this._parsePackageLock(raw); break;
      case 'pnpm':    pairs = this._parsePnpmLock(raw); break;
      case 'yarn':    pairs = this._parseYarnLock(raw); break;
      case 'bun':     pairs = this._parseBunLock(raw); break;
      case 'pipenv':  pairs = this._parsePipfileLock(raw); break;
      case 'poetry':  pairs = this._parsePoetryLock(raw); break;
      case 'go':      pairs = this._parseGoSum(raw); break;
      case 'cargo':   pairs = this._parseCargoLock(raw); break;
      case 'bundler': pairs = this._parseGemfileLock(raw); break;
      default:        pairs = [];
    }
    return this._dedupe(pairs).map(({ name, version }) => ({
      type: 'library',
      name,
      version,
      purl: this._buildPurl(purlType, name, version),
    }));
  }

  _dedupe(pairs) {
    const seen = new Set();
    const out = [];
    for (const p of pairs) {
      if (!p || !p.name || !p.version) continue;
      const key = `${p.name}@${p.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  _buildPurl(purlType, name, version) {
    // package-url spec: pkg:<type>/<namespace>/<name>@<version>
    // For npm scoped pkgs (@scope/name), encode the slash properly.
    const encodedName = name.startsWith('@')
      ? name.replace('/', '%2F')
      : encodeURIComponent(name).replace(/%40/g, '@');
    const encodedVersion = encodeURIComponent(version);
    return `pkg:${purlType}/${encodedName}@${encodedVersion}`;
  }

  // -------------------------------------------------------------------------
  // Per-ecosystem parsers
  // -------------------------------------------------------------------------

  _parsePackageLock(raw) {
    const obj = JSON.parse(raw);
    const out = [];

    // npm v7+ uses "packages": { "node_modules/foo": { version: ... } }
    if (obj.packages && typeof obj.packages === 'object') {
      for (const [key, meta] of Object.entries(obj.packages)) {
        if (!key) continue; // root entry has key ""
        if (!meta || typeof meta !== 'object') continue;
        if (!meta.version) continue;
        // Strip leading node_modules/ then take the package name (which may be scoped)
        const name = key.replace(/^.*node_modules\//, '');
        if (!name) continue;
        out.push({ name, version: meta.version });
      }
    }

    // npm v6 used "dependencies" tree
    if (out.length === 0 && obj.dependencies && typeof obj.dependencies === 'object') {
      const walk = (deps) => {
        for (const [name, meta] of Object.entries(deps)) {
          if (meta && meta.version) out.push({ name, version: meta.version });
          if (meta && meta.dependencies) walk(meta.dependencies);
        }
      };
      walk(obj.dependencies);
    }

    return out;
  }

  _parsePnpmLock(raw) {
    // pnpm-lock.yaml — we don't ship a YAML parser. Lift package keys
    // from the "packages:" section, which look like:
    //   /lodash@4.17.21:           (v6)
    //   '/@scope/name@1.2.3':      (v6, quoted)
    //   /lodash@4.17.21:           (v9)
    const out = [];
    const lines = raw.split(/\r?\n/);
    let inPackages = false;
    for (const line of lines) {
      if (/^packages:\s*$/.test(line)) { inPackages = true; continue; }
      if (inPackages && /^\S/.test(line) && !/^\s*$/.test(line) && !/^packages:/.test(line)) {
        // top-level key that isn't `packages:` ends the section
        inPackages = false;
      }
      if (!inPackages) continue;

      // Match `  /name@version:` or `  '/name@version':` or `  /@scope/name@version:`
      const m = line.match(/^\s+'?\/((?:@[^/]+\/)?[^@\s]+)@([^:'\s]+)'?:/);
      if (m) {
        out.push({ name: m[1], version: m[2] });
      }
    }
    return out;
  }

  _parseYarnLock(raw) {
    // yarn.lock is custom — entries look like:
    //   "lodash@^4.17.21":
    //     version "4.17.21"
    //     ...
    //   "@scope/name@^1.0.0":
    //     version "1.0.0"
    //
    // Strategy: walk lines. When we hit a line that ends with `:` and
    // looks like a quoted spec (or comma-separated specs), capture the
    // first package name, then look ahead for `version "X"`.
    const out = [];
    const lines = raw.split(/\r?\n/);
    let pendingName = null;
    for (const line of lines) {
      // Skip comments and blank lines
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
      // Header line — starts at column 0, ends with ':'
      if (/^[^\s].*:$/.test(line)) {
        // First spec in a possibly-comma-separated list. Strip the trailing ':'.
        const headerInner = line.slice(0, -1).trim();
        // Split on comma to handle `"a@^1", "a@^2":`
        const firstSpec = headerInner.split(',')[0].trim().replace(/^"|"$/g, '');
        // Spec is `name@range` (or `@scope/name@range`)
        const at = firstSpec.lastIndexOf('@');
        if (at > 0) {
          pendingName = firstSpec.slice(0, at);
        }
        continue;
      }
      // Body line
      const m = line.match(/^\s+version\s+"([^"]+)"/);
      if (m && pendingName) {
        out.push({ name: pendingName, version: m[1] });
        pendingName = null;
      }
    }
    return out;
  }

  _parseBunLock(raw) {
    // bun.lock (text variant, shipped as JSONC since bun v1.1.x).
    // Strip line comments, then JSON.parse. Look for "packages": { name: [...] }
    // where the second element of the array is the version-specifier-with-version.
    // Conservative fallback if shape differs: regex sweep for "name@version".
    try {
      const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
      const obj = JSON.parse(stripped);
      const out = [];
      if (obj && typeof obj === 'object' && obj.packages && typeof obj.packages === 'object') {
        for (const [name, meta] of Object.entries(obj.packages)) {
          let version = null;
          if (Array.isArray(meta) && typeof meta[0] === 'string') {
            // Format: "name@version" — extract version
            const at = meta[0].lastIndexOf('@');
            if (at > 0) version = meta[0].slice(at + 1);
          } else if (meta && typeof meta === 'object' && typeof meta.version === 'string') {
            version = meta.version;
          }
          if (version) out.push({ name, version });
        }
      }
      if (out.length > 0) return out;
    } catch { /* fall through to regex sweep */ }

    // Regex fallback: find `"name@version"` style tokens
    const out = [];
    const re = /"((?:@[\w.-]+\/)?[\w.-]+)@(\d[^"\s]*)"/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      out.push({ name: m[1], version: m[2] });
    }
    return out;
  }

  _parsePipfileLock(raw) {
    const obj = JSON.parse(raw);
    const out = [];
    for (const section of ['default', 'develop']) {
      if (!obj[section] || typeof obj[section] !== 'object') continue;
      for (const [name, meta] of Object.entries(obj[section])) {
        if (!meta || typeof meta !== 'object') continue;
        const v = typeof meta.version === 'string' ? meta.version.replace(/^==/, '') : null;
        if (v) out.push({ name, version: v });
      }
    }
    return out;
  }

  _parsePoetryLock(raw) {
    // poetry.lock is TOML — extract `[[package]]` blocks. We only need
    // `name = "..."` and `version = "..."` from each block.
    const out = [];
    const blocks = raw.split(/^\[\[package\]\]\s*$/m);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
      const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
      if (nameMatch && versionMatch) {
        out.push({ name: nameMatch[1], version: versionMatch[1] });
      }
    }
    return out;
  }

  _parseGoSum(raw) {
    // go.sum lines look like:
    //   github.com/foo/bar v1.2.3 h1:abc...
    //   github.com/foo/bar v1.2.3/go.mod h1:xyz...
    // We want one entry per (module, version) pair — skip /go.mod lines
    // to avoid duplicates.
    const out = [];
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;
      const [name, version] = parts;
      if (version.endsWith('/go.mod')) continue;
      out.push({ name, version });
    }
    return out;
  }

  _parseCargoLock(raw) {
    // Cargo.lock is TOML — `[[package]]` blocks with `name`/`version`.
    const out = [];
    const blocks = raw.split(/^\[\[package\]\]\s*$/m);
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
      const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
      if (nameMatch && versionMatch) {
        out.push({ name: nameMatch[1], version: versionMatch[1] });
      }
    }
    return out;
  }

  _parseGemfileLock(raw) {
    // Gemfile.lock has a `GEM` section with indented `name (version)` entries.
    //   GEM
    //     remote: https://...
    //     specs:
    //       actionpack (7.0.4)
    //         actionview (= 7.0.4)
    //
    // Direct deps under specs: are the gems we want; their nested
    // requirement lines have an operator like `(= 7.0.4)` or `(>= 1.0)`
    // and we skip those.
    const out = [];
    const lines = raw.split(/\r?\n/);
    let inSpecs = false;
    for (const line of lines) {
      if (/^\s*specs:\s*$/.test(line)) { inSpecs = true; continue; }
      if (!inSpecs) continue;
      // End of GEM block: an unindented section header (no leading space)
      if (/^[A-Z]/.test(line)) { inSpecs = false; continue; }
      // Top-level gem entry: 4-space indent, name + (version)
      // Nested requirement: 6-space indent, name + (operator version) — skip
      const m = line.match(/^ {4}([A-Za-z0-9_.-]+) \(([^)<>=~!\s]+)\)\s*$/);
      if (m) out.push({ name: m[1], version: m[2] });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // CycloneDX 1.5 document builder
  // -------------------------------------------------------------------------

  _buildCycloneDx(components) {
    return {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [
          {
            vendor: 'GateTest',
            name: 'GateTest',
            // Read package version if discoverable, else fall back to 'unknown'
            version: this._readSelfVersion(),
          },
        ],
      },
      components,
    };
  }

  _readSelfVersion() {
    try {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg && typeof pkg.version === 'string') return pkg.version;
      }
    } catch { /* swallow — best-effort */ }
    return 'unknown';
  }
}

module.exports = SbomModule;
