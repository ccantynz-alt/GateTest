'use strict';
/**
 * src/core/test-paths.js — the one definition of "is this a test path"
 * (181 files depend on it transitively: every module through
 * BaseModule._isTestPath, the dependency-reachability walker and session
 * telemetry directly). tests/test-path-canonical.test.js holds the MATCH /
 * NO_MATCH word lists and the drift guard; this file pins the home itself:
 * the export identity, the normalising, and the non-string inputs.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TEST_PATH_RE, isTestPath } = require('../src/core/test-paths');
const BaseModule = require('../src/modules/base-module');

describe('test-paths — one definition, imported', () => {
  it('BaseModule re-exports the very same RegExp object, and _isTestPath delegates to isTestPath', () => {
    assert.strictEqual(BaseModule.TEST_PATH_RE, TEST_PATH_RE);
    const probe = new BaseModule('probe', 'probe');
    for (const p of ['tests/a.js', 'src/a.js', 'app/test_views.py', 'src\\__tests__\\a.js']) {
      assert.strictEqual(probe._isTestPath(p), isTestPath(p), p);
    }
  });
  it('isTestPath normalises Windows separators — the omission at call sites was the bug it was built to fix', () => {
    assert.strictEqual(isTestPath('src\\__tests__\\a.js'), true);
    assert.strictEqual(isTestPath('src\\latest\\a.js'), false);
  });
  it('non-string and empty inputs are not test paths, never a throw', () => {
    for (const v of [undefined, null, 0, '', {}, []]) assert.strictEqual(isTestPath(v), false);
  });
  it('POSITIVE / NEGATIVE CONTROL — a test dir segment matches, the word inside an identifier does not', () => {
    assert.strictEqual(isTestPath('pkg/js_tests/run.js'), true);
    assert.strictEqual(isTestPath('src/contest.py'), false);
    assert.strictEqual(isTestPath('src/attestation.js'), false);
  });
});
