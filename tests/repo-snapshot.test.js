'use strict';

// REPO SNAPSHOT TEST — the credential-free public-repo reader that keeps the
// free-scan funnel alive when every git-host token is dead (KI #100/#101).
//
// Behavioural tests with an injected fetch: the tar parser is exercised on
// archives built in-process (no network), and the three call sites that used
// to refuse to proceed without a token are checked by source-text contract
// so nobody quietly reintroduces the "no token → 403" dead end.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  fetchPublicRepoSnapshot,
  parseTar,
  tarballUrl,
} = require('../website/app/lib/repo-snapshot.js');

// ── minimal tar writer (ustar) for fixtures ────────────────────────────────
function tarEntry(name, data, type = '0') {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8);
  header.write('0000000\0', 108, 8);
  header.write('0000000\0', 116, 8);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
  header.write('00000000000\0', 136, 12);
  header.write('        ', 148, 8); // checksum placeholder
  header.write(type, 156, 1);
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}
function buildTar(entries) {
  const parts = entries.map(([name, body, type]) =>
    tarEntry(name, Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'), type));
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}
function fakeFetch(status, gzBuffer, headers = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    body: null,
    arrayBuffer: async () => gzBuffer.buffer.slice(gzBuffer.byteOffset, gzBuffer.byteOffset + gzBuffer.byteLength),
  });
}

describe('repo-snapshot — tar parsing', () => {
  it('reads regular files, strips the archive top-level dir, skips dirs and binaries', () => {
    const tar = buildTar([
      ['repo-abc123/', '', '5'],
      ['repo-abc123/package.json', '{"name":"x"}'],
      ['repo-abc123/src/index.js', 'module.exports = 1;\n'],
      ['repo-abc123/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])],
    ]);
    const { entries, allPaths, truncated } = parseTar(tar, { maxFileBytes: 1e6, maxFiles: 100 });
    assert.deepStrictEqual(allPaths, ['package.json', 'src/index.js', 'logo.png']);
    assert.strictEqual(entries.get('package.json').toString(), '{"name":"x"}');
    assert.strictEqual(entries.get('src/index.js').toString(), 'module.exports = 1;\n');
    assert.strictEqual(entries.has('logo.png'), false, 'binary content is not kept');
    assert.strictEqual(truncated, false);
  });

  it('honours the ustar prefix field for long paths', () => {
    const tar = buildTar([['repo-1/a.js', 'x']]);
    // Rewrite entry 0 to put a directory in the prefix field (offset 345).
    tar.write('repo-1/deep/nested', 345, 155, 'utf8');
    tar.write('a.js\0', 0, 100, 'utf8');
    const { allPaths } = parseTar(tar, { maxFileBytes: 1e6, maxFiles: 100 });
    assert.deepStrictEqual(allPaths, ['deep/nested/a.js']);
  });

  it('caps the number of kept files and reports truncation', () => {
    const tar = buildTar([
      ['r/a.js', '1'], ['r/b.js', '2'], ['r/c.js', '3'],
    ]);
    const { entries, allPaths, truncated } = parseTar(tar, { maxFileBytes: 1e6, maxFiles: 2 });
    assert.strictEqual(entries.size, 2);
    assert.strictEqual(allPaths.length, 3, 'paths are still enumerated past the cap');
    assert.strictEqual(truncated, true);
  });

  it('skips single files over maxFileBytes but still lists their path', () => {
    const tar = buildTar([['r/big.js', 'x'.repeat(2000)], ['r/small.js', 'y']]);
    const { entries, allPaths } = parseTar(tar, { maxFileBytes: 1000, maxFiles: 100 });
    assert.deepStrictEqual(allPaths, ['big.js', 'small.js']);
    assert.strictEqual(entries.has('big.js'), false);
    assert.strictEqual(entries.has('small.js'), true);
  });
});

describe('repo-snapshot — fetchPublicRepoSnapshot', () => {
  it('builds the anonymous codeload URL (no api.github.com, no token)', () => {
    assert.strictEqual(tarballUrl('o', 'r', 'HEAD'), 'https://codeload.github.com/o/r/tar.gz/HEAD');
    assert.strictEqual(tarballUrl('o', 'r'), 'https://codeload.github.com/o/r/tar.gz/HEAD');
  });

  it('returns paths + decoded contents from a gzipped tarball', async () => {
    const gz = zlib.gzipSync(buildTar([['r-1/README.md', '# hi'], ['r-1/lib/x.py', 'print(1)']]));
    const snap = await fetchPublicRepoSnapshot('o', 'r', 'HEAD', { fetchImpl: fakeFetch(200, gz) });
    assert.deepStrictEqual(snap.paths, ['README.md', 'lib/x.py']);
    assert.strictEqual(snap.contents.get('lib/x.py'), 'print(1)');
    assert.strictEqual(snap.source, 'tarball');
    assert.strictEqual(snap.truncated, false);
    assert.strictEqual(snap.warning, null);
  });

  it('turns a 404 into a caller-facing "private or missing" error', async () => {
    await assert.rejects(
      fetchPublicRepoSnapshot('o', 'r', 'HEAD', { fetchImpl: fakeFetch(404, Buffer.alloc(0)) }),
      /not found \(404\).*private, does not exist/
    );
  });

  it('refuses archives over the byte cap before downloading them', async () => {
    const gz = zlib.gzipSync(buildTar([['r/a', 'x']]));
    await assert.rejects(
      fetchPublicRepoSnapshot('o', 'r', 'HEAD', {
        fetchImpl: fakeFetch(200, gz, { 'content-length': String(10 * 1024 * 1024) }),
        maxBytes: 1024,
      }),
      /over the 1024-byte snapshot cap/
    );
  });

  it('rejects owner/repo names that could smuggle path segments', async () => {
    await assert.rejects(fetchPublicRepoSnapshot('../evil', 'r'), /invalid repository name/);
    await assert.rejects(fetchPublicRepoSnapshot('o', 'r/../../x'), /invalid repository name/);
  });

  it('reports a warning when the file cap truncates the snapshot', async () => {
    const gz = zlib.gzipSync(buildTar([['r/a.js', '1'], ['r/b.js', '2']]));
    const snap = await fetchPublicRepoSnapshot('o', 'r', 'HEAD', { fetchImpl: fakeFetch(200, gz), maxFiles: 1 });
    assert.strictEqual(snap.truncated, true);
    assert.match(snap.warning, /more than 1 text files/);
  });
});

describe('repo-snapshot — wiring contract (KI #100/#101 must not regress)', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'website', 'app', rel), 'utf8');

  it('gluecron-client falls back to the public snapshot for BOTH tree and blob reads', () => {
    const src = read('lib/gluecron-client.ts');
    assert.match(src, /require\(["']\.\/repo-snapshot["']\)/);
    // tree: snapshot tried after github + gluecron, before throwing
    assert.match(src, /const snap = await publicSnapshot\(owner, repo, ref\);[\s\S]*?return \{ paths: snap\.paths/);
    // blob: snapshot lookup is the terminal fallback, not `return ""`
    assert.match(src, /return snap\.contents\.get\(filePath\) \|\| ""/);
    // a failed download is never memoised
    assert.match(src, /promise\.catch\(\(\) => snapshotMemo\.delete\(key\)\)/);
  });

  it('the free preview, playground stream and paid run no longer refuse a public repo when no token exists', () => {
    for (const rel of ['api/scan/preview/route.ts', 'api/playground/scan/stream/route.ts', 'api/scan/run/route.ts']) {
      const src = read(rel);
      assert.doesNotMatch(src, /if \(!token\) \{[\s\S]{0,300}(status: 403|Cannot access)/,
        `${rel} still dead-ends on a missing token`);
      assert.match(src, /const token = auth\.token \|\| ""/, `${rel} should proceed with an empty token`);
    }
  });
});
