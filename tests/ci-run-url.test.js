// =============================================================================
// ci-run-url — the replay command a blocked gate leads with (move 28)
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ciRunUrl, replayCommand } = require('../src/core/ci-run-url');

const GHA = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'crclabs-hq/gatetest', GITHUB_RUN_ID: '26002454347' };

describe('ciRunUrl', () => {
  it('builds the run URL from the Actions environment', () => {
    assert.strictEqual(ciRunUrl(GHA), 'https://github.com/crclabs-hq/gatetest/actions/runs/26002454347');
  });
  it('honours GITHUB_SERVER_URL for GitHub Enterprise, without a doubled slash', () => {
    assert.strictEqual(
      ciRunUrl({ ...GHA, GITHUB_SERVER_URL: 'https://ghe.example.com/' }),
      'https://ghe.example.com/crclabs-hq/gatetest/actions/runs/26002454347',
    );
  });
  it('is null outside Actions', () => {
    assert.strictEqual(ciRunUrl({}), null);
    assert.strictEqual(ciRunUrl({ GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1' }), null);
  });
  it('is null when the identifiers are missing or malformed — never a broken link', () => {
    assert.strictEqual(ciRunUrl({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1' }), null);
    assert.strictEqual(ciRunUrl({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r' }), null);
    assert.strictEqual(ciRunUrl({ ...GHA, GITHUB_RUN_ID: 'abc' }), null);
    assert.strictEqual(ciRunUrl({ ...GHA, GITHUB_REPOSITORY: 'not a repo' }), null);
  });
});

describe('replayCommand', () => {
  it('is the exact command, ready to paste', () => {
    assert.strictEqual(replayCommand(GHA), 'npx gatetest replay https://github.com/crclabs-hq/gatetest/actions/runs/26002454347');
  });
  it('is null outside CI — nothing to replay from a local run', () => {
    assert.strictEqual(replayCommand({}), null);
  });
});
