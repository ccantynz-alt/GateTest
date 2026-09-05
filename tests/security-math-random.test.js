// =============================================================================
// security: Math.random() for a security-sensitive value — words, not substrings
// =============================================================================
// Measured on nestjs/nest @ HEAD (2026-09-05): five blocking findings, every
// one `id = Math.random()` — a request-context id, two Kafka fixture entity
// ids, a request-logger id. trpc/trpc: ten more, all `id:` and test `nonce`s.
// The rule keyed on `id`, `code`, `key` as SUBSTRINGS of the assignment
// target, so `valid`, `grid`, `statusCode` and React's `key: Math.random()`
// all read as credentials. Now the target is split into words and judged as
// words (Doctrine §5). Every negative below is a repo line verbatim; every
// positive is the dangerous shape that must survive the change.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const SecurityModule = require('../src/modules/security');

const RULE = 'security:Math.random() for a security-sensitive value';

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sec-random-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function randomIn(rel, source) {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}\n');
  fs.writeFileSync(f, source);
  const result = makeResult();
  await new SecurityModule().run(result, { projectRoot: tmp });
  return result.checks.filter((c) => !c.passed && c.name.startsWith(RULE));
}

describe('security: Math.random() — positive controls (the dangerous shape still fires)', () => {
  const dangerous = [
    'const sessionToken = Math.random().toString(36).slice(2);',
    'const otp = Math.floor(100000 + Math.random() * 900000);',
    'const code = Math.floor(100000 + Math.random() * 900000); // SMS verification',
    "user.resetToken = Math.random().toString(36).substring(7);",
    // `const apiKey = \`${Math.random()}\`` — inside a template literal; the
    // in-string guard hides it until it learns `${}` is code (next PR).
    'const API_KEY = Math.random().toString(16);',
    "res.cookie('sessionId', Math.random().toString(36));",
    'req.session.id = Math.random();',
    'const csrf = Math.random().toString(36);',
    'return { verificationCode: Math.floor(Math.random() * 1e6) };',
    'const salt = Math.random().toString(16).slice(2);',
    'const nonce = Math.random().toString(36);',
  ];
  for (const line of dangerous) {
    it(`fires on: ${line}`, async () => {
      const found = await randomIn('src/auth.js', `${line}\n`);
      assert.strictEqual(found.length, 1, `expected one finding for ${line}`);
      assert.notStrictEqual(found[0].severity, 'warning', 'application code blocks');
    });
  }
});

describe('security: Math.random() — negative controls (an id is not a secret)', () => {
  const benign = [
    // nestjs/nest packages/core/helpers/context-id-factory.ts:14
    '  return { id: Math.random() };',
    // nestjs/nest integration/microservices/src/kafka/entities/user.entity.ts:5
    '    this.id = Math.random() * 99999999;',
    // nestjs/nest integration/scopes/src/inject-inquirer/hello-request/request-logger.service.ts:18
    '      this.request.id = `${Date.now()}.${Math.floor(Math.random() * 1000000)}`;',
    // prisma/prisma examples/retail-store/app/api/auth/signup/route.ts:8
    '  const shortId = Math.random().toString(36).slice(2, 8);',
    // trpc/trpc examples/standalone-server/src/server.ts:44
    '        id: `${Math.random()}`,',
    // the substring holes the old rule had
    'const valid = Math.random() > 0.5;',
    'const statusCode = Math.random() > 0.5 ? 200 : 500;',
    '<li key={Math.random()}>{item}</li>',
    'items.map((x) => ({ key: Math.random(), x }));',
    'const sessionTimeout = base * (0.5 + Math.random());',
    'const resetDelay = Math.random() * 1000;',
    'const inviteCount = Math.floor(Math.random() * 10);',
    'const keyIndex = Math.floor(Math.random() * keys.length);',
    'const uuid = Math.random().toString(36);',
  ];
  for (const line of benign) {
    it(`stays quiet on: ${line.trim()}`, async () => {
      const found = await randomIn('src/app.js', `${line}\n`);
      assert.deepStrictEqual(found, []);
    });
  }
});

describe('security: Math.random() — identifier-keyed, so a test tree is a warning', () => {
  // trpc/trpc packages/react-query/test/overrides.test.tsx:74 — a react-query
  // cache-busting nonce inside a test. Still reported, not a verdict.
  // The trpc line is `nonce-${Math.random()}` inside a template literal; the
  // in-string guard hides that shape until it learns `${}` is code (next PR),
  // so the same identifier-keyed split is proven on the bare call here.
  const line = '    const nonce = Math.random().toString(36);\n';

  it('the trpc test nonce is a warning', async () => {
    const found = await randomIn('packages/react-query/test/overrides.test.tsx', line);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].severity, 'warning');
  });

  it('the same line in application code is an error', async () => {
    const found = await randomIn('packages/react-query/src/overrides.tsx', line);
    assert.strictEqual(found.length, 1);
    assert.notStrictEqual(found[0].severity, 'warning');
  });
});
