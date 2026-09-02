// =============================================================================
// TWO FILES, ONE IMPORT PATH — the module the bundle ships is not the one
// the tests ran
// =============================================================================
// Found 2026-09-02. website/app/lib/gluecron-callback.js and
// gluecron-callback.ts both existed. Every route wrote
// `import ... from "@/app/lib/gluecron-callback"`, which resolves to the .ts
// (TypeScript/Turbopack try .ts before .js). The .ts decided pass/fail as
// `scanResult.error ? failed : status === "complete" ? passed : failed` — a
// completed scan with ten blocking findings posted "passed" to Gluecron. The
// .js carried the gate verdict and 40 passing tests, and was in no bundle.
//
// That is the apparatus-error pattern in its purest form: the tests were
// green because they tested a file production never loaded. The fix was to
// delete the .ts. This test makes the next collision fail the suite.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOTS = ['website/app/lib', 'src/core'].map((p) => path.resolve(__dirname, '..', p));
const CODE_EXT = new Set(['.js', '.ts', '.tsx', '.mjs', '.cjs', '.jsx']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('no two source files share an extensionless import path', () => {
  for (const root of ROOTS) {
    it(path.relative(path.resolve(__dirname, '..'), root), () => {
      const byBase = new Map();
      for (const f of walk(root)) {
        const ext = path.extname(f);
        if (!CODE_EXT.has(ext)) continue;
        if (/\.(test|spec|d)\.[jt]sx?$/.test(f)) continue;
        const base = f.slice(0, -ext.length);
        byBase.set(base, [...(byBase.get(base) || []), ext]);
      }
      const collisions = [...byBase.entries()].filter(([, exts]) => exts.length > 1)
        .map(([base, exts]) => `${path.relative(root, base)} {${exts.join(', ')}}`);
      assert.deepStrictEqual(collisions, [], 'an extensionless import of these resolves to only one of them:\n' + collisions.join('\n'));
    });
  }
});
