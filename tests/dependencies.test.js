const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DependenciesModule = require('../src/modules/dependencies');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function runModule(projectRoot) {
  const mod = new DependenciesModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

describe('DependenciesModule — discovery', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('skips gracefully when no manifests exist', async () => {
    const result = await runModule(tmpDir);
    const skip = result.checks.find((c) => c.name === 'dependencies:no-manifests');
    assert.ok(skip, 'should record no-manifests info check');
    assert.strictEqual(skip.severity, 'info');
    assert.strictEqual(skip.passed, true);
  });

  it('detects multiple manifest kinds in one pass', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module x\n\nrequire github.com/foo/bar v1.2.3\n');
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n\n[dependencies]\nserde = "1.0"\n');

    const result = await runModule(tmpDir);
    const scanning = result.checks.find((c) => c.name === 'dependencies:scanning');
    assert.ok(scanning);
    assert.match(scanning.message, /npm/);
    assert.match(scanning.message, /go/);
    assert.match(scanning.message, /cargo/);
  });
});

describe('DependenciesModule — npm (package.json)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-npm-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('flags wildcard "*" pins', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { lodash: '*' } }),
    );
    // Avoid lockfile noise
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const wildcard = result.checks.find((c) => c.name === 'dependencies:wildcard:npm:lodash');
    assert.ok(wildcard, 'wildcard check must fire');
    assert.strictEqual(wildcard.passed, false);
    assert.strictEqual(wildcard.severity, 'warning');
  });

  it('flags "latest" pins', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { 'some-pkg': 'latest' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const wildcard = result.checks.find((c) => c.name === 'dependencies:wildcard:npm:some-pkg');
    assert.ok(wildcard, '"latest" should be flagged');
  });

  it('flags deprecated packages (request)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { request: '^2.88.0' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const dep = result.checks.find((c) => c.name === 'dependencies:deprecated:npm:request');
    assert.ok(dep, 'deprecated request should be flagged');
    assert.match(dep.message, /Deprecated/);
  });

  it('flags missing lockfile', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    );
    // No lockfile
    const result = await runModule(tmpDir);
    const lock = result.checks.find((c) => c.name.startsWith('dependencies:no-lockfile:npm'));
    assert.ok(lock, 'missing lockfile should be flagged');
    assert.strictEqual(lock.severity, 'warning');
  });

  it('does NOT flag missing lockfile when one exists', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    const result = await runModule(tmpDir);
    const lock = result.checks.find((c) => c.name.startsWith('dependencies:no-lockfile:'));
    assert.strictEqual(lock, undefined, 'pnpm-lock.yaml should satisfy the lockfile check');
  });

  it('flags duplicate prod/dev declarations', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { lodash: '^4.17.21' },
        devDependencies: { lodash: '^4.17.21' },
      }),
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const dup = result.checks.find((c) => c.name === 'dependencies:duplicate:npm:lodash');
    assert.ok(dup);
    assert.strictEqual(dup.severity, 'warning');
  });

  it('flags git/tarball URLs as non-registry', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { 'sneaky-fork': 'git+https://example.com/repo.git' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const nonReg = result.checks.find((c) => c.name === 'dependencies:non-registry:npm:sneaky-fork');
    assert.ok(nonReg);
    assert.strictEqual(nonReg.severity, 'info');
  });

  it('reports a parse error gracefully on malformed JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{ not: valid json');
    const result = await runModule(tmpDir);
    const err = result.checks.find((c) => c.name.startsWith('dependencies:parse-error:npm'));
    assert.ok(err, 'malformed JSON should surface as parse-error, not crash');
  });
});

describe('DependenciesModule — pip (requirements.txt)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-pip-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('flags unpinned packages and deprecated nose', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), [
      '# my deps',
      'requests>=2.0',
      'nose',
      'flask',
      'django==4.2.0',
    ].join('\n'));
    const result = await runModule(tmpDir);
    const noseDep = result.checks.find((c) => c.name === 'dependencies:deprecated:pip:nose');
    assert.ok(noseDep, 'nose must be flagged as deprecated');

    const flaskUnpinned = result.checks.find((c) => c.name === 'dependencies:wildcard:pip:flask');
    assert.ok(flaskUnpinned, 'flask (no version) must be flagged');

    // At least one pin exists (django==4.2.0), so `no-pins` should NOT fire
    const noPins = result.checks.find((c) => c.name.startsWith('dependencies:no-pins:pip:'));
    assert.strictEqual(noPins, undefined);
  });

  it('fires no-pins info check when NO == pins exist', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements.txt'), 'flask>=1.0\n');
    const result = await runModule(tmpDir);
    const noPins = result.checks.find((c) => c.name.startsWith('dependencies:no-pins:pip:'));
    assert.ok(noPins, 'no-pins info check must fire when nothing is pinned with ==');
  });
});

describe('DependenciesModule — go / Cargo / Gemfile / Gradle', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-misc-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('flags Go pseudo-versions as info', async () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), [
      'module example.com/x',
      '',
      'require (',
      '    github.com/foo/bar v0.0.0-20240101000000-abc123def456',
      ')',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'go.sum'), '');
    const result = await runModule(tmpDir);
    const pseudo = result.checks.find((c) => c.name.startsWith('dependencies:pseudo-version:go:'));
    assert.ok(pseudo);
    assert.strictEqual(pseudo.severity, 'info');
  });

  it('flags Cargo wildcard and git-without-rev', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), [
      '[package]',
      'name = "x"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'serde = "*"',
      'weirdo = { git = "https://example.com/x.git" }',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'Cargo.lock'), '');
    const result = await runModule(tmpDir);
    const wildcard = result.checks.find((c) => c.name === 'dependencies:wildcard:cargo:serde');
    assert.ok(wildcard);
    const gitNoRev = result.checks.find((c) => c.name === 'dependencies:git-no-rev:cargo:weirdo');
    assert.ok(gitNoRev);
  });

  it('flags Gemfile gems with no version and deprecated gems', async () => {
    fs.writeFileSync(path.join(tmpDir, 'Gemfile'), [
      'source "https://rubygems.org"',
      'gem "rails", "~> 7.1"',
      'gem "rvm"',
      'gem "unpinned-thing"',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'Gemfile.lock'), '');
    const result = await runModule(tmpDir);
    const dep = result.checks.find((c) => c.name === 'dependencies:deprecated:bundler:rvm');
    assert.ok(dep);
    const unpinned = result.checks.find((c) => c.name === 'dependencies:wildcard:bundler:unpinned-thing');
    assert.ok(unpinned);
  });

  it('flags dynamic Gradle versions', async () => {
    fs.writeFileSync(path.join(tmpDir, 'build.gradle'), [
      'dependencies {',
      "    implementation 'com.google.guava:guava:31.+'",
      "    implementation 'org.apache.commons:commons-lang3:3.12.0'",
      '}',
      '',
    ].join('\n'));
    const result = await runModule(tmpDir);
    const dyn = result.checks.find((c) => c.name === 'dependencies:wildcard:gradle:com.google.guava:guava');
    assert.ok(dyn);
    // Static one should NOT be flagged
    const staticOne = result.checks.find(
      (c) => c.name === 'dependencies:wildcard:gradle:org.apache.commons:commons-lang3',
    );
    assert.strictEqual(staticOne, undefined);
  });
});

describe('DependenciesModule — composer (composer.json)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-composer-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('flags wildcards and deprecated packages in require blocks', async () => {
    fs.writeFileSync(path.join(tmpDir, 'composer.json'), JSON.stringify({
      require: { 'monolog/monolog': '^3.0', 'somevendor/wild': '*' },
      'require-dev': { 'phpunit/php-invoker': '^4.0' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'composer.lock'), '{}');
    const result = await runModule(tmpDir);
    const wildcard = result.checks.find((c) => c.name === 'dependencies:wildcard:composer:somevendor/wild');
    assert.ok(wildcard);
    const dep = result.checks.find((c) => c.name === 'dependencies:deprecated:composer:phpunit/php-invoker');
    assert.ok(dep);
  });
});

describe('DependenciesModule — summary', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatetest-deps-sum-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('always records a summary check with counts', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { react: '*' } }));
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const result = await runModule(tmpDir);
    const summary = result.checks.find((c) => c.name === 'dependencies:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 manifests/);
    assert.match(summary.message, /1 wildcard/);
  });
});
