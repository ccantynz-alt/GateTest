// Idiomatic modern Node. Every construct here is CORRECT and must scan clean.
// This file exists because the engine has repeatedly flagged these exact
// shapes as findings (see the manifest's `guards` notes).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { validate } from './validators.js';
import { CURRENT as CURRENT_VERSION } from './version.js';

export async function loadConfig(dir) {
  const raw = await readFile(join(dir, 'config.json'), 'utf8');
  const parsed = JSON.parse(raw);
  if (!validate(parsed)) {
    throw new Error('config failed validation');
  }
  return { ...parsed, version: CURRENT_VERSION };
}

export async function retry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await sleep(100 * (i + 1));
    }
  }
  throw lastError;
}
