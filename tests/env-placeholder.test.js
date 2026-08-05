/**
 * "Set" is not "valid" — the guard for present-but-fake env vars.
 *
 * From the 2026-08-06 incident: GATETEST_PRIVATE_KEY in production held the
 * literal documentation example, 112 chars, BEGIN/END markers and no key body.
 * Every check reported PRESENT, so GitHub App auth was dead for weeks with
 * every dashboard green.
 *
 * The hardest requirement here is NOT catching fakes — it is never flagging a
 * real credential. A false positive tells someone their working key is broken,
 * which is its own outage, so the real-value cases below are the load-bearing
 * half of this file.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { inspectEnvValue, findPlaceholders } = require('../src/core/env-placeholder');

const ok = (name, value) => inspectEnvValue(name, value).ok;
const reasonFor = (name, value) => inspectEnvValue(name, value).reason;

describe('env placeholder detection', () => {
  describe('catches the values that actually shipped to production', () => {
    it('flags the exact GATETEST_PRIVATE_KEY that was live on the box', () => {
      // Verbatim, including the escaped newlines, as stored in .env.local.
      const actual = '"-----BEGIN RSA PRIVATE KEY-----\\n...(all the base64 lines)...\\n-----END RSA PRIVATE KEY-----"';
      assert.strictEqual(ok('GATETEST_PRIVATE_KEY', actual), false,
        'this is the literal value that was serving production — it must be caught');
      assert.match(String(reasonFor('GATETEST_PRIVATE_KEY', actual)), /filler|elided|body|short/i);
    });

    it('flags a PEM with markers but no body', () => {
      assert.strictEqual(ok('GATETEST_PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----\n-----END RSA PRIVATE KEY-----'), false);
    });

    it('flags common literal fillers', () => {
      for (const v of ['changeme', 'TODO', 'your_key_here', 'xxx', 'placeholder', 'TBD']) {
        assert.strictEqual(ok('SOME_SECRET', v), false, `"${v}" should be flagged`);
      }
    });

    it('flags a credential that is too short for its known shape', () => {
      assert.strictEqual(ok('STRIPE_SECRET_KEY', 'sk_'), false);
      assert.strictEqual(ok('RESEND_API_KEY', 're_x'), false);
    });

    it('flags a known-shape key with the wrong prefix', () => {
      assert.strictEqual(ok('ANTHROPIC_API_KEY', 'sk-proj-' + 'a'.repeat(60)), false,
        'an OpenAI-style key in the Anthropic slot is a real, common mistake');
    });
  });

  describe('never flags a real credential — the half that matters most', () => {
    it('accepts a genuine-shaped Anthropic key', () => {
      assert.strictEqual(ok('ANTHROPIC_API_KEY', 'sk-ant-api03-' + 'A1b2C3d4'.repeat(12)), true);
    });

    it('accepts genuine-shaped Stripe keys', () => {
      assert.strictEqual(ok('STRIPE_SECRET_KEY', 'sk_live_' + 'Z9y8X7w6'.repeat(6)), true);
      assert.strictEqual(ok('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_' + 'Q1w2E3r4'.repeat(6)), true);
      assert.strictEqual(ok('STRIPE_WEBHOOK_SECRET', 'whsec_' + 'M5n6B7v8'.repeat(4)), true);
    });

    it('accepts a real PEM private key', () => {
      const body = Array.from({ length: 26 }, () => 'MIIEowIBAAKCAQEAxK9pQ7vZ2mN4rT8wY1uS3dF6gH0jL5cV7bN9aE2xR4tY6uI8'.slice(0, 64)).join('\n');
      const pem = `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`;
      assert.strictEqual(ok('GATETEST_PRIVATE_KEY', pem), true,
        'a real ~1700-char PEM must never be flagged');
    });

    it('accepts a PEM stored with escaped newlines, as env files require', () => {
      const body = Array.from({ length: 26 }, () => 'MIIEowIBAAKCAQEAxK9pQ7vZ2mN4rT8wY1uS3dF6gH0jL5cV7bN9aE2xR4tY6uI8'.slice(0, 64)).join('\\n');
      assert.strictEqual(ok('GATETEST_PRIVATE_KEY', `-----BEGIN RSA PRIVATE KEY-----\\n${body}\\n-----END RSA PRIVATE KEY-----`), true);
    });

    it('accepts a high-entropy secret that merely contains a trigger word', () => {
      // "secret" alone is filler; a real secret containing it is not.
      assert.strictEqual(ok('SESSION_SECRET', 'a7f3d9e1secret4b8c2f6a0d5e9b3c7f1a4d8e2b6c0f5a9d3e7b1c4f8a2d6e0b'), true);
    });

    it('treats a MISSING value as not-a-placeholder', () => {
      // Absence is a different check's job; double-reporting would make every
      // unset optional var look corrupt.
      assert.strictEqual(ok('ANYTHING', undefined), true);
      assert.strictEqual(ok('ANYTHING', ''), true);
      assert.strictEqual(ok('ANYTHING', '   '), true);
    });
  });

  describe('findPlaceholders', () => {
    it('returns only the bad ones, with a reason', () => {
      const bad = findPlaceholders(['GOOD', 'BAD'], {
        GOOD: 'sk_live_' + 'Z9y8X7w6'.repeat(6),
        BAD: 'changeme',
      });
      assert.strictEqual(bad.length, 1);
      assert.strictEqual(bad[0].name, 'BAD');
      assert.ok(bad[0].reason && bad[0].reason.length > 0, 'a finding must explain itself');
    });
  });
});
