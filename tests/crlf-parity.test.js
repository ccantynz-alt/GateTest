/**
 * CRLF parity — a scan must produce identical findings on a CRLF checkout
 * and an LF one.
 *
 * This is the invariant KI #49 and KI #77 were both really about. Rather
 * than convert every `.split('\n')` by hand and hope, this asserts the
 * property directly: same bytes, different line endings, same findings.
 *
 * WHY THIS EXISTS INSTEAD OF 22 MORE CONVERSIONS. 52 analysis-only modules
 * were converted mechanically (see tests/crlf-safety.test.js). The
 * remaining 22 all pair their split with a `.join('\n')`, so converting
 * them risks silently rewriting a customer's line endings — real downside.
 * Measured upside: none. Three separate measurements found zero
 * line-ending sensitivity anywhere in the engine:
 *
 *   1. a hand-built fixture repo, quick suite          — identical
 *   2. src/core (54 files) LF vs CRLF, full suite      — 87 module runs, identical
 *   3. website/app/lib LF vs CRLF, full suite          — 87 module runs, identical
 *
 * Root cause of the non-effect: the `$`-anchored rules here are nearly all
 * written `/...\s*$/`, and `\s` matches `\r`; the `endsWith` checks trim
 * first; and most anchored patterns match FILE PATHS, which never carry a
 * carriage return. The codebase was accidentally CRLF-tolerant.
 *
 * So this test guards the property that actually matters and lets the
 * remaining 22 conversions stay undone until something here goes red.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { GateTestRunner } = require('../src/core/runner');

// Deliberately dense: every line below is shaped to trip at least one rule,
// and several use the constructs a trailing \r would break — `$`-anchored
// matches, endsWith-style tails, and content at end-of-line.
const FIXTURE = {
  'package.json': '{"name":"crlf-parity","version":"1.0.0"}\n',
  '.env.example': 'API_KEY=\nDATABASE_URL=\n',
  'src/app.js': [
    'const BASE = "http://localhost:3000/api";',
    'function build(userInput) {',
    '  const q = "SELECT * FROM t WHERE id = " + userInput;',
    '  const t = `SELECT * FROM u WHERE id = ${userInput}`;',
    '  return [q, t];',
    '}',
    'async function fetchAll(ids) {',
    '  for (const id of ids) {',
    '    await fetch(BASE + "/" + id);',
    '  }',
    '}',
    'function risky() {',
    '  try { build(1); } catch (e) {}',
    '}',
    'const pwd = "hunter2hunter2";',
    'let total = 0.1 + 0.2;',
    'module.exports = { build, fetchAll, risky, pwd, total };',
    '',
  ].join('\n'),
  'src/retry.js': [
    'async function withRetry(fn) {',
    '  for (let attempt = 0; attempt < 5; attempt++) {',
    '    try { return await fn(); } catch (e) { /* swallow */ }',
    '    await new Promise((r) => setTimeout(r, 250));',
    '  }',
    '}',
    'module.exports = { withRetry };',
    '',
  ].join('\n'),
};

function writeTree(root, eol) {
  for (const [rel, body] of Object.entries(FIXTURE)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body, 'utf8');
  }
}

// A spread of modules that read source line-by-line, including several of
// the 22 that still use a bare split (errorSwallow, retryHygiene, nPlusOne,
// raceCondition, ssrf, codeQuality, hardcodedUrl).
const MODULES = [
  ['hardcodedUrl', '../src/modules/hardcoded-url'],
  ['errorSwallow', '../src/modules/error-swallow'],
  ['retryHygiene', '../src/modules/retry-hygiene'],
  ['moneyFloat', '../src/modules/money-float'],
  ['nPlusOne', '../src/modules/n-plus-one'],
  ['raceCondition', '../src/modules/race-condition'],
  ['ssrf', '../src/modules/ssrf'],
  ['secrets', '../src/modules/secrets'],
  ['codeQuality', '../src/modules/code-quality'],
  ['envVars', '../src/modules/env-vars'],
];

async function scan(eol) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `gt-parity-${eol === '\r\n' ? 'crlf' : 'lf'}-`));
  writeTree(root, eol);
  try {
    const runner = new GateTestRunner({ projectRoot: root }, { projectRoot: root, silent: true });
    const ids = [];
    for (const [id, modPath] of MODULES) {
      // eslint-disable-next-line global-require
      const Mod = require(modPath);
      runner.register(id, new Mod());
      ids.push(id);
    }
    const summary = await runner.run(ids);
    // Compare the FINDING IDENTITIES, not counts — a count match could hide
    // two offsetting differences.
    const findings = [];
    for (const r of summary.results || []) {
      for (const c of r.checks || []) {
        if (c.passed) continue;
        findings.push(`${r.module}|${c.severity}|${String(c.name).replace(/\\/g, '/')}`);
      }
    }
    return findings.sort();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('CRLF parity — line endings must not change what GateTest finds', () => {
  it('a CRLF checkout yields the same findings as an LF one', async () => {
    const lf = await scan('\n');
    const crlf = await scan('\r\n');

    assert.ok(lf.length > 0, 'the fixture must actually produce findings, or this proves nothing');

    const onlyLf = lf.filter((x) => !crlf.includes(x));
    const onlyCrlf = crlf.filter((x) => !lf.includes(x));
    assert.deepStrictEqual(
      { onlyLf, onlyCrlf },
      { onlyLf: [], onlyCrlf: [] },
      'a finding appeared on one line-ending style and not the other — some module '
      + 'is splitting on a bare \\n. Use split(/\\r?\\n/) or src/core/text-lines.js.',
    );
  });

  it('the fixture is dense enough to be a real check', async () => {
    // Guards against the test silently degrading into "0 === 0".
    const lf = await scan('\n');
    assert.ok(lf.length >= 5, `expected several findings, got ${lf.length}`);
  });

  // NEGATIVE CONTROL. A parity test that cannot fail proves nothing, and
  // every real module here turned out to be accidentally CRLF-tolerant —
  // so nothing in the suite would notice if this harness stopped working.
  // This runs a deliberately CRLF-sensitive module through the SAME harness
  // and asserts the difference is detected.
  it('the harness detects a genuinely CRLF-sensitive module', async () => {
    const BaseModule = require('../src/modules/base-module');

    class BareSplitModule extends BaseModule {
      constructor() { super('bareSplit', 'deliberately CRLF-sensitive'); }
      async run(result, config) {
        const fsx = require('fs');
        const p = path.join(config.projectRoot, 'src', 'app.js');
        // The bug shape, on purpose: bare split, then a `$` anchor with no
        // `\s*` in front of it. On CRLF every line ends `\r`, so `;$` never
        // matches and the findings vanish.
        const lines = fsx.readFileSync(p, 'utf8').split('\n');
        lines.forEach((ln, i) => {
          if (/;$/.test(ln)) {
            result.addCheck(`bare-split:semicolon:${i + 1}`, false, {
              severity: 'warning', file: 'src/app.js', line: i + 1, message: 'x',
            });
          }
        });
      }
    }

    async function scanWith(eol) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-parity-neg-'));
      writeTree(root, eol);
      try {
        const runner = new GateTestRunner({ projectRoot: root }, { projectRoot: root, silent: true });
        runner.register('bareSplit', new BareSplitModule());
        const summary = await runner.run(['bareSplit']);
        return (summary.results || []).flatMap((r) => (r.checks || []).filter((c) => !c.passed).map((c) => c.name));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }

    const lf = await scanWith('\n');
    const crlf = await scanWith('\r\n');
    assert.ok(lf.length > 0, 'the control must find something on LF');
    assert.notDeepStrictEqual(
      lf.sort(), crlf.sort(),
      'the harness failed to notice a module that is definitively line-ending sensitive — '
      + 'the parity assertion above is therefore not proving anything',
    );
  });
});
