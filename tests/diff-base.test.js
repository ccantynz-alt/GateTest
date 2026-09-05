'use strict';

// src/core/diff-base.js — the ONE answer to "what is this change judged
// against" (the Fifty, move 27; Doctrine §4). Every case is a real git repo.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { resolveDiffBase, mergeGroupBase } = require('../src/core/diff-base');

describe('resolveDiffBase', () => {
  let tmp; let eventFile;
  const git = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const commit = (file, msg) => { fs.writeFileSync(path.join(tmp, file), `${msg}\n`); git('add', file); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  const env = (o) => ({ ...o });
  let shas;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-diffbase-'));
    git('init', '-q', '-b', 'main');
    shas = {};
    shas.root = commit('a.txt', 'root');
    git('update-ref', 'refs/heads/stale-main', 'HEAD');
    shas.originMain = commit('b.txt', 'origin moved on');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('update-ref', 'refs/remotes/origin/release', shas.root);
    git('checkout', '-q', '--detach', 'HEAD');
    git('update-ref', 'refs/heads/main', 'refs/heads/stale-main');   // the laptop's stale main
    shas.head = commit('c.txt', 'the change');
    eventFile = path.join(tmp, 'event.json');
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('origin/main wins over a stale local main', () => {
    const r = resolveDiffBase({ projectRoot: tmp, env: env({}) });
    assert.deepEqual(r, { ref: 'origin/main', mergeBase: shas.originMain, source: 'origin' });
  });

  it('a local main is consulted only when no origin/* exists', () => {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('update-ref', '-d', 'refs/remotes/origin/release');
    const r = resolveDiffBase({ projectRoot: tmp, env: env({}) });
    assert.equal(r.source, 'local');
    assert.equal(r.mergeBase, shas.root);
  });

  it('GITHUB_BASE_REF names the PR base; an unfetched one falls through to origin/main', () => {
    assert.equal(resolveDiffBase({ projectRoot: tmp, env: env({ GITHUB_BASE_REF: 'release' }) }).ref, 'origin/release');
    assert.equal(resolveDiffBase({ projectRoot: tmp, env: env({ GITHUB_BASE_REF: 'nope' }) }).ref, 'origin/main');
  });

  it('a merge-queue event names its base in the payload, not in GITHUB_BASE_REF', () => {
    fs.writeFileSync(eventFile, JSON.stringify({ merge_group: { base_sha: shas.root, base_ref: 'refs/heads/release', head_sha: shas.head } }));
    const e = env({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: eventFile });
    assert.deepEqual(mergeGroupBase(e), [shas.root, 'origin/release']);
    const r = resolveDiffBase({ projectRoot: tmp, env: e });
    assert.equal(r.source, 'merge-group');
    assert.equal(r.mergeBase, shas.root);
  });

  it('a merge-queue payload whose base sha is not fetched falls to origin/<base_ref>, then origin/main', () => {
    fs.writeFileSync(eventFile, JSON.stringify({ merge_group: { base_sha: 'f'.repeat(40), base_ref: 'refs/heads/release' } }));
    const r = resolveDiffBase({ projectRoot: tmp, env: env({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: eventFile }) });
    assert.equal(r.ref, 'origin/release');
    fs.writeFileSync(eventFile, '{ not json');
    assert.equal(resolveDiffBase({ projectRoot: tmp, env: env({ GITHUB_EVENT_NAME: 'merge_group', GITHUB_EVENT_PATH: eventFile }) }).ref, 'origin/main');
  });

  it('explicit beats --since beats the environment; an unresolvable explicit ref is skipped', () => {
    const e = env({ GITHUB_BASE_REF: 'release' });
    assert.equal(resolveDiffBase({ projectRoot: tmp, explicit: 'stale-main', incrementalSince: 'origin/release', env: e }).source, 'explicit');
    assert.equal(resolveDiffBase({ projectRoot: tmp, incrementalSince: 'origin/release', env: e }).source, 'since');
    assert.equal(resolveDiffBase({ projectRoot: tmp, explicit: 'no-such-ref', env: e }).source, 'github-base-ref');
  });

  it('nothing resolves → null, never a throw (no git repo, no refs)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-diffbase-empty-'));
    try { assert.equal(resolveDiffBase({ projectRoot: empty, env: env({}) }), null); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    git('update-ref', '-d', 'refs/remotes/origin/main');
    git('update-ref', '-d', 'refs/remotes/origin/release');
    git('update-ref', '-d', 'refs/heads/main');
    assert.equal(resolveDiffBase({ projectRoot: tmp, env: env({}) }), null);
  });

  it('the runner\'s --diff reads the same answer: the working-tree change, not the stale main\'s backlog', () => {
    const { GateTestRunner } = require('../src/core/runner');
    const { GateTestConfig } = require('../src/core/config');
    fs.appendFileSync(path.join(tmp, 'a.txt'), 'edited\n');
    const changed = new GateTestRunner(new GateTestConfig(tmp))._getChangedFiles();
    assert.deepEqual(changed.sort(), ['a.txt', 'c.txt'], 'c.txt is this branch beyond origin/main; a.txt is the working tree; b.txt (origin moved on) is NOT ours');
  });
});
