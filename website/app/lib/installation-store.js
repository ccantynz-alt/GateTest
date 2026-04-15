/**
 * GitHub App installation persistence helper.
 *
 * Installation IDs are long-lived customer-to-app-install mappings. When a
 * customer installs the GateTest GitHub App, GitHub redirects to
 * /api/github/callback?installation_id=... &setup_action=install. We persist
 * that installation_id against the currently-signed-in customer (if any) so
 * webhook handlers can later resolve events back to a customer record.
 *
 * Storage: the existing Neon Postgres database (no new service dependency).
 * Table: `installations` — one row per (host, installation_id). Customer
 * linkage columns are nullable so an anonymous install (no active customer
 * session at callback time) still records the installation for later
 * reconciliation when the customer signs in.
 *
 * Per the GateTest Bible:
 *   - Stripe metadata is the persistence layer for SCAN state only
 *   - installation_id is a durable mapping, not per-scan state → DB is correct
 *   - No in-memory state, function-scoped only
 */

const HOST_GITHUB = 'github';

/**
 * Ensure the `installations` table exists. Idempotent.
 *
 * @param {Function} sql - tagged-template SQL function (Neon `neon(url)` return)
 */
async function ensureInstallationsTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS installations (
    id BIGSERIAL PRIMARY KEY,
    host TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    customer_email TEXT,
    customer_login TEXT,
    setup_action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (host, installation_id)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_installations_host_id
    ON installations(host, installation_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_installations_customer_email
    ON installations(customer_email)`;
}

/**
 * Persist (or upsert) a GitHub App installation → customer mapping.
 *
 * Behaviour:
 *   - If no row exists for (host, installation_id): insert.
 *   - If a row already exists: update customer_email / customer_login only
 *     when new values are non-null, so an anonymous re-install doesn't wipe
 *     a previously-linked customer. Always refresh `updated_at`.
 *
 * @param {Object} opts
 * @param {string|number} opts.installationId - from GitHub callback
 * @param {string|null} [opts.customerEmail]  - from customer session cookie
 * @param {string|null} [opts.customerLogin]  - from customer session cookie
 * @param {string} [opts.setupAction]         - 'install' | 'update'
 * @param {Function} opts.sql                 - tagged-template SQL function
 * @param {string} [opts.host]                - defaults to 'github'
 * @returns {Promise<{persisted: true, host: string, installationId: string, linked: boolean}>}
 */
async function persistInstallation({
  installationId,
  customerEmail = null,
  customerLogin = null,
  setupAction = null,
  sql,
  host = HOST_GITHUB,
}) {
  if (!sql || typeof sql !== 'function') {
    throw new Error('persistInstallation: sql tagged-template is required');
  }
  if (installationId === null || installationId === undefined || installationId === '') {
    throw new Error('persistInstallation: installationId is required');
  }

  const idStr = String(installationId);
  const email = customerEmail || null;
  const login = customerLogin || null;
  const action = setupAction || null;

  await sql`
    INSERT INTO installations
      (host, installation_id, customer_email, customer_login, setup_action, created_at, updated_at)
    VALUES
      (${host}, ${idStr}, ${email}, ${login}, ${action}, NOW(), NOW())
    ON CONFLICT (host, installation_id) DO UPDATE SET
      customer_email = COALESCE(EXCLUDED.customer_email, installations.customer_email),
      customer_login = COALESCE(EXCLUDED.customer_login, installations.customer_login),
      setup_action   = COALESCE(EXCLUDED.setup_action,   installations.setup_action),
      updated_at     = NOW()
  `;

  return {
    persisted: true,
    host,
    installationId: idStr,
    linked: Boolean(email || login),
  };
}

module.exports = {
  ensureInstallationsTable,
  persistInstallation,
  HOST_GITHUB,
};
