const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DockerfileModule = require('../src/modules/dockerfile');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new DockerfileModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

describe('DockerfileModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no Dockerfile exists', async () => {
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'dockerfile:no-files'));
  });

  it('finds Dockerfile, Dockerfile.prod, and *.Dockerfile', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM alpine:3.19\nUSER app\n');
    fs.writeFileSync(path.join(tmp, 'Dockerfile.prod'), 'FROM alpine:3.19\nUSER app\n');
    fs.writeFileSync(path.join(tmp, 'build.Dockerfile'), 'FROM alpine:3.19\nUSER app\n');
    const r = await run(tmp);
    const scanning = r.checks.find((c) => c.name === 'dockerfile:scanning');
    assert.match(scanning.message, /3 Dockerfile/);
  });

  it('excludes node_modules from the walk', async () => {
    fs.mkdirSync(path.join(tmp, 'node_modules', 'bad'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'node_modules', 'bad', 'Dockerfile'), 'FROM scratch\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'dockerfile:no-files'));
  });
});

describe('DockerfileModule — FROM / :latest', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-from-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('flags :latest tag', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:latest\nUSER app\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:latest-tag:Dockerfile:')));
  });

  it('flags untagged base image', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node\nUSER app\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:latest-tag:Dockerfile:')));
  });

  it('accepts pinned tag', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:20.10.0-alpine\nUSER app\n');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:latest-tag:')), undefined);
  });

  it('accepts digest-pinned image', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'),
      'FROM node@sha256:deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeefa\nUSER app\n');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:latest-tag:')), undefined);
  });

  it('does not double-flag FROM <stage-alias> in multi-stage builds', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM node:20.10.0-alpine AS build',
      'RUN npm ci --omit=dev',
      'FROM build AS release',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:latest-tag:')), undefined);
  });
});

describe('DockerfileModule — USER / root', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-user-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('flags missing USER directive', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM alpine:3.19\nCMD ["/bin/true"]\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:no-user:')));
  });

  it('flags explicit USER root', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM alpine:3.19\nUSER root\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:root-user:')));
  });

  it('accepts USER <non-root>', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM alpine:3.19\nUSER app\n');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:no-user:')), undefined);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:root-user:')), undefined);
  });
});

describe('DockerfileModule — RUN hygiene', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-run-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('flags curl | sh pipelines as error', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM alpine:3.19',
      'RUN curl -sSL https://example.com/install.sh | sh',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('dockerfile:curl-pipe-sh:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('flags sudo usage', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM alpine:3.19\nRUN sudo apk add curl\nUSER app\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:sudo:')));
  });

  it('flags apt-get install without --no-install-recommends', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM debian:12-slim',
      'RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:apt-recommends:')));
  });

  it('flags apt-get install without cache cleanup', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM debian:12-slim',
      'RUN apt-get update && apt-get install -y --no-install-recommends curl',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:apt-no-cleanup:')));
  });

  it('flags multiple separate apt-get update layers', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM debian:12-slim',
      'RUN apt-get update',
      'RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:apt-split:')));
  });

  it('flags pip install without --no-cache-dir', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM python:3.12-slim',
      'RUN pip install requests',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:pip-cache:')));
  });

  it('flags npm install without --omit=dev / --production / npm ci', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM node:20-alpine',
      'RUN npm install',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:npm-dev-in-image:')));
  });

  it('accepts npm ci --omit=dev', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM node:20-alpine',
      'RUN npm ci --omit=dev',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:npm-dev-in-image:')), undefined);
  });

  it('flags chmod 777', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM alpine:3.19',
      'RUN chmod -R 777 /app',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:chmod-777:')));
  });
});

describe('DockerfileModule — ADD / secrets', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-add-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('flags ADD with remote URL', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM alpine:3.19',
      'ADD https://example.com/tool.tar.gz /tmp/',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:add-url:')));
  });

  it('flags ENV with AWS access key as error', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM alpine:3.19',
      'ENV AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('dockerfile:secret-in-env:aws-key:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('flags ENV with generic TOKEN secret as error', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM alpine:3.19',
      'ENV API_TOKEN=aXB4ciHwNsxR0psoPrivateSecret',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('dockerfile:secret-in-env:generic-token:')));
  });
});

describe('DockerfileModule — line continuations', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-cont-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('joins \\-continued RUN so single-logical-line checks work', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), [
      'FROM debian:12-slim',
      'RUN apt-get update \\',
      '    && apt-get install -y --no-install-recommends curl \\',
      '    && rm -rf /var/lib/apt/lists/*',
      'USER app',
    ].join('\n'));
    const r = await run(tmp);
    // Should NOT flag apt-recommends (it's present) or apt-no-cleanup (rm is there)
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:apt-recommends:')), undefined);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('dockerfile:apt-no-cleanup:')), undefined);
  });
});

describe('DockerfileModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-docker-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary with issue count', async () => {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), 'FROM node:latest\n');
    const r = await run(tmp);
    const summary = r.checks.find((c) => c.name === 'dockerfile:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 file\(s\)/);
  });
});
