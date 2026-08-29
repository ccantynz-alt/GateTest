'use strict';

/**
 * Tests for `src/core/cli-args.js` — the CLI argument parser.
 *
 * THE BUG BEING PREVENTED (found 2026-08-29 against the shipped CLI):
 *   The parser was an `else if` chain with NO final `else`, so any token it
 *   did not recognise was silently discarded:
 *
 *     $ gatetest --suite quick --report-only --path /nope --bogus-flag-abc
 *     (a completely normal scan; not one word about either unknown flag)
 *
 *   For a tool whose job is refusing to let bad things through, silently
 *   ignoring the operator's instructions is the worst failure mode there is.
 *   The dangerous cases are the quiet ones:
 *     - `--report-onlyy` runs a BLOCKING scan when advisory was asked for.
 *     - `--strictt` does NOT enforce: a green that cannot turn red.
 *     - `--suite=quick` was dropped whole, silently running the DEFAULT suite.
 *     - `--suite` with no value was dropped, silently running the default.
 *     - `--suite --report-only` set suite="--report-only" AND swallowed
 *       --report-only: two silent wrongs from one omitted word.
 *
 *   It survived because `bin/gatetest.js` calls main() at import and exports
 *   nothing, so the parser was structurally untestable. Extracting it is
 *   half the fix; these tests are the other half.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseArgs,
  describeArgProblems,
  suggestFlag,
  KNOWN_FLAGS,
  FLAG_SPEC,
} = require('../src/core/cli-args');

// ---------------------------------------------------------------------------
// REGRESSION — the exact shapes that used to vanish.
// ---------------------------------------------------------------------------

test('an unknown flag is reported, not swallowed', () => {
  const args = parseArgs(['--bogus-flag-abc']);
  assert.equal(args.unknownArgs.length, 1);
  assert.equal(args.unknownArgs[0].arg, '--bogus-flag-abc');
});

test('a typo is reported WITH the flag it was probably meant to be', () => {
  const args = parseArgs(['--report-onlyy']);
  assert.equal(args.unknownArgs[0].suggestion, '--report-only');
  // ...and crucially it did NOT quietly enable the real flag.
  assert.equal(args.reportOnly, undefined);
});

test('a near-miss on the gate-enforcing flag is caught (green that cannot turn red)', () => {
  const args = parseArgs(['--strictt']);
  assert.equal(args.strict, undefined, 'must not silently enable');
  assert.equal(args.unknownArgs[0].suggestion, '--strict');
});

test('--flag=value is honoured instead of dropped', () => {
  const args = parseArgs(['--suite=quick']);
  assert.equal(args.suite, 'quick');
  assert.equal(args.unknownArgs, undefined);
});

test('a value flag with no value is reported, not silently defaulted', () => {
  const args = parseArgs(['--suite']);
  assert.deepEqual(args.missingValues, ['--suite']);
  assert.equal(args.suite, undefined);
});

test('a value flag does not swallow the following flag', () => {
  const args = parseArgs(['--suite', '--report-only']);
  assert.deepEqual(args.missingValues, ['--suite']);
  assert.equal(args.suite, undefined, 'must not take "--report-only" as a suite name');
  assert.equal(args.reportOnly, true, '--report-only must still be applied');
});

test('a legitimate value that starts with a dash still works', () => {
  // Only a KNOWN flag token marks the boundary, so this must not regress.
  const args = parseArgs(['--crawl-header', '-X-Custom: 1']);
  assert.deepEqual(args.crawlHeaders, ['-X-Custom: 1']);
  assert.equal(args.missingValues, undefined);
});

test('a boolean flag given a value says so rather than guessing', () => {
  const args = parseArgs(['--strict=false']);
  assert.equal(args.strict, undefined, 'must not read "=false" as enabling');
  assert.equal(args.invalidValues[0].arg, '--strict');
});

// ---------------------------------------------------------------------------
// BEHAVIOUR PRESERVATION — the parser must still parse everything it did.
// ---------------------------------------------------------------------------

test('booleans, values, appends and aliases all parse', () => {
  const args = parseArgs([
    '--report-only', '--all', '-h',
    '--suite', 'quick',
    '--project', '/tmp/x',
    '--skip-module', 'a', '--skip-module', 'b',
    '--crawl-header', 'A: 1', '--crawl-header', 'B: 2',
  ]);
  assert.equal(args.reportOnly, true);
  assert.equal(args.all, true);
  assert.equal(args.help, true);
  assert.equal(args.suite, 'quick');
  assert.equal(args.project, '/tmp/x');
  assert.deepEqual(args.skipModules, ['a', 'b']);
  assert.deepEqual(args.crawlHeaders, ['A: 1', 'B: 2']);
  assert.equal(args.unknownArgs, undefined);
});

test('--stop-first keeps its non-camelCase key', () => {
  // The original chain wrote args['stop-first'], not args.stopFirst. Callers
  // in bin/gatetest.js read that exact key.
  const args = parseArgs(['--stop-first']);
  assert.equal(args['stop-first'], true);
});

test('--doctor-quick sets both doctor and doctorQuick', () => {
  const args = parseArgs(['--doctor-quick']);
  assert.equal(args.doctor, true);
  assert.equal(args.doctorQuick, true);
});

test('numeric flags parse and reject junk instead of setting NaN', () => {
  assert.equal(parseArgs(['--crawl-max', '25']).crawlMax, 25);
  const bad = parseArgs(['--crawl-max', 'abc']);
  assert.equal(bad.crawlMax, undefined);
  assert.equal(bad.invalidValues[0].arg, '--crawl-max');
});

test('--confidence-threshold accepts 0..1 and rejects anything else', () => {
  assert.equal(parseArgs(['--confidence-threshold', '0.75']).confidenceThreshold, 0.75);
  for (const bad of ['1.5', '-0.2', 'high']) {
    const args = parseArgs(['--confidence-threshold', bad]);
    assert.equal(args.confidenceThreshold, undefined, bad);
    assert.equal(args.invalidValues.length, 1, bad);
  }
});

test('an empty argv yields no args and no complaints', () => {
  const args = parseArgs([]);
  assert.deepEqual(args, {});
  assert.deepEqual(describeArgProblems(args), []);
});

// ---------------------------------------------------------------------------
// REPORTING
// ---------------------------------------------------------------------------

test('describeArgProblems is silent when everything was understood', () => {
  assert.deepEqual(describeArgProblems(parseArgs(['--all', '--suite', 'quick'])), []);
});

test('describeArgProblems names the flag, the problem, and the consequence', () => {
  const lines = describeArgProblems(parseArgs(['--suite', '--bogus']));
  const joined = lines.join('\n');
  assert.match(joined, /--suite/);
  assert.match(joined, /needs a value/);
  assert.match(joined, /--bogus/);
  assert.match(joined, /unknown option/);
  assert.match(joined, /--help/, 'should point at the full option list');
});

test('suggestFlag stays quiet when nothing is genuinely close', () => {
  assert.equal(suggestFlag('--zzzzzzzzzzzz'), null);
});

// ---------------------------------------------------------------------------
// RATCHET — the flag table is the single source of truth.
//
// A hand-maintained second list of "known flags" is exactly the duplicated-
// helper trap KI #77 documents, so assert the table and the help text agree.
// ---------------------------------------------------------------------------

test('every flag in the table is documented in --help', () => {
  const help = fs.readFileSync(
    path.resolve(__dirname, '..', 'bin', 'gatetest.js'),
    'utf8'
  );
  const undocumented = KNOWN_FLAGS.filter(
    (f) => f.startsWith('--') && !help.includes(f)
  );
  assert.deepEqual(
    undocumented,
    [],
    `flags the parser accepts but --help never mentions: ${undocumented.join(', ')}`
  );
});

test('bin/gatetest.js no longer defines its own parser', () => {
  const bin = fs.readFileSync(
    path.resolve(__dirname, '..', 'bin', 'gatetest.js'),
    'utf8'
  );
  assert.ok(
    !/function\s+parseArgs\s*\(/.test(bin),
    'bin/gatetest.js re-declared parseArgs — import it from src/core/cli-args ' +
      'instead. A copy in the bin is unreachable from every test, which is ' +
      'exactly how the silent unknown-flag bug shipped.'
  );
  assert.ok(
    /require\(['"]\.\.\/src\/core\/cli-args['"]\)/.test(bin),
    'bin/gatetest.js must use the shared parser'
  );
});

test('the flag table has no duplicate tokens', () => {
  const seen = new Set();
  const dupes = [];
  for (const spec of FLAG_SPEC) {
    for (const f of spec.flags) {
      if (seen.has(f)) dupes.push(f);
      seen.add(f);
    }
  }
  assert.deepEqual(dupes, [], `a token is claimed by two specs: ${dupes.join(', ')}`);
});

test('every spec declares a key and a known type', () => {
  const types = new Set(['boolean', 'value', 'append', 'int', 'float01']);
  for (const spec of FLAG_SPEC) {
    assert.ok(spec.key, `missing key: ${spec.flags.join(',')}`);
    assert.ok(types.has(spec.type), `bad type "${spec.type}" on ${spec.flags.join(',')}`);
    assert.ok(Array.isArray(spec.flags) && spec.flags.length > 0);
  }
});
