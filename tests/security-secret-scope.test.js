// =============================================================================
// security:secret — a fixture is not a leak, and a label is not a credential
// =============================================================================
// Measured on django/django @b3f4d83 (2026-09-05): 76 blocking
// `security:secret` findings. 74 were `password='secret'`-shaped fixtures
// under tests/. The other two were
//   INTERNAL_RESET_SESSION_TOKEN = "_password_reset_token"
//   reset_url_token = "set-password"
// — a session-key name and a URL slug. Nobody's secret is the word
// "password".
//
// The patterns split the way secrets.js already splits them. VENDOR-SHAPED
// (AKIA…, ghp_…, a JWT, a PEM) is a credential anywhere: a test file does
// not make an AWS key fake, so those keep blocking in tests. IDENTIFIER-
// KEYED matches on the NAME, and the name is what fixtures are made of, so
// those drop to warning inside test trees and skip a value that names the
// credential type.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const SecurityModule = require('../src/modules/security');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sec-scope-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function secretsIn(rel, source) {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
  fs.writeFileSync(f, source);
  const result = makeResult();
  await new SecurityModule().run(result, { projectRoot: tmp });
  return result.checks.filter((c) => !c.passed && c.name.startsWith('security:secret:'));
}

// Assembled at runtime so push protection does not reject the test file.
const AWS = 'AKIA' + 'I0SFODNN7REALKEY';

describe('security:secret — identifier-keyed patterns in a test tree', () => {
  it('a password fixture in tests/ is a warning, not a build verdict', async () => {
    const found = await secretsIn('tests/auth_tests/test_views.py', "self.client.login(username='u', password='hunter2abc')\n");
    assert.ok(found.length > 0, 'still reported — a fixture is still worth seeing');
    assert.strictEqual(found[0].severity, 'warning');
  });

  it('the same line in application code is an error', async () => {
    const found = await secretsIn('app/auth.py', "login(username='u', password='hunter2abc')\n");
    assert.ok(found.length > 0);
    assert.notStrictEqual(found[0].severity, 'warning');
  });

  it('a vendor-shaped key in a test tree STILL blocks', async () => {
    // The load-bearing half. Downgrading everything in tests/ would turn the
    // test tree into the one place a real key can hide.
    const found = await secretsIn('tests/fixtures/keys.py', `AWS_KEY = "${AWS}"\n`);
    assert.ok(found.length > 0, 'an AWS key must be found in a test file');
    assert.notStrictEqual(found[0].severity, 'warning', 'and must not be softened by the path');
  });
});

describe('security:secret — a value that names a credential is a label', () => {
  it('a session-key name is not a token', async () => {
    const found = await secretsIn('app/views.py', 'INTERNAL_RESET_SESSION_TOKEN = "_password_reset_token"\n');
    assert.deepStrictEqual(found, []);
  });

  it('a URL slug is not a token', async () => {
    const found = await secretsIn('app/views.py', 'reset_url_token = "set-password"\n');
    assert.deepStrictEqual(found, []);
  });

  it('the bare word "secret" — the Django fixture — is a label', async () => {
    const found = await secretsIn('app/settings.py', 'SECRET_KEY = "secret"\n');
    assert.deepStrictEqual(found, []);
  });

  it('a value that merely CONTAINS a credential word still fires', async () => {
    // The first cut of the label rule was a substring test and skipped these.
    for (const v of ['mysecretkey2024', 'secretpass1', 'tokenABC123xyz']) {
      const found = await secretsIn('app/views.py', `password = "${v}"\n`);
      assert.ok(found.length > 0, `${v} must still be reported`);
    }
  });

  it('a real-looking value under the same name still fires', async () => {
    // Negative control for the label check: the exemption is about the
    // VALUE naming a credential, not about the variable being called token.
    const found = await secretsIn('app/views.py', 'reset_url_token = "k8f2Ls9qPzX1mN4v"\n');
    assert.ok(found.length > 0);
  });
});
