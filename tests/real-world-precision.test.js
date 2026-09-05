'use strict';

// scripts/real-world-precision.js — the corpus gate's cleanup must never
// override its verdict. On CI (2026-09-05) a Gradle daemon left behind by a
// timed-out test run kept writing into the clone directory; `rmSync` threw
// ENOTEMPTY and a gate that had PASSED on all sixteen repos exited 1.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { removeTmp } = require('../scripts/real-world-precision');

describe('real-world-precision — removeTmp', () => {
  it('removes a clone directory and reports success', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rw-rm-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    assert.equal(removeTmp(dir), true);
    assert.equal(fs.existsSync(dir), false);
  });

  it('never throws when the directory cannot be removed — the verdict stands', () => {
    const original = fs.rmSync;
    const written = [];
    const originalWrite = process.stderr.write;
    fs.rmSync = () => { const e = new Error('ENOTEMPTY: directory not empty'); e.code = 'ENOTEMPTY'; throw e; };
    process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      assert.equal(removeTmp('/tmp/gt-realworld-busy'), false);
    } finally {
      fs.rmSync = original;
      process.stderr.write = originalWrite;
    }
    assert.match(written.join(''), /the verdict above stands/);
  });
});
