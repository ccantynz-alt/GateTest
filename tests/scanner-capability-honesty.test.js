'use strict';

/**
 * A missing capability on OUR scanner is never a finding about THEIR site.
 *
 * THE BUG (verified against live production 2026-08-29):
 *   The homepage's primary above-the-fold CTA runs a live URL scan. Its
 *   response led with an ERROR-severity finding:
 *
 *     "Playwright not installed — required for autonomous exploration"
 *
 *   That is a fact about the machine running the scan. It was presented to
 *   the visitor as a defect in the website they had just asked us to check —
 *   the first thing a prospective customer ever saw from the product.
 *
 *   Cause: `explorer.js` and `chaos.js` reported the missing browser with
 *   `result.addCheck(name, false, ...)`, and `addCheck` defaults a FAILING
 *   check to `Severity.ERROR` (src/core/runner.js). So an infrastructure gap
 *   became a top-ranked, gate-blocking finding attributed to the customer.
 *
 *   This is the false-positive direction the Bible calls Forbidden #1, and
 *   it is the worst-placed one in the product: hosted scans frequently
 *   cannot launch Chromium at all, so it fired for essentially every
 *   homepage visitor.
 *
 * The rule these tests pin: when a scanner cannot run a check, it says so as
 * an unavailable capability (passing/INFO) and stays silent about the target.
 * Reporting nothing is correct; inventing a defect is not.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');

/**
 * Phrases that describe OUR runner's environment rather than the scanned
 * target. If one of these appears on a FAILING check, the customer is being
 * told their site is broken because our box is missing something.
 */
const ENVIRONMENT_PHRASES = [
  /not installed/i,
  /is not available on this (?:runner|machine|host)/i,
  /could not load (?:the )?(?:browser|playwright|chromium)/i,
];

/**
 * Collect every `addCheck('name', false, { ... })` call with its details
 * blob, so the message can be inspected. Deliberately a source-level scan:
 * these modules need a live browser or a live target to execute, so a
 * behavioural test cannot reach the branch on every machine — but the
 * property is static and checkable everywhere.
 */
function failingChecks(source) {
  const hits = [];
  const re = /addCheck\(\s*(['"`])([^'"`]+)\1\s*,\s*false\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    hits.push({ name: m[2], details: m[3] });
  }
  return hits;
}

test('no module reports a missing local dependency as a failing check', () => {
  const offenders = [];
  for (const file of fs.readdirSync(MODULES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');
    for (const { name, details } of failingChecks(source)) {
      // Only the message matters; a `suggestion:` telling someone how to
      // install a tool is fine on a legitimate finding.
      const messageMatch = /message:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|\s*\n?\s*'([^']*)')/.exec(details);
      const message = messageMatch
        ? messageMatch[1] || messageMatch[2] || messageMatch[3] || messageMatch[4] || ''
        : '';
      if (!message) continue;
      if (ENVIRONMENT_PHRASES.some((re) => re.test(message))) {
        offenders.push(`${file} :: addCheck('${name}', false) :: "${message.slice(0, 70)}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'A missing tool on the scanner is not a defect in the scanned site. ' +
      'addCheck(..., false) defaults to ERROR severity, so these would be ' +
      'reported to the customer as findings about THEIR code:\n  ' +
      offenders.join('\n  ')
  );
});

test('explorer and chaos skip cleanly when no browser is installed', () => {
  // The two modules that actually need Chromium. Their unavailable-capability
  // branch must be a passing check, and must say the target was not judged.
  for (const file of ['explorer.js', 'chaos.js']) {
    const source = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');

    const branch = /catch\s*\{[\s\S]{0,700}?playwright[\s\S]{0,700}?\}/i.exec(source)
      || /require\('playwright'\)[\s\S]{0,900}?return;/.exec(source);
    assert.ok(branch, `${file}: could not locate the playwright-unavailable branch`);

    assert.ok(
      /playwright-unavailable/.test(source),
      `${file}: the unavailable branch should be named *-playwright-unavailable ` +
        'so it reads as a capability gap, not a defect'
    );
    assert.ok(
      !/addCheck\(\s*['"`][^'"`]*playwright[^'"`]*['"`]\s*,\s*false/i.test(source),
      `${file}: still records the missing browser as a FAILING check — that ` +
        'becomes an ERROR-severity finding about the customer\'s site'
    );
    assert.match(
      source,
      /says nothing about the target site/,
      `${file}: the skip message must state plainly that nothing was checked, ` +
        'so a reader cannot mistake silence for a clean bill of health'
    );
  }
});

test('the skip message never claims the target passed', () => {
  // "Skipped" and "passed" are different facts. A capability we could not run
  // must not read as a clean result — that is the false-NEGATIVE direction,
  // and on a security scan it is the more dangerous of the two.
  for (const file of ['explorer.js', 'chaos.js']) {
    const source = fs.readFileSync(path.join(MODULES_DIR, file), 'utf8');
    const skipMessage = /message:\s*\n?\s*'Skipped ([^']*)'/.exec(source);
    assert.ok(skipMessage, `${file}: expected a "Skipped ..." capability message`);
    const text = skipMessage[0];
    assert.ok(
      !/\b(no issues|clean|passed|secure|all good)\b/i.test(text),
      `${file}: a skipped capability must not imply the target is clean: ${text}`
    );
  }
});
