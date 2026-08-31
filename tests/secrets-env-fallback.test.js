/**
 * An env-var read with a literal fallback IS a hardcoded credential.
 *
 *     const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'layova-admin';
 *
 * Found 2026-08-31 while benchmarking GateTest against Gluecron's repo_health
 * on ccantynz/esim. Gluecron called that repo a "clean codebase" — but GateTest
 * missed the same two credentials in lib/auth.ts:15-16, so this was our bug
 * too, not a competitor's.
 *
 * Root cause was not a missing pattern. The scan loop carried a blanket
 * `if (/process\.env\b/.test(line)) continue;`, added to stop
 * `password = process.env.PASSWORD` (a safe read) from firing. That skip made
 * the entire fallback class unreachable BY DESIGN — the more dangerous half of
 * the shape was silenced to quiet the harmless half.
 *
 * The fallback is worse than a plain hardcoded secret, not better: the code
 * reads as if it uses environment variables, so it passes review, and the
 * literal becomes the live credential in exactly the environment nobody
 * checked.
 *
 * The negative controls are the important half. The original false positive
 * must stay fixed: a bare read holds no secret, and non-credential config
 * (`process.env.PORT ?? '3000'`) is not a finding.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const SecretsModule = require('../src/modules/secrets');

describe('secrets: env-var fallback credentials', () => {
  let mod;
  beforeEach(() => { mod = new SecretsModule(); });

  const fb = (line) => mod._envFallbackSecret(line);

  // ---- POSITIVE CONTROLS -------------------------------------------------
  // Without these the rule is indistinguishable from one that never fires.

  it('catches the two real lines this rule was written for', () => {
    assert.strictEqual(
      fb(`const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "layova-admin";`),
      'layova-admin',
    );
    assert.strictEqual(
      fb(`const SECRET = process.env.AUTH_SECRET ?? "dev-secret-change-before-launch";`),
      'dev-secret-change-before-launch',
    );
  });

  it('catches `||` as well as `??`', () => {
    assert.strictEqual(
      fb(`const token = process.env.API_TOKEN || 'hunter2hunter2';`),
      'hunter2hunter2',
    );
  });

  it('catches bracket access, where the name lives only in the key', () => {
    assert.strictEqual(
      fb(`const x = process.env['SESSION_SECRET'] ?? "s3cr3t-signing-value";`),
      's3cr3t-signing-value',
    );
  });

  it('catches an object property, not just a declaration', () => {
    assert.strictEqual(
      fb(`  apiKey: process.env.STRIPE_KEY ?? "sk_test_abcdefghijklmnop",`),
      'sk_test_abcdefghijklmnop',
    );
  });

  // ---- NEGATIVE CONTROLS -------------------------------------------------
  // The false positive the blanket skip existed to prevent must stay fixed.

  it('a bare env read is not a secret', () => {
    assert.strictEqual(fb(`const password = process.env.PASSWORD;`), null);
    assert.strictEqual(fb(`const SECRET = process.env.AUTH_SECRET;`), null);
  });

  it('non-credential config with a default is not a secret', () => {
    assert.strictEqual(fb(`const port = process.env.PORT ?? '3000';`), null);
    assert.strictEqual(fb(`const base = process.env.BASE_URL || 'http://localhost:3000';`), null);
  });

  it('an obvious placeholder fallback stays quiet', () => {
    assert.strictEqual(fb(`const s = process.env.AUTH_SECRET ?? 'changeme';`), null);
    assert.strictEqual(fb(`const k = process.env.API_KEY ?? 'your_api_key_here';`), null);
    assert.strictEqual(fb(`const p = process.env.ADMIN_PASSWORD ?? 'replace-me';`), null);
  });

  it('a fallback that reads another secret is indirection, not a literal', () => {
    assert.strictEqual(fb(`const s = process.env.AUTH_SECRET ?? process.env.LEGACY_SECRET;`), null);
    assert.strictEqual(fb(`const s = process.env.AUTH_SECRET || \`\${LEGACY}\`;`), null);
  });

  it('very short fallbacks are flags and sentinels, not credentials', () => {
    assert.strictEqual(fb(`const secret = process.env.SECRET ?? 'none';`), null);
  });

  // ---- END TO END --------------------------------------------------------

  it('reports the finding through a real scan, at error severity', async () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-envfb-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'auth.js'),
        [
          'const SECRET = process.env.AUTH_SECRET ?? "dev-secret-change-before-launch";',
          'const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "layova-admin";',
          'const port = process.env.PORT ?? "3000";',
          'module.exports = { SECRET, ADMIN_PASSWORD, port };',
        ].join('\n'),
      );

      const checks = [];
      const result = {
        checks,
        addCheck(name, passed, d = {}) { checks.push({ name, passed, ...d }); },
      };
      await mod.run(result, { projectRoot: tmp });

      const hit = checks.find((c) => c.name.includes('auth.js'));
      assert.ok(hit, 'expected a finding on auth.js');
      assert.strictEqual(hit.passed, false);
      assert.strictEqual(hit.severity, 'error');

      const types = hit.details.map((d) => d.type);
      assert.deepStrictEqual(types, ['Fallback Secret', 'Fallback Secret'],
        'expected exactly the two credential lines — PORT must not be reported');
      assert.deepStrictEqual(hit.details.map((d) => d.line), [1, 2]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
