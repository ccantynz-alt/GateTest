// ============================================================================
// INSTALLATION-STORE TEST
// ============================================================================
// Verifies the GitHub App installation persistence helper used by the
// callback at website/app/api/github/callback/route.ts. Ensures that:
//   - ensureInstallationsTable runs CREATE TABLE IF NOT EXISTS (idempotent)
//   - persistInstallation sends a single INSERT ... ON CONFLICT DO UPDATE
//     statement with host + installation_id + customer context
//   - COALESCE semantics preserve a linked customer when an anonymous
//     re-install happens
//   - Missing installationId throws synchronously-enough (rejects)
//   - Missing sql impl throws (contract guard)
// ============================================================================
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  ensureInstallationsTable,
  persistInstallation,
  HOST_GITHUB,
} = require(path.resolve(
  __dirname,
  '..',
  'website',
  'app',
  'lib',
  'installation-store.js'
));

/**
 * Build a fake tagged-template SQL function that records every call.
 * The real Neon client is a tagged template: sql`SELECT ${x}` — so we
 * reproduce that signature exactly.
 */
function makeFakeSql() {
  const calls = [];
  const fakeSql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve([]);
  };
  fakeSql.calls = calls;
  return fakeSql;
}

describe('ensureInstallationsTable', () => {
  it('issues CREATE TABLE IF NOT EXISTS plus indexes', async () => {
    const sql = makeFakeSql();
    await ensureInstallationsTable(sql);

    assert.ok(sql.calls.length >= 1, 'at least one statement issued');
    const joined = sql.calls.map((c) => c.text).join('\n');
    assert.match(joined, /CREATE TABLE IF NOT EXISTS installations/);
    assert.match(joined, /UNIQUE \(host, installation_id\)/);
    assert.match(joined, /CREATE INDEX IF NOT EXISTS idx_installations_host_id/);
    assert.match(
      joined,
      /CREATE INDEX IF NOT EXISTS idx_installations_customer_email/
    );
  });
});

describe('persistInstallation', () => {
  it('inserts with (host, installation_id, customer, login, action) and UPSERT semantics', async () => {
    const sql = makeFakeSql();
    const result = await persistInstallation({
      installationId: 12345,
      customerEmail: 'alice@example.com',
      customerLogin: 'alice',
      setupAction: 'install',
      sql,
    });

    assert.strictEqual(result.persisted, true);
    assert.strictEqual(result.host, HOST_GITHUB);
    assert.strictEqual(result.host, 'github');
    assert.strictEqual(result.installationId, '12345'); // coerced to string
    assert.strictEqual(result.linked, true);

    assert.strictEqual(sql.calls.length, 1, 'exactly one INSERT');
    const call = sql.calls[0];
    assert.match(call.text, /INSERT INTO\s+installations/i);
    assert.match(call.text, /ON CONFLICT \(host, installation_id\) DO UPDATE/i);
    assert.match(call.text, /COALESCE\(EXCLUDED\.customer_email/);
    assert.match(call.text, /COALESCE\(EXCLUDED\.customer_login/);

    // Values sent to the tagged template: host, id, email, login, action
    assert.deepStrictEqual(call.values, [
      'github',
      '12345',
      'alice@example.com',
      'alice',
      'install',
    ]);
  });

  it('accepts an anonymous install (no customer context)', async () => {
    const sql = makeFakeSql();
    const result = await persistInstallation({
      installationId: '777',
      sql,
    });

    assert.strictEqual(result.persisted, true);
    assert.strictEqual(result.linked, false, 'not linked to a customer');

    const call = sql.calls[0];
    assert.deepStrictEqual(call.values, [
      'github',
      '777',
      null,
      null,
      null,
    ]);
  });

  it('preserves linked customer on anonymous re-install (COALESCE in UPSERT)', async () => {
    // This is a SQL-level guarantee, but we assert the statement shape
    // encodes it correctly — if the CONFLICT branch used plain
    // EXCLUDED.customer_email instead of COALESCE(), an anonymous
    // re-install would NULL out a previously-linked customer.
    const sql = makeFakeSql();
    await persistInstallation({ installationId: '1', sql });
    const text = sql.calls[0].text;
    assert.match(text, /COALESCE\(EXCLUDED\.customer_email,\s*installations\.customer_email\)/);
    assert.match(text, /COALESCE\(EXCLUDED\.customer_login,\s*installations\.customer_login\)/);
  });

  it('throws when installationId is missing', async () => {
    const sql = makeFakeSql();
    await assert.rejects(
      () => persistInstallation({ sql }),
      /installationId is required/
    );
    await assert.rejects(
      () => persistInstallation({ installationId: '', sql }),
      /installationId is required/
    );
    await assert.rejects(
      () => persistInstallation({ installationId: null, sql }),
      /installationId is required/
    );
  });

  it('throws when sql impl is missing', async () => {
    await assert.rejects(
      () => persistInstallation({ installationId: '1' }),
      /sql tagged-template is required/
    );
  });

  it('honours a custom host (forward-compat for GluecronBridge)', async () => {
    const sql = makeFakeSql();
    const result = await persistInstallation({
      installationId: '42',
      host: 'gluecron',
      sql,
    });
    assert.strictEqual(result.host, 'gluecron');
    assert.strictEqual(sql.calls[0].values[0], 'gluecron');
  });
});
