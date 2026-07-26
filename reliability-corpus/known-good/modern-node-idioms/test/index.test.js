import { test } from 'node:test';
import assert from 'node:assert/strict';

import { retry } from '../src/index.js';
import { validate } from '../src/validators.js';

test('validate accepts a plain object', () => {
  assert.equal(validate({ a: 1 }), true);
});

test('validate rejects arrays and null', () => {
  assert.equal(validate([]), false);
  assert.equal(validate(null), false);
});

test('retry returns the first successful result', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls += 1;
    if (calls < 2) throw new Error('transient');
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});
