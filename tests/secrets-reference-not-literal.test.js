/**
 * A value that READS a secret is not a value that CONTAINS one.
 *
 * This false positive blocked GateTest's own CI (`GateTest Full Scan (Push to
 * main)`) for days on a single finding: `secrets:scripts/deploy/tick.sh`.
 * That line reads the secret out of a file with a command substitution — the
 * safe pattern we tell customers to use — and the rule matched `SECRET="`
 * followed by eight-plus characters.
 *
 * The negative controls are the important half: a secrets module must fail
 * toward detection, so anything that is a real literal must still be caught,
 * including a value that merely contains a `$` somewhere after the start.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SecretsModule = require('../src/modules/secrets');

function scanFile(tmp, filename, body) {
  fs.writeFileSync(path.join(tmp, filename), body);
  const checks = [];
  const result = { checks, addCheck(name, passed, d = {}) { checks.push({ name, passed, ...d }); } };
  return { result, checks };
}

describe('secrets: references vs literals', () => {
  let mod, tmp;
  beforeEach(() => {
    mod = new SecretsModule();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-secref-'));
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const ref = (s) => mod._looksLikeReference(s);

  it('the exact line that blocked our own CI is not a secret', () => {
    assert.strictEqual(ref(`SECRET="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE")`), true);
  });

  it('recognises the common indirection forms', () => {
    assert.strictEqual(ref('SECRET="${CRON_SECRET}'), true);
    assert.strictEqual(ref('password="$DB_PASSWORD'), true);
    assert.strictEqual(ref('token="`cat /run/token`'), true);
    assert.strictEqual(ref('api_key="process.env.API_KEY'), true);
    assert.strictEqual(ref('secret="os.environ[X]'), true);
    assert.strictEqual(ref('password="%DB_PASS%'), true);
  });

  it('NEGATIVE CONTROL: a real literal is still a secret', () => {
    assert.strictEqual(ref('password="hunter2correcthorse'), false);
    assert.strictEqual(ref('api_key="AKIAIOSFODNN7EXAMPLE'), false);
    assert.strictEqual(ref('secret="sk_live_51H8xQ2abcdefghij'), false);
  });

  it('NEGATIVE CONTROL: a $ later in the value does not excuse it', () => {
    // Only a value that STARTS with an expansion is a reference. A literal
    // that happens to contain a dollar sign is still a literal.
    assert.strictEqual(ref('password="p4ssw0rd$with$dollars'), false);
  });

  it('end-to-end: a shell script reading a secret produces no finding', async () => {
    const { result, checks } = scanFile(tmp, 'deploy.sh', [
      '#!/usr/bin/env bash',
      'ENV_FILE=/etc/app.env',
      'SECRET="$(sed -n \'s/^CRON_SECRET=//p\' "$ENV_FILE" | head -n1)"',
      'curl -H "Authorization: Bearer $SECRET" https://example.com/tick',
      '',
    ].join('\n'));

    await mod.run(result, { projectRoot: tmp });

    const hits = checks.filter(c => !c.passed && /^secrets:.*deploy\.sh/.test(c.name));
    assert.deepStrictEqual(hits, [], 'reading a secret from a file must not be reported as hardcoding one');
  });

  it('NEGATIVE CONTROL end-to-end: a hardcoded secret in a shell script IS reported', async () => {
    const { result, checks } = scanFile(tmp, 'bad.sh', [
      '#!/usr/bin/env bash',
      'SECRET="s3cr3t-literal-value-here-9f2a"',
      '',
    ].join('\n'));

    await mod.run(result, { projectRoot: tmp });

    const hits = checks.filter(c => !c.passed && /^secrets:.*bad\.sh/.test(c.name));
    assert.strictEqual(hits.length, 1, 'a genuine hardcoded secret must still be caught');
  });
});
