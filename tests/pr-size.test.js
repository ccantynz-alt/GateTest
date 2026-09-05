'use strict';

// prSize — the base it measures against. On GitHub Actions a pull_request
// run names its base branch in GITHUB_BASE_REF; a PR stacked on another PR
// must be sized against THAT branch, or the gate sizes the whole stack
// (PR #426 part 2 measured 3,526 lines against main while its own diff
// was ~600; 2026-09-05). Locally, nothing is set and origin/main decides.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PrSizeModule = require('../src/modules/pr-size');

function makeResult() {
  const checks = [];
  return { checks, addCheck(name, passed, details) { checks.push({ name, passed, ...(details || {}) }); } };
}

describe('PrSizeModule — a stacked PR is measured against its own base branch', () => {
  let tmp;
  const saved = {};
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const commitLines = (file, n, msg) => {
    fs.writeFileSync(path.join(tmp, file), Array.from({ length: n }, (_, i) => `line ${i} of ${file}`).join('\n') + '\n');
    git('add', file); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg);
  };
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-prsize-'));
    for (const k of ['GITHUB_BASE_REF']) { saved[k] = process.env[k]; delete process.env[k]; }
    git('init', '-q', '-b', 'main');
    commitLines('base.txt', 3, 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'part-1');
    commitLines('big.txt', 1200, 'part 1: a large change');       // over the default 1000-line hard ceiling on its own
    git('update-ref', 'refs/remotes/origin/part-1', 'HEAD');
    git('checkout', '-q', '-b', 'part-2');
    commitLines('small.txt', 5, 'part 2: a small change');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  const run = async () => { const r = makeResult(); await new PrSizeModule().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks; };
  const tooManyLines = (c) => c.some((x) => !x.passed && x.name === 'pr-size:too-many-lines');

  it('NEGATIVE: with GITHUB_BASE_REF=part-1 only part 2 is counted, and it is small', async () => {
    process.env.GITHUB_BASE_REF = 'part-1';
    assert.equal(tooManyLines(await run()), false);
  });

  it('POSITIVE CONTROL: without it, origin/main is the base and the whole stack blocks', async () => {
    assert.equal(tooManyLines(await run()), true);
  });

  it('a GITHUB_BASE_REF that is not fetched falls through to origin/main', async () => {
    process.env.GITHUB_BASE_REF = 'no-such-branch';
    assert.equal(tooManyLines(await run()), true);
  });
});

describe('PrSizeModule — a stale local main never decides once origin/main resolves', () => {
  let tmp;
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const commitLines = (file, n, msg) => {
    fs.writeFileSync(path.join(tmp, file), Array.from({ length: n }, (_, i) => `line ${i} of ${file}`).join('\n') + '\n');
    git('add', file); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg);
  };
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-prsize-stale-'));
    git('init', '-q', '-b', 'main');
    commitLines('base.txt', 3, 'base');
    git('update-ref', 'refs/heads/stale-main', 'HEAD');            // what a laptop's `main` looks like a week later
    commitLines('big.txt', 1200, 'a week of merges on origin');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');          // HEAD == origin/main, as after a fresh fetch
    git('checkout', '-q', '--detach', 'HEAD');                      // leave main first, THEN wind it back —
    git('update-ref', 'refs/heads/main', 'refs/heads/stale-main');  // moving a checked-out ref would move HEAD too
    fs.appendFileSync(path.join(tmp, 'base.txt'), 'one more line\n'); // the actual uncommitted work (tracked: `git diff` sees it)
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const run = async () => { const r = makeResult(); await new PrSizeModule().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks; };
  const tooManyLines = (c) => c.some((x) => !x.passed && x.name === 'pr-size:too-many-lines');

  it('NEGATIVE: HEAD at origin/main with a one-line edit is measured as the working tree, not against stale main', async () => {
    assert.equal(tooManyLines(await run()), false);
  });

  it('POSITIVE CONTROL: with origin/main gone, the stale main is the only base and the 1200 lines do block', async () => {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal(tooManyLines(await run()), true);
  });
});

describe('PrSizeModule — a whole-file deletion is reviewed by its header, not line by line', () => {
  let tmp;
  const git = (...args) => execFileSync('git', args, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const commit = (msg) => git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', msg);
  const writeLines = (file, n) => fs.writeFileSync(path.join(tmp, file), Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n');
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-prsize-del-'));
    git('init', '-q', '-b', 'main');
    writeLines('gone.txt', 700); writeLines('kept.txt', 3);
    git('add', '.'); commit('base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'change');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const run = async () => { const r = makeResult(); await new PrSizeModule().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks; };
  const failing = (c, prefix) => c.filter((x) => !x.passed && x.name.startsWith(prefix));

  it('NEGATIVE: deleting a 700-line file is not a 700-line change — a warning names it, nothing blocks', async () => {
    fs.rmSync(path.join(tmp, 'gone.txt')); git('add', '-A'); commit('delete gone.txt');
    const c = await run();
    assert.deepEqual(failing(c, 'pr-size:file-too-large').map((x) => x.name), []);
    assert.deepEqual(failing(c, 'pr-size:too-many-lines'), []);
    const note = c.find((x) => x.name === 'pr-size:deleted-file:gone.txt');
    assert.ok(note && note.severity === 'warning', 'the deletion is still reported');
  });

  it('POSITIVE CONTROL: emptying the same file to one line is a rewrite and still blocks the per-file ceiling', async () => {
    writeLines('gone.txt', 1); git('add', '-A'); commit('rewrite gone.txt');
    const c = await run();
    assert.deepEqual(failing(c, 'pr-size:file-too-large').map((x) => x.name), ['pr-size:file-too-large:gone.txt']);
  });
});
