'use strict';
/**
 * ALL-MODULE INERT SWEEP — nothing may report a finding against a file where
 * nothing executes.
 *
 * The fixture is built so that EVERY risky token in it sits inside a string
 * literal, a template literal, or a comment. Nothing in it runs. So any finding
 * whose `file` is that fixture is a false positive BY CONSTRUCTION — no
 * judgement call, no triage, no argument.
 *
 * ── Why this exists as a test rather than an audit ──────────────────────────
 * KI #77 ran this sweep twice by hand and reported "exactly one false positive
 * across all 120 modules". Then KI #48 turned up `ai-hallucination` reporting
 * 105 false findings from precisely this cause — package names inside fixture
 * strings harvested as real imports.
 *
 * Both things were true. The hand-run sweep's fixture simply had no
 * IMPORT-shaped content in it, and `tests/security-inert-patterns.test.js` —
 * the only automated inert check — instantiates `SecurityModule` and nothing
 * else. So the gap was never in the method; it was that the method was a
 * one-off with a blind spot and no ratchet.
 *
 * A one-off audit tells you about the day it ran. This runs on every push, over
 * every registered module, and names the offender when it fails.
 *
 * ── Scope of the assertion, and what is deliberately NOT in the fixture ─────
 * Only findings that name the inert file count. A tiny fixture project legitimately
 * has no README, no lockfile, no tests and no CI config, and modules are right to
 * say so — those are project-level findings, not claims about this file.
 *
 * The fixture holds only CODE-shaped patterns: things that are a defect when they
 * execute and harmless when quoted. Three categories were tried and removed,
 * because flagging them inside a string is CORRECT and the first draft of this test
 * was wrong to call them false positives:
 *
 *   - secrets. `AKIA…` or `password = '…'` inside a string literal IS a committed
 *     secret. A string is where secrets live; that is the whole point of the module.
 *   - URLs, incl. localhost / private-IP / cloud-metadata. A hardcoded URL is
 *     BY DEFINITION a string. `hardcodedUrl` and `ssrf` are right to fire.
 *   - role judgements — `deadCode:unused-export`, `deadCode:orphan-file`. Those
 *     describe the file's place in the project (nothing imports it), not a claim
 *     that its contents run. Fixed by importing the fixture from an entry file
 *     rather than by exempting the rules.
 *
 * One module is exempted outright, `mutation`, and it is the only one:
 * `mutation:survivor` means "your test suite does not kill this mutation." The
 * fixture has no test suite, so every mutant survives by definition. That is a
 * true statement about the fixture, not a false claim about inertness — and
 * shipping a test suite for the fixture purely to silence it would make this
 * sweep slower and less clear for no gain.
 *
 * Keeping them would have forced an exception list, and an exception list is how a
 * guard like this rots into something nobody trusts.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { BUILT_IN_MODULES } = require('../../src/core/registry');

const INERT_BASENAME = 'inert-handbook.js';

/**
 * Every line here is data or a comment. The imports are the shape that slipped
 * past the earlier sweeps: real, well-known package names positioned exactly
 * where a harvester scanning raw text would read them as dependencies.
 */
const INERT_SOURCE = [
  '/**',
  ' * Coding handbook. Everything below is an EXAMPLE, quoted as data.',
  " * Never write: const cp = require('child_process'); cp.exec(userInput);",
  " * Never import: import express from 'express';",
  ' * Never use eval() or el.innerHTML = untrusted.',
  ' */',
  "'use strict';",
  '',
  '// ── imports, as documentation only ────────────────────────────────────────',
  "// const express = require('express');",
  "// import helmet from 'helmet';",
  "// import { OpenAI } from 'openai';",
  '',
  'const IMPORT_EXAMPLES = [',
  '  "const express = require(\'express\');",',
  '  "import fastify from \'fastify\';",',
  '  "const { Pool } = require(\'pg\');",',
  '  "import Anthropic from \'@anthropic-ai/sdk\';",',
  '];',
  '',
  '// Code-shaped only: a defect when executed, harmless when quoted. No secrets',
  '// and no URLs — see the header for why those belong in strings.',
  'const DANGEROUS_EXAMPLES = {',
  '  evalUse:    "eval(userSuppliedString)",',
  '  innerHtml:  "element.innerHTML = untrustedValue",',
  '  docWrite:   "document.write(location.hash)",',
  '  sqlConcat:  "db.query(\'SELECT * FROM t WHERE id = \' + req.params.id)",',
  '  weakHash:   "crypto.createHash(\'md5\').update(input)",',
  '  tlsOff:     "rejectUnauthorized: false",',
  '  cookieBad:  "httpOnly: false",',
  '  moneyFloat: "const total = parseFloat(priceString)",',
  '  emptyCatch: "try { risky(); } catch (e) {}",',
  '  awaitLoop:  "for (const x of xs) { await slow(x); }",',
  '  toctou:     "if (!fs.existsSync(p)) fs.writeFileSync(p, data)",',
  '  fdLeak:     "const fd = fs.openSync(path, \'r\')",',
  '  nPlusOne:   "for (const u of users) { await db.query(\'SELECT 1\'); }",',
  '  retryLoop:  "while (true) { try { await f(); break; } catch (e) {} }",',
  '  naiveDate:  "const m = new Date().getMonth()",',
  '  alwaysTrue: "if (true) { ship(); }",',
  '  flagLie:    "const ENABLE_NEW_CHECKOUT = true",',
  '  logPii:     "console.log(user.password)",',
  '  logBody:    "logger.info(req.body)",',
  '  weakRandom: "const token = Math.random().toString(36)",',
  '  focusedTest:"it.only(\'runs alone\', () => {})",',
  '  skippedTest:"describe.skip(\'suite\', () => {})",',
  '  undefRef:   "return someUndeclaredIdentifier + 1",',
  '  floatingP:  "doAsyncThing();",',
  '  catchSwallow:"promise.catch(() => {})",',
  '  // Shapes chosen from an audit of modules that use a guard on SOME rules only',
  '  // (cross-file-taint, redos, money-float, security had the largest gaps',
  '  // between guard call sites and line-match sites).',
  '  taintFlow:  "app.get(\'/r\', (req, res) => exec(req.query.cmd))",',
  '  taintSink:  "const q = req.body.name; db.query(q);",',
  '  redosRe:    "const re = /(a+)+$/;",',
  '  redosAlt:   "const bad = new RegExp(\'(x|x)*y\');",',
  '  toFixedMoney:"const price = amount.toFixed(2)",',
  '  moneyAdd:   "totalPrice += itemPrice;",',
  '  protoPoll:  "target[userKey] = userValue;",',
  '  pathTrav:   "fs.readFileSync(path.join(dir, req.query.f))",',
  '  insecureDes:"const o = JSON.parse(req.body.payload)",',
  '  tlsEnvOff:  "process.env.NODE_TLS_REJECT_UNAUTHORIZED = \'0\'",',
  '  corsStar:   "app.use(cors({ origin: \'*\' }))",',
  '  jwtNone:    "jwt.verify(t, s, { algorithms: [\'none\'] })",',
  '  execSyncIn: "child_process.execSync(userInput)",',
  '  newFunction:"const f = new Function(userCode)",',
  '  objAssign:  "Object.assign(target, req.body)",',
  '  insertHtml: "el.insertAdjacentHTML(\'beforeend\', userHtml)",',
  '  timeoutStr: "setTimeout(userCodeString, 0)",',
  '  openRedir:  "res.redirect(req.query.next)",',
  '  useEffectNoDep:"useEffect(() => { setCount(c + 1) })",',
  '  graphqlRes: "resolvers: { Query: { user: (_, a, ctx) => db.find(a.id) } }",',
  '  trpcProc:   "t.procedure.input(z.string()).query(({ input }) => db.get(input))",',
  '  spawnShell: "spawn(cmd, { shell: true })",',
  '  vmRun:      "vm.runInNewContext(userScript)",',
  '};',
  '',
  '// A template literal carrying more of the same.',
  'const SNIPPET = [',
  '  "const cp = require(\'child_process\');",',
  '  "cp.exec(cmd);",',
  '].join("\\n");',
  '',
  'function describe() {',
  '  return { IMPORT_EXAMPLES, DANGEROUS_EXAMPLES, SNIPPET };',
  '}',
  '',
  'module.exports = { describe };',
].join('\n');

/** Imports the fixture, so role judgements (orphan file, unused export) don't fire. */
const ENTRY_SOURCE = [
  "'use strict';",
  `const handbook = require('./${INERT_BASENAME.replace(/\.js$/, '')}');`,
  '',
  'function main() {',
  '  return handbook.describe();',
  '}',
  '',
  'main();',
  'module.exports = { main };',
].join('\n');

let root;
const findings = new Map(); // module name -> finding names against the inert file
let ran = 0;                // modules that actually executed
let skipped = 0;            // modules that could not load or run here

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-inert-'));

  // A minimal-but-plausible project, so modules judge the FILE rather than
  // complaining that the project is empty.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'inert-fixture', version: '1.0.0', private: true,
    description: 'Fixture whose every risky token is inert.',
    scripts: { test: 'node --test' },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), '# Inert fixture\n\nNothing here executes.\n');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', INERT_BASENAME), INERT_SOURCE);
  fs.writeFileSync(path.join(root, 'src', 'index.js'), ENTRY_SOURCE);

  const CORE_DIR = path.join(__dirname, '..', '..', 'src', 'core');

  // See the header: a surviving mutant is a true statement about a fixture with
  // no tests, not a false claim that quoted code executes.
  const EXEMPT = new Set(['mutation']);

  for (const [name, rel] of Object.entries(BUILT_IN_MODULES)) {
    if (EXEMPT.has(name)) { skipped += 1; continue; }
    let ModuleClass;
    try {
      // BUILT_IN_MODULES paths are relative to src/core (e.g. '../modules/x.js'),
      // so resolve them FROM that directory. Resolving them any other way silently
      // fails every require and turns this whole sweep into a vacuous pass — which
      // is exactly what the first version of this test did.
      ModuleClass = require(path.resolve(CORE_DIR, rel));
    } catch {
      skipped += 1;
      continue; // unloadable here (optional dep) — other tests cover loading
    }

    const checks = [];
    const result = { checks, addCheck(n, passed, meta) { checks.push({ name: n, passed, ...meta }); } };
    try {
      // getModuleConfig is part of the config contract (src/core/config.js). A bare
      // object without it throws, and the catch below silently dropped the module —
      // which had excluded 12 real modules (codeQuality, seo, performance, apiHealth,
      // visualRegression, chaos, explorer, liveCrawler, …) from this sweep while it
      // reported clean. Found by listing what actually RAN rather than trusting the
      // count, which is the same vacuity trap as the earlier 175ms pass.
      await new ModuleClass().run(result, {
        projectRoot: root,
        projectPath: root,
        getModuleConfig: () => ({}),
        modules: {},
        thresholds: {},
      });
      ran += 1;
    } catch {
      skipped += 1;
      continue; // genuinely needs a browser / network / API key
    }

    const hits = checks
      .filter((c) => c.passed === false)
      .filter((c) => {
        const f = String(c.file || '').split('\\').join('/');
        return f.endsWith(`src/${INERT_BASENAME}`) || f.endsWith(INERT_BASENAME);
      })
      .map((c) => `${c.severity || '?'} ${c.name}`);

    if (hits.length) findings.set(name, hits);
  }
});

after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ } // error-ok
});

describe('inert fixture — no module may flag a file where nothing runs', () => {
  it('actually EXECUTED most modules (guards against a vacuous pass)', () => {
    // The first version of this test asserted only that the registry was large,
    // which said nothing about whether a single module ran. A broken require path
    // skipped all 121 and the sweep passed in 175ms while checking nothing.
    // Assert the thing that matters: modules ran.
    const total = Object.keys(BUILT_IN_MODULES).length;
    assert.ok(total > 100, `registry only exposed ${total} modules`);
    assert.ok(ran > 100,
      `only ${ran} of ${total} modules executed (${skipped} skipped) — the sweep is not covering enough to mean anything. Baseline was 116 of 121 when this floor was set; a drop usually means a config-contract change is silently dropping modules into the catch.`);
  });

  it('reports no ERROR-severity finding against the inert file', () => {
    const errors = [];
    for (const [mod, hits] of findings) {
      for (const h of hits) if (h.startsWith('error') || h.startsWith('critical')) errors.push(`${mod}: ${h}`);
    }
    assert.deepStrictEqual(errors, [],
      'An error-severity finding on a file where nothing executes BLOCKS a build for no reason — '
      + 'Bible Forbidden #25. Add a string/comment guard: this.\u005FisCommentLine(line) and '
      + 'this.\u005FisInsideStringLiteral(line, column). See src/modules/ai-hallucination.js for the column-based form.');
  });

  it('reports no finding of ANY severity against the inert file', () => {
    const all = [];
    for (const [mod, hits] of findings) for (const h of hits) all.push(`${mod}: ${h}`);
    assert.deepStrictEqual(all, [],
      'Warnings on inert content are the noise that makes teams stop reading output. '
      + 'If a finding here is genuinely correct, narrow this fixture rather than widening the exception.');
  });
});
