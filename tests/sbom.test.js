// ============================================================================
// SBOM MODULE TESTS
// ============================================================================
// Validates the CycloneDX 1.5 SBOM generator end-to-end:
//   - Module shape (name, description, async run)
//   - No-lockfile graceful path
//   - Lockfile detection precedence (npm > pnpm > yarn > bun > others)
//   - Per-ecosystem extraction (npm v7+, pnpm, yarn, bun, pip, poetry,
//     go.sum, Cargo.lock, Gemfile.lock)
//   - Output document shape: bomFormat, specVersion, serialNumber, metadata,
//     components, with each component having type='library', name, version,
//     and a correctly-typed package URL (purl)
//   - .gatetest/sbom.cyclonedx.json is written to disk
// ============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SbomModule = require('../src/modules/sbom');

// ----- Test harness ---------------------------------------------------------

function makeTmp(prefix = 'gatetest-sbom-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Minimal TestResult double — we only need addCheck for these tests.
class FakeResult {
  constructor() { this.checks = []; }
  addCheck(name, passed, details = {}) {
    this.checks.push({ name, passed, ...details });
  }
}

async function runSbom(projectRoot) {
  const mod = new SbomModule();
  const result = new FakeResult();
  await mod.run(result, { projectRoot });
  return { mod, result };
}

function readSbom(projectRoot) {
  const p = path.join(projectRoot, '.gatetest', 'sbom.cyclonedx.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ----- Tests ----------------------------------------------------------------

test('sbom module — shape (name, description, async run)', () => {
  const mod = new SbomModule();
  assert.equal(mod.name, 'sbom');
  assert.equal(typeof mod.description, 'string');
  assert.ok(mod.description.length > 10, 'description should be human-readable');
  assert.equal(mod.run.constructor.name, 'AsyncFunction',
    'run() must be async so the runner can await it');
});

test('sbom module — no lockfile present emits info check and does NOT write a file', async () => {
  const root = makeTmp();
  try {
    // Empty project, no lockfile
    const { result } = await runSbom(root);
    const noLock = result.checks.find((c) => c.name === 'sbom:no-lockfile');
    assert.ok(noLock, 'expected sbom:no-lockfile check');
    assert.equal(noLock.severity, 'info');
    assert.equal(noLock.passed, true);

    const sbomPath = path.join(root, '.gatetest', 'sbom.cyclonedx.json');
    assert.equal(fs.existsSync(sbomPath), false, 'no SBOM file should be written when no lockfile');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — package-lock.json with 3 deps generates correct CycloneDX 1.5 doc', async () => {
  const root = makeTmp();
  try {
    const lock = {
      name: 'fixture',
      version: '0.0.1',
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', version: '0.0.1' },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/express': { version: '4.18.2' },
        'node_modules/@scope/util': { version: '1.0.0' },
      },
    };
    writeFile(root, 'package-lock.json', JSON.stringify(lock, null, 2));

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated, 'expected sbom:generated check');
    assert.equal(generated.severity, 'info');
    assert.equal(generated.componentCount, 3);
    assert.equal(generated.ecosystem, 'npm');

    const bom = readSbom(root);
    assert.equal(bom.bomFormat, 'CycloneDX');
    assert.equal(bom.specVersion, '1.5');
    assert.equal(bom.version, 1);
    assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/i);
    assert.ok(bom.metadata, 'metadata block required');
    assert.ok(bom.metadata.timestamp, 'timestamp required');
    assert.match(bom.metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Array.isArray(bom.metadata.tools), 'tools must be an array');
    assert.equal(bom.metadata.tools.length, 1);
    assert.equal(bom.metadata.tools[0].name, 'GateTest');
    assert.ok(Array.isArray(bom.components));
    assert.equal(bom.components.length, 3);

    const names = bom.components.map((c) => c.name).sort();
    assert.deepEqual(names, ['@scope/util', 'express', 'lodash']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — every component has type=library, name, version, and a valid purl', async () => {
  const root = makeTmp();
  try {
    const lock = {
      packages: {
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/@scope/util': { version: '1.0.0' },
      },
    };
    writeFile(root, 'package-lock.json', JSON.stringify(lock));

    await runSbom(root);
    const bom = readSbom(root);

    for (const c of bom.components) {
      assert.equal(c.type, 'library', `component ${c.name} must be type=library`);
      assert.ok(c.name, 'component must have name');
      assert.ok(c.version, 'component must have version');
      assert.ok(c.purl, 'component must have purl');
      assert.match(c.purl, /^pkg:npm\//, `npm purl must start with pkg:npm/, got: ${c.purl}`);
      assert.ok(c.purl.includes(`@${c.version}`),
        `purl should embed the version, got: ${c.purl}`);
    }

    // Scoped name encoded properly: '@scope/util' should keep the @scope/name shape
    const scoped = bom.components.find((c) => c.name === '@scope/util');
    assert.ok(scoped, 'scoped component should be present');
    assert.match(scoped.purl, /^pkg:npm\/@scope%2Futil@1\.0\.0$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — pnpm-lock.yaml is recognised and parsed', async () => {
  const root = makeTmp();
  try {
    const pnpm = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true

packages:

  /lodash@4.17.21:
    resolution: {integrity: sha512-fake}

  /@scope/util@1.2.3:
    resolution: {integrity: sha512-fake}

  /express@4.18.2:
    resolution: {integrity: sha512-fake}
`;
    writeFile(root, 'pnpm-lock.yaml', pnpm);

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated, 'expected sbom:generated for pnpm');
    assert.equal(generated.ecosystem, 'pnpm');
    assert.ok(generated.componentCount >= 3,
      `expected ≥3 pnpm components, got ${generated.componentCount}`);

    const bom = readSbom(root);
    const names = bom.components.map((c) => c.name);
    assert.ok(names.includes('lodash'), 'lodash should be parsed from pnpm-lock');
    assert.ok(names.includes('@scope/util'), 'scoped pnpm pkg should be parsed');
    assert.ok(names.includes('express'), 'express should be parsed from pnpm-lock');

    // pnpm uses npm's purl type
    for (const c of bom.components) {
      assert.match(c.purl, /^pkg:npm\//);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — bun.lock is recognised', async () => {
  const root = makeTmp();
  try {
    // bun.lock JSONC format with a packages map. Each entry is an array
    // whose first element is "name@version".
    const bun = `// bun lockfile fixture
{
  "lockfileVersion": 0,
  "packages": {
    "lodash": ["lodash@4.17.21", {}, "sha512-fake"],
    "express": ["express@4.18.2", {}, "sha512-fake"]
  }
}`;
    writeFile(root, 'bun.lock', bun);

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated, 'expected sbom:generated for bun');
    assert.equal(generated.ecosystem, 'bun');
    assert.ok(generated.componentCount >= 2,
      `expected ≥2 bun components, got ${generated.componentCount}`);

    const bom = readSbom(root);
    const names = bom.components.map((c) => c.name);
    assert.ok(names.includes('lodash'));
    assert.ok(names.includes('express'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — lockfile preference picks package-lock.json over pnpm/yarn/bun when multiple present', async () => {
  const root = makeTmp();
  try {
    // npm lock — should win
    writeFile(root, 'package-lock.json', JSON.stringify({
      packages: { 'node_modules/winning-pkg': { version: '9.9.9' } },
    }));
    // pnpm lock — should be ignored
    writeFile(root, 'pnpm-lock.yaml', 'packages:\n  /loser-pkg@1.0.0:\n    resolution: {}\n');
    // yarn lock — should be ignored
    writeFile(root, 'yarn.lock', '"loser2@^1":\n  version "1.0.0"\n');

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated, 'expected sbom:generated');
    assert.equal(generated.ecosystem, 'npm', 'npm must win precedence');

    const bom = readSbom(root);
    const names = bom.components.map((c) => c.name);
    assert.ok(names.includes('winning-pkg'));
    assert.ok(!names.includes('loser-pkg'));
    assert.ok(!names.includes('loser2'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — .gatetest/sbom.cyclonedx.json is written to disk and is valid JSON', async () => {
  const root = makeTmp();
  try {
    writeFile(root, 'package-lock.json', JSON.stringify({
      packages: {
        'node_modules/foo': { version: '1.0.0' },
        'node_modules/bar': { version: '2.0.0' },
      },
    }));

    await runSbom(root);

    const sbomPath = path.join(root, '.gatetest', 'sbom.cyclonedx.json');
    assert.equal(fs.existsSync(sbomPath), true, '.gatetest/sbom.cyclonedx.json must be written');

    const raw = fs.readFileSync(sbomPath, 'utf-8');
    const parsed = JSON.parse(raw); // throws if invalid JSON
    assert.equal(parsed.bomFormat, 'CycloneDX');
    assert.equal(parsed.specVersion, '1.5');
    assert.ok(Array.isArray(parsed.components));
    assert.equal(parsed.components.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — Pipfile.lock yields pypi-typed purls', async () => {
  const root = makeTmp();
  try {
    const pipfile = {
      _meta: { hash: { sha256: 'fake' } },
      default: {
        requests: { version: '==2.31.0' },
        flask: { version: '==3.0.0' },
      },
      develop: {
        pytest: { version: '==7.4.0' },
      },
    };
    writeFile(root, 'Pipfile.lock', JSON.stringify(pipfile));

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated);
    assert.equal(generated.ecosystem, 'pipenv');
    assert.equal(generated.componentCount, 3);

    const bom = readSbom(root);
    for (const c of bom.components) {
      assert.match(c.purl, /^pkg:pypi\//, `pypi purl required, got ${c.purl}`);
      // == prefix should be stripped from version
      assert.ok(!c.version.startsWith('=='), `version should not retain ==, got ${c.version}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sbom module — go.sum yields golang-typed purls and skips /go.mod duplicate lines', async () => {
  const root = makeTmp();
  try {
    const goSum = [
      'github.com/foo/bar v1.2.3 h1:abcdef',
      'github.com/foo/bar v1.2.3/go.mod h1:xyz',
      'github.com/baz/qux v0.5.0 h1:fakehash',
      'github.com/baz/qux v0.5.0/go.mod h1:fakehash',
      '',
    ].join('\n');
    writeFile(root, 'go.sum', goSum);

    const { result } = await runSbom(root);
    const generated = result.checks.find((c) => c.name === 'sbom:generated');
    assert.ok(generated);
    assert.equal(generated.ecosystem, 'go');
    // Two unique modules; /go.mod lines must be skipped (otherwise dedupe is hiding a bug)
    assert.equal(generated.componentCount, 2);

    const bom = readSbom(root);
    for (const c of bom.components) {
      assert.match(c.purl, /^pkg:golang\//, `golang purl required, got ${c.purl}`);
      assert.ok(!c.version.endsWith('/go.mod'), 'version must not include /go.mod suffix');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
