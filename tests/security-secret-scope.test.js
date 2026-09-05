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

// ---------------------------------------------------------------------------
// prisma/prisma @ HEAD (2026-09-05): 12 `security:secret`, five blocking, all
// development defaults — `postgres:postgres@127.0.0.1`, `user:password@
// localhost`, a `'jwtSecret' in options` property test. trpc: the Algolia
// DocSearch search-only key every Docusaurus site commits.
// ---------------------------------------------------------------------------

describe('security:secret — a development-default connection string is not a leak', () => {
  it('user == password on a loopback / single-label host is quiet', async () => {
    const lines = [
      // prisma packages/1-framework/3-tooling/cli/scripts/record.ts:171
      "const DEFAULT_CONN = 'postgres://postgres:postgres@127.0.0.1:5433/postgres';",
      // prisma examples/prisma-8-demo/fixtures/diamond/prisma.config.ts:8
      "      connection: 'postgresql://diamond:diamond@localhost:5432/diamond',",
      // docker-compose service host
      'DATABASE_URL=mysql://root:root@db:3306/app',
    ];
    for (const line of lines) {
      assert.deepStrictEqual(await secretsIn('scripts/record.ts', `${line}\n`), [], line);
    }
  });

  it('the password being the word "password" is quiet whatever the host', async () => {
    // prisma packages/1-framework/3-tooling/cli/src/commands/init/templates/env.ts:41
    const found = await secretsIn('src/templates/env.ts', 'lines.push(\'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\');\n');
    assert.deepStrictEqual(found, []);
    assert.deepStrictEqual(await secretsIn('src/db.js', "const u = 'postgres://app:secret@db.example.com/app';\n"), []);
  });

  it('a default credential on a REACHABLE host still fires', async () => {
    const found = await secretsIn('src/db.js', "const u = 'postgres://postgres:postgres@db.example.com:5432/app';\n");
    assert.strictEqual(found.length, 1);
  });

  it('a distinct password on localhost still fires', async () => {
    const found = await secretsIn('src/db.js', "const u = 'postgres://admin:hunter2pass@localhost:5432/app';\n");
    assert.strictEqual(found.length, 1);
  });
});

describe('security:secret — a quoted property NAME under `in` is not a value', () => {
  it('prisma supabase.ts:183 is quiet', async () => {
    // prisma packages/3-extensions/supabase/src/runtime/supabase.ts:183
    const found = await secretsIn('src/runtime/supabase.ts', "  const jwtSecret = 'jwtSecret' in options ? options.jwtSecret : undefined;\n");
    assert.deepStrictEqual(found, []);
  });

  it('the same identifier assigned a real value still fires', async () => {
    const found = await secretsIn('src/runtime/supabase.ts', "  const jwtSecret = 'jwtSecretValue2024x';\n");
    assert.strictEqual(found.length, 1);
  });
});

describe('security:secret — the Algolia DocSearch search-only key', () => {
  const algolia = [
    '    algolia: {',
    "      appId: 'BTGPSR4MOE',",
    // trpc/trpc www/docusaurus.config.ts:48 (key shape preserved, value not)
    "      apiKey: 'ed8b389f2a5b4c6d7e8f9a0b1c2d3e4f',",
    "      indexName: 'trpc',",
    '    },',
  ];

  it('inside an `algolia: {` block is quiet', async () => {
    const found = await secretsIn('www/docusaurus.config.ts', `${algolia.join('\n')}\n`);
    assert.deepStrictEqual(found, []);
  });

  it('the same apiKey outside that block still fires', async () => {
    const found = await secretsIn('www/docusaurus.config.ts', `    search: {\n${algolia.slice(1).join('\n')}\n`);
    assert.strictEqual(found.length, 1);
  });
});
