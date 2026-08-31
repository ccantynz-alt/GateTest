/**
 * A skip that guarded nothing and silenced real findings.
 *
 * `datetime-bug` Rule 5 flags `moment()` called without `.tz(...)` — it
 * silently uses local time. Above that check sat a whole-line skip on any line
 * containing the words import or require, added to avoid firing on
 * `import moment from 'moment'`.
 *
 * It could never have fired on an import. MOMENT_CALL_RE is /\bmoment\s*\(/ —
 * an import specifier is `'moment'`, a require is `require('moment')`, and
 * neither contains `moment` followed by an opening paren. So the guard
 * protected against a case that does not exist.
 *
 * What it DID do, measured on a fixture before removal:
 *
 *     const h = require('./helper'); const t = moment();   // silenced
 *     const u = moment();                                  // reported
 *
 * Identical bug, one reported and one not, decided by whether the word
 * "require" appeared elsewhere on the line. Same class as the two blanket
 * skips removed from the secrets module the same day, and the reason
 * tests/suppression-controls.test.js now exists.
 *
 * The negative controls carry equal weight: if removing the skip made real
 * import lines start firing, that would be a new false positive and the
 * removal would be wrong.
 */

'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DatetimeBugModule = require('../src/modules/datetime-bug');

function scan(mod, body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dt-'));
  fs.writeFileSync(path.join(tmp, 'probe.js'), body);
  const checks = [];
  const result = { checks, addCheck(n, p, d = {}) { checks.push({ name: n, passed: p, ...d }); } };
  return Promise.resolve(mod.run(result, { projectRoot: tmp })).then(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    return checks
      .filter((c) => !c.passed && c.name.includes('moment-no-tz'))
      .map((c) => c.line);
  });
}

describe('datetime-bug: the import/require skip guarded nothing', () => {
  let mod;
  beforeEach(() => { mod = new DatetimeBugModule(); });

  it('POSITIVE CONTROL: a real moment() still fires when the line also says require', async () => {
    const lines = await scan(mod,
      `const h = require('./helper'); const t = moment();\n`);
    assert.deepStrictEqual(lines, [1],
      'a genuine untimezoned moment() must be reported even when the line mentions require');
  });

  it('POSITIVE CONTROL: a plain untimezoned moment() fires', async () => {
    const lines = await scan(mod, `const u = moment();\n`);
    assert.deepStrictEqual(lines, [1]);
  });

  it('NEGATIVE: import and require statements produce nothing', async () => {
    const lines = await scan(mod, [
      `const moment = require('moment');`,
      `import moment2 from 'moment';`,
      ``,
    ].join('\n'));
    assert.deepStrictEqual(lines, [],
      'removing the skip must not make import/require statements start firing');
  });

  it('NEGATIVE: correct .tz() usage is never reported', async () => {
    const lines = await scan(mod, `const v = moment.tz('UTC');\n`);
    assert.deepStrictEqual(lines, []);
  });
});
