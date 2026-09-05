// =============================================================================
// SECURITY MODULE — SQL INJECTION (string concat / template interpolation)
// =============================================================================
// Regression tests for the in-file SQL injection detector added to
// src/modules/security.js (_checkSqlInjectionPatterns). Covers both planted
// shapes from the reliability corpus — string concatenation and
// template-literal interpolation of an identifier into a SQL string passed
// to a query-like sink — plus the required negatives: parameterised calls,
// tagged-template query builders, and SQL-injection-shaped text nested
// inside an outer string literal (fixture data).
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SecurityModule = require('../src/modules/security');

function makeResult() {
  const checks = [];
  return {
    checks,
    addCheck(rule, passed, meta = {}) {
      checks.push({ rule, passed, severity: meta.severity || (passed ? 'info' : 'error'), ...meta });
    },
    errors() { return this.checks.filter((c) => !c.passed && c.severity === 'error'); },
  };
}

async function run(tmp) {
  const mod = new SecurityModule();
  const result = makeResult();
  await mod.run(result, { projectRoot: tmp });
  return result;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function withTmp(prefix, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Positive — string concatenation
// ---------------------------------------------------------------------------

describe('SecurityModule — SQL injection via string concatenation', () => {
  it('flags a SQL string built by concatenating an identifier and passed to conn.query()', async () => {
    await withTmp('gt-sqli-concat-', async (tmp) => {
      write(tmp, 'src/db/query.js', `
function findUserByEmail(email) {
  const conn = getConnection();
  const sql = "SELECT * FROM users WHERE email = '" + email + "'";
  return conn.query(sql);
}
module.exports = { findUserByEmail };
`);
      const result = await run(tmp);
      const finding = result.errors().find((c) => c.rule.startsWith('security:sql-injection:'));
      assert.ok(finding, `expected a sql-injection finding, got: ${JSON.stringify(result.checks.map((c) => c.rule))}`);
      assert.strictEqual(finding.line, 4);
    });
  });
});

// ---------------------------------------------------------------------------
// Positive — template-literal interpolation
// ---------------------------------------------------------------------------

describe('SecurityModule — SQL injection via template-literal interpolation', () => {
  it('flags a SQL string built by interpolating an identifier and passed to conn.query()', async () => {
    await withTmp('gt-sqli-tmpl-', async (tmp) => {
      write(tmp, 'src/db/query.js', `
function findOrderById(orderId) {
  const conn = getConnection();
  const sql = \`SELECT * FROM orders WHERE id = \${orderId}\`;
  return conn.query(sql);
}
module.exports = { findOrderById };
`);
      const result = await run(tmp);
      const finding = result.errors().find((c) => c.rule.startsWith('security:sql-injection:'));
      assert.ok(finding, `expected a sql-injection finding, got: ${JSON.stringify(result.checks.map((c) => c.rule))}`);
      assert.strictEqual(finding.line, 4);
    });
  });

  it('flags an inline template-literal built directly inside the sink call', async () => {
    await withTmp('gt-sqli-tmpl-inline-', async (tmp) => {
      write(tmp, 'src/db/query.js', `
function findProductsByName(name) {
  return conn.query(\`SELECT * FROM products WHERE name LIKE '%\${name}%'\`);
}
module.exports = { findProductsByName };
`);
      const result = await run(tmp);
      const finding = result.errors().find((c) => c.rule.startsWith('security:sql-injection:'));
      assert.ok(finding, `expected a sql-injection finding, got: ${JSON.stringify(result.checks.map((c) => c.rule))}`);
    });
  });
});

// ---------------------------------------------------------------------------
// Negative — parameterised queries and tagged-template builders must NOT fire
// ---------------------------------------------------------------------------

describe('SecurityModule — SQL injection negatives', () => {
  it('does not flag a parameterised query (placeholder + values array)', async () => {
    await withTmp('gt-sqli-param-', async (tmp) => {
      write(tmp, 'src/db/query.js', `
function findUserById(id) {
  const conn = getConnection();
  return conn.query('SELECT * FROM users WHERE id = ?', [id]);
}
module.exports = { findUserById };
`);
      const result = await run(tmp);
      const findings = result.errors().filter((c) => c.rule.startsWith('security:sql-injection:'));
      assert.strictEqual(findings.length, 0, `expected no findings, got: ${JSON.stringify(findings)}`);
    });
  });

  it('does not flag a sql-tagged template builder', async () => {
    await withTmp('gt-sqli-tagged-', async (tmp) => {
      write(tmp, 'src/db/query.js', `
const { sql } = require('./db');
function findOrderById(orderId) {
  const conn = getConnection();
  return conn.query(sql\`SELECT * FROM orders WHERE id = \${orderId}\`);
}
module.exports = { findOrderById };
`);
      const result = await run(tmp);
      const findings = result.errors().filter((c) => c.rule.startsWith('security:sql-injection:'));
      assert.strictEqual(findings.length, 0, `expected no findings, got: ${JSON.stringify(findings)}`);
    });
  });

  // One nested-in-string negative per detection site (task requirement):
  // SQL-injection-shaped text sitting inside an OUTER string literal (test
  // fixtures / example strings writing code as data) must not fire —
  // enforced via BaseModule._isInsideStringLiteral.

  it('does not flag string-concat SQL injection text nested inside an outer string literal', async () => {
    await withTmp('gt-sqli-nested-concat-', async (tmp) => {
      write(tmp, 'src/docs/example.js', `
const EXAMPLE = "const sql = 'SELECT * FROM users WHERE id = ' + id; conn.query(sql);";
module.exports = { EXAMPLE };
`);
      const result = await run(tmp);
      const findings = result.errors().filter((c) => c.rule.startsWith('security:sql-injection:'));
      assert.strictEqual(findings.length, 0, `expected no findings, got: ${JSON.stringify(findings)}`);
    });
  });

  it('does not flag template-literal SQL injection text nested inside an outer string literal', async () => {
    await withTmp('gt-sqli-nested-tmpl-', async (tmp) => {
      write(tmp, 'src/docs/example.js', `
const EXAMPLE = "const sql = \`SELECT * FROM orders WHERE id = \${orderId}\`; conn.query(sql);";
module.exports = { EXAMPLE };
`);
      const result = await run(tmp);
      const findings = result.errors().filter((c) => c.rule.startsWith('security:sql-injection:'));
      assert.strictEqual(findings.length, 0, `expected no findings, got: ${JSON.stringify(findings)}`);
    });
  });
});

// ---------------------------------------------------------------------------
// A splice made only of CONSTANTS is not an injection; a call-expression tag
// is a tag. Measured on prisma/prisma @ HEAD (2026-09-05): 31 findings, 22
// of them `${SCREAMING_CONSTANT}` only, 4 of them `rawSql()\`…\``.
// ---------------------------------------------------------------------------

describe('SecurityModule — SQL injection: constant-only splices and call-expression tags', () => {
  const sqli = (result) => result.checks.filter((c) => !c.passed && c.rule.startsWith('security:sql-injection:'));

  it('stays quiet on a template that interpolates only SCREAMING_SNAKE constants', async () => {
    await withTmp('gt-sqli-const-', async (tmp) => {
      write(tmp, 'src/testkit.js', [
        "const STORAGE_TABLE = 'codec_case';",
        "const VALUE_COLUMN = 'value';",
        'async function setup(connection) {',
        // prisma packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts:331, :340, :343
        '  await connection.query(`DROP TABLE IF EXISTS "${STORAGE_TABLE}"`);',
        '  await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES (NULL)`);',
        '  await connection.query(`INSERT INTO "${STORAGE_TABLE}" ("${VALUE_COLUMN}") VALUES ($1)`, [1]);',
        // prisma packages/3-targets/6-adapters/postgres/test/migrations/runner.unbound-namespace.integration.test.ts:104
        '  await connection.query(`create schema if not exists ${TENANT_A_SCHEMA}`);',
        '}',
        'module.exports = { setup };',
        '',
      ].join('\n'));
      const found = sqli(await run(tmp));
      assert.deepStrictEqual(found.map((f) => f.line), []);
    });
  });

  it('still fires when a constant is spliced NEXT TO a non-constant', async () => {
    await withTmp('gt-sqli-mixed-', async (tmp) => {
      write(tmp, 'src/testkit.js', [
        'async function setup(connection, columnType) {',
        // prisma packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts:337 — reported, correctly
        '  await connection.query(`CREATE TABLE "${STORAGE_TABLE}" ("${VALUE_COLUMN}" ${columnType})`);',
        '}',
        '',
      ].join('\n'));
      const found = sqli(await run(tmp));
      assert.strictEqual(found.length, 1);
      assert.strictEqual(found[0].line, 2);
    });
  });

  it('still fires on a lowercase identifier and on request input', async () => {
    await withTmp('gt-sqli-lower-', async (tmp) => {
      write(tmp, 'src/db.js', [
        'async function drop(client, tableName, req) {',
        '  await client.query(`DROP TABLE IF EXISTS "${tableName}"`);',
        '  await client.query(`SELECT * FROM users WHERE id = ${req.query.id}`);',
        '  await client.query(`SELECT * FROM "${STORAGE_TABLE}" WHERE id = ${req.query.id}`);',
        '}',
        '',
      ].join('\n'));
      const found = sqli(await run(tmp));
      assert.deepStrictEqual(found.map((f) => f.line), [2, 3, 4]);
    });
  });

  it('concatenation: a SCREAMING constant is quiet, a mixed chain fires', async () => {
    await withTmp('gt-sqli-concat-const-', async (tmp) => {
      write(tmp, 'src/db.js', [
        'function q(conn, id) {',
        '  conn.query("SELECT * FROM " + TABLE_NAME);',
        '  conn.query("SELECT * FROM " + TABLE_NAME + " WHERE id = " + id);',
        '  conn.query("SELECT * FROM " + tableName);',
        '}',
        '',
      ].join('\n'));
      const found = sqli(await run(tmp));
      assert.deepStrictEqual(found.map((f) => f.line), [3, 4]);
    });
  });

  it('a tag that is a CALL EXPRESSION is still a tagged template', async () => {
    await withTmp('gt-sqli-calltag-', async (tmp) => {
      write(tmp, 'src/db.js', [
        'async function plan(driver, id) {',
        // prisma test/integration/test/raw-query.integration.test.ts:131
        '  const plan = rawSql()`SELECT id, name, email FROM users WHERE id = ${1}`',
        '    .returnsRow({ id: "pg/int4@1" })',
        '    .build();',
        '  return driver.query(plan);',
        '}',
        // the same text through a real sink, no tag — must still fire
        'async function bad(driver, id) {',
        '  return driver.query(`SELECT id, name, email FROM users WHERE id = ${id}`);',
        '}',
        '',
      ].join('\n'));
      const found = sqli(await run(tmp));
      assert.deepStrictEqual(found.map((f) => f.line), [8]);
    });
  });
});

// ---------------------------------------------------------------------------
// One stripper (2026-09-05): the SQL regexes read the keyword out of the
// quotes, so they still run on the raw line — but whether the quote they start
// at is a real delimiter is decided by BaseModule._maskedLines, which sees a
// template literal and a block comment that span lines. The block-comment
// case (a line inside `/* … */` that does not start with `*`) was a live
// finding under the per-line quote counter this replaced.
// ---------------------------------------------------------------------------

describe('SecurityModule — SQL injection: a query inside a string, a template or a comment is inert', () => {
  it('a concatenated query inside a string, a template or a comment is not flagged; the real one beside them is (2026-09-05)', async () => {
    await withTmp('gt-sqli-mask-', async (tmp) => {
      write(tmp, 'src/db/query.js', [
        'function find(id, conn) {',
        '  const doc = "const sql = \'SELECT * FROM users WHERE id = \' + id; conn.query(sql)";',
        '  const tpl = `',
        "    const sql2 = 'SELECT * FROM users WHERE id = ' + id; conn.query(sql2)",
        '  `;',
        '  /* example:',
        "     const sql3 = 'SELECT * FROM users WHERE id = ' + id; conn.query(sql3)",
        '  */',
        "  const sql = 'SELECT * FROM users WHERE id = ' + id;",
        '  return conn.query(sql);',
        '}',
        'module.exports = { find };',
        '',
      ].join('\n'));
      const result = await run(tmp);
      const found = result.errors().filter((c) => c.rule.startsWith('security:sql-injection:'));
      assert.deepStrictEqual(found.map((c) => c.line), [9], JSON.stringify(result.checks.map((c) => c.rule)));
    });
  });
});
