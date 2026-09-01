// =============================================================================
// DEAD CODE — a `.js` specifier that means `.ts` (TypeScript NodeNext/ESM)
// =============================================================================
// TypeScript's NodeNext and ESM module resolution require the OUTPUT extension
// in the specifier: `export * from "./external.js"` resolves to `external.ts`
// on disk. Our resolver tried `external.js`, `external.js.ts` and
// `external.js/index.ts` — none of which exist — so it failed on a file that
// is plainly there.
//
// FOUND BY WIDENING THE CORPUS, which is the point worth recording. Ten
// precision fixes had been measured against the same nine repos; adding five
// I had never tuned against (zod, commander, koa, dayjs, ora) surfaced this
// on the first scan.
//
// colinhacks/zod @764ac59 (org colinhacks) came in at 3183 warnings, 1865 of
// them `dead-code:unused-export`, 1806 of those inside packages/zod — the
// library's own public API reported as candidate dead code. The package export
// surface resolved 414 names instead of the full API because the re-export
// chain broke at the first hop.
//
// After: surface 414 -> 1381 names, referencedFiles 5 -> 140, zod's
// unused-export 1865 -> 108, repo warnings 3183 -> 1426. Every blocking count
// across the 14-repo corpus unchanged, all three vulnerable repos included.
//
// The load-bearing group is the last one. This fix makes MORE things count as
// imported, so its failure mode is hiding real dead code.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildDeadCodeIndex } = require('../src/modules/dead-code-index');

/**
 * Build a WORKSPACE fixture, because that is the code path the fix lives on.
 *
 * The first version of this file wrote a bare index.ts + x.ts with no
 * package.json and asserted on importedNames. It failed while the real zod
 * scan improved 94%, because `export * from` only contributes names via
 * `populatePackageSurface`, which runs for a workspace package that some file
 * imports BY NAME. A fixture without a workspace never reaches the changed
 * code at all — the test was measuring a path the fix does not touch.
 */
function workspaceIndex(libFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dc-'));
  const written = [];
  const write = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    if (/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(rel)) written.push(abs);
  };

  write('package.json', JSON.stringify({ name: 'root', private: true, workspaces: ['packages/*'] }));
  write('packages/mylib/package.json', JSON.stringify({
    name: 'mylib', version: '1.0.0', main: './src/index.ts',
  }));
  for (const [rel, body] of Object.entries(libFiles)) write(`packages/mylib/${rel}`, body);

  // A consumer importing the package BY NAME — this is what triggers the
  // export-surface computation.
  write('packages/app/package.json', JSON.stringify({ name: 'app', version: '1.0.0' }));
  write('packages/app/main.ts', 'import { anything } from "mylib";\nconsole.log(anything);\n');

  try {
    // Signature is (files, projectRoot). Reversing them yields an empty index,
    // which reads exactly like "nothing was found" — it cost me a detour.
    return buildDeadCodeIndex(written, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('dead-code — TypeScript ESM specifiers resolve', () => {
  it('`./x.js` resolves to x.ts', () => {
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./x.js";\n',
      'src/x.ts': 'export const alpha = 1;\nexport const beta = 2;\n',
    });
    assert.ok(idx.importedNames.has('alpha'), '`alpha` was not reached through the .js specifier');
    assert.ok(idx.importedNames.has('beta'));
  });

  it('`./m.mjs` resolves to m.mts and `./c.cjs` to c.cts', () => {
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./m.mjs";\nexport * from "./c.cjs";\n',
      'src/m.mts': 'export const fromMts = 1;\n',
      'src/c.cts': 'export const fromCts = 1;\n',
    });
    assert.ok(idx.importedNames.has('fromMts'), '.mjs -> .mts did not resolve');
    assert.ok(idx.importedNames.has('fromCts'), '.cjs -> .cts did not resolve');
  });

  it('follows a multi-hop re-export chain (the zod shape)', () => {
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./a.js";\n',
      'src/a.ts': 'export * from "./b.js";\nexport const fromA = 1;\n',
      'src/b.ts': 'export const deepSymbol = 1;\n',
    });
    assert.ok(idx.importedNames.has('fromA'));
    assert.ok(
      idx.importedNames.has('deepSymbol'),
      'the chain broke at the second hop — this is the zod failure exactly',
    );
  });

  it('a real .js file still wins over a same-named .ts', () => {
    // `base` is tried before the TS equivalents, so an actual .js on disk is
    // not shadowed by a sibling .ts.
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./dual.js";\n',
      'src/dual.js': 'export const fromJs = 1;\n',
      'src/dual.ts': 'export const fromTs = 1;\n',
    });
    assert.ok(idx.importedNames.has('fromJs'), 'the real .js file must resolve to itself');
  });
});

describe('dead-code — genuinely unreachable exports are still not imported', () => {
  // Without this, "resolve everything to everything" would satisfy every
  // assertion above while making the module incapable of reporting anything.
  it('an export outside the re-export chain is not counted as imported', () => {
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./used.js";\n',
      'src/used.ts': 'export const consumed = 1;\n',
      'src/orphan.ts': 'export const neverImported = 1;\n',
    });
    assert.ok(idx.importedNames.has('consumed'), 'the reachable export was missed');
    assert.ok(
      !idx.importedNames.has('neverImported'),
      'an export reachable from nothing must NOT be counted as imported',
    );
  });

  it('an unresolvable specifier does not pull in unrelated symbols', () => {
    const idx = workspaceIndex({
      'src/index.ts': 'export * from "./missing.js";\n',
      'src/elsewhere.ts': 'export const strayExport = 1;\n',
    });
    assert.ok(
      !idx.importedNames.has('strayExport'),
      'a broken re-export must not mark unrelated exports as imported',
    );
  });
});
