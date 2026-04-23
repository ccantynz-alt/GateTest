const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HomoglyphModule = require('../src/modules/homoglyph');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new HomoglyphModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('HomoglyphModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-disc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('no-op when nothing to scan', async () => {
    write(tmp, 'README.md', '# hi\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'homoglyph:no-files'));
  });

  it('scans JS / TS / Python / Go / shell / etc.', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'homoglyph:scanning'));
  });
});

describe('HomoglyphModule — bidi-override (Trojan Source)', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-bidi-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on U+202E RLO in source', async () => {
    const evil = 'const role = "admin\u202E}"; // legit';
    write(tmp, 'src/a.ts', evil + '\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('homoglyph:bidi-override:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.ok(hit.codepoints.includes('U+202E'));
  });

  it('errors on U+2066 LRI in source', async () => {
    write(tmp, 'src/a.ts', 'const x = "\u2066hidden\u2069 visible";\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('homoglyph:bidi-override:')));
  });

  it('downgrades to warning in test files', async () => {
    write(tmp, 'tests/a.test.ts', 'const x = "\u202Ebad";\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('homoglyph:bidi-override:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
  });

  it('does NOT flag bidi in locale files', async () => {
    write(tmp, 'locales/ar.po', 'msgstr "\u202Eمرحبا"\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('HomoglyphModule — mixed-script identifier', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-mix-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on Cyrillic `а` (U+0430) inside a Latin identifier', async () => {
    // 'administer' with Cyrillic `а` in position 0
    write(tmp, 'src/a.ts', 'export function \u0430dminister() { return 1; }\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('homoglyph:mixed-script-ident:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
    assert.strictEqual(hit.codepoint, 'U+0430');
  });

  it('errors on Greek `ο` (U+03BF) inside a Latin identifier', async () => {
    // 'loader' with Greek omicron in position 1
    write(tmp, 'src/a.ts', 'const l\u03BFader = 1;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('homoglyph:mixed-script-ident:'));
    assert.ok(hit);
    assert.strictEqual(hit.codepoint, 'U+03BF');
  });

  it('does NOT flag all-Latin identifiers', async () => {
    write(tmp, 'src/a.ts', 'const administer = 1;\nconst load_er = 2;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('does NOT flag pure-Cyrillic identifiers (no mixing)', async () => {
    // All-Cyrillic variable name is legitimate Russian code
    write(tmp, 'src/a.ts', 'const \u0438\u043C\u044F = 1;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:mixed-script-ident:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('does NOT walk into string literals', async () => {
    // Cyrillic inside a string is allowed — only identifiers are scanned
    write(tmp, 'src/a.ts', 'const greeting = "\u041F\u0440\u0438\u0432\u0435\u0442 world";\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:mixed-script-ident:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('does NOT walk into line comments', async () => {
    // Cyrillic inside a // comment is fine
    write(tmp, 'src/a.ts', 'const x = 1; // \u043F\u0440\u0438\u0432\u0435\u0442\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:mixed-script-ident:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('HomoglyphModule — zero-width characters', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-zw-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on U+200B ZWSP inside source', async () => {
    write(tmp, 'src/a.ts', 'const ad\u200Bmin = 1;\n');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name && c.name.startsWith('homoglyph:zero-width:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'warning');
    assert.ok(hit.codepoints.includes('U+200B'));
  });

  it('warns on U+FEFF mid-file', async () => {
    write(tmp, 'src/a.ts', 'const x = 1;\nconst y\uFEFF = 2;\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('homoglyph:zero-width:')));
  });

  it('does NOT flag a BOM on the first byte of the first line', async () => {
    write(tmp, 'src/a.ts', '\uFEFFconst x = 1;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('HomoglyphModule — control chars', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-ctrl-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on bare U+0007 BEL in source', async () => {
    write(tmp, 'src/a.ts', 'const x = "ok\u0007";\n');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name && c.name.startsWith('homoglyph:control-char:')));
  });

  it('does NOT flag tabs, LF, CR', async () => {
    write(tmp, 'src/a.ts', '\tconst x = 1;\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('HomoglyphModule — locale exemption', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-loc-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('does NOT flag any homoglyph in locales/', async () => {
    write(tmp, 'locales/ru.json', '{"hello":"\u041F\u0440\u0438\u0432\u0435\u0442\u202E"}\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });

  it('does NOT flag any homoglyph in i18n/', async () => {
    write(tmp, 'i18n/ar.toml', 'greeting = "\u202Bمرحبا\u202C"\n');
    const r = await run(tmp);
    const hits = r.checks.filter(
      (c) => c.passed === false && c.name && c.name.startsWith('homoglyph:'),
    );
    assert.strictEqual(hits.length, 0);
  });
});

describe('HomoglyphModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-hg-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    write(tmp, 'src/a.ts', 'export const x = 1;\n');
    const r = await run(tmp);
    const s = r.checks.find((c) => c.name === 'homoglyph:summary');
    assert.ok(s);
    assert.match(s.message, /file\(s\).*issue\(s\)/);
  });
});
