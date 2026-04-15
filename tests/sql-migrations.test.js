const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SqlMigrationsModule = require('../src/modules/sql-migrations');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function run(projectRoot) {
  const mod = new SqlMigrationsModule();
  const result = makeResult();
  return mod.run(result, { projectRoot }).then(() => result);
}

function writeMigration(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('SqlMigrationsModule — discovery', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('skips when no migration files exist', async () => {
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'sql:no-files'));
  });

  it('finds SQL files under migrations/, db/migrate/, prisma/migrations/', async () => {
    writeMigration(tmp, 'migrations/001_init.sql',                      'CREATE TABLE a (id int);');
    writeMigration(tmp, 'db/migrate/20240101_add.sql',                  'CREATE TABLE b (id int);');
    writeMigration(tmp, 'prisma/migrations/20240102_x/migration.sql',   'CREATE TABLE c (id int);');
    writeMigration(tmp, 'supabase/migrations/20240103_y.sql',           'CREATE TABLE d (id int);');
    const r = await run(tmp);
    const scanning = r.checks.find((c) => c.name === 'sql:scanning');
    assert.match(scanning.message, /4 SQL/);
  });

  it('does NOT pick up .sql files outside migration directories', async () => {
    writeMigration(tmp, 'queries/report.sql',   'SELECT * FROM foo;');
    writeMigration(tmp, 'schema.sql',           'SELECT 1;');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'sql:no-files'));
  });

  it('excludes node_modules', async () => {
    writeMigration(tmp, 'node_modules/pkg/migrations/001.sql', 'DROP TABLE users;');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name === 'sql:no-files'));
  });
});

describe('SqlMigrationsModule — destructive ops', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-drop-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on DROP COLUMN', async () => {
    writeMigration(tmp, 'migrations/001.sql', 'ALTER TABLE users DROP COLUMN legacy_flag;');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:drop-column:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('errors on DROP TABLE', async () => {
    writeMigration(tmp, 'migrations/002.sql', 'DROP TABLE audit_log;');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:drop-table:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('info-flags TRUNCATE', async () => {
    writeMigration(tmp, 'migrations/003.sql', 'TRUNCATE TABLE sessions;');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:truncate:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'info');
  });

  it('ignores DROP COLUMN in a SQL comment', async () => {
    writeMigration(tmp, 'migrations/004.sql', [
      '-- later we will DROP COLUMN legacy_flag but not yet',
      'ALTER TABLE users ADD COLUMN new_flag boolean DEFAULT false;',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('sql:drop-column:')), undefined);
  });

  it('ignores DROP COLUMN in a block comment', async () => {
    writeMigration(tmp, 'migrations/005.sql', [
      '/* TODO: DROP COLUMN legacy_flag next quarter */',
      'SELECT 1;',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('sql:drop-column:')), undefined);
  });
});

describe('SqlMigrationsModule — NOT NULL + ADD COLUMN', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-nn-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('errors on ADD COLUMN ... NOT NULL without DEFAULT', async () => {
    writeMigration(tmp, 'migrations/001.sql',
      'ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL;');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:add-notnull-no-default:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });

  it('accepts ADD COLUMN ... NOT NULL DEFAULT <value>', async () => {
    writeMigration(tmp, 'migrations/002.sql',
      "ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '';");
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('sql:add-notnull-no-default:')), undefined);
  });

  it('errors on ALTER COLUMN ... SET NOT NULL', async () => {
    writeMigration(tmp, 'migrations/003.sql',
      'ALTER TABLE users ALTER COLUMN email SET NOT NULL;');
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:set-notnull:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });
});

describe('SqlMigrationsModule — indexes', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-idx-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on CREATE INDEX without CONCURRENTLY', async () => {
    writeMigration(tmp, 'migrations/001.sql',
      'CREATE INDEX idx_users_email ON users (email);');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:index-not-concurrent:')));
  });

  it('warns on CREATE UNIQUE INDEX without CONCURRENTLY', async () => {
    writeMigration(tmp, 'migrations/002.sql',
      'CREATE UNIQUE INDEX idx_users_email ON users (email);');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:index-not-concurrent:')));
  });

  it('accepts CREATE INDEX CONCURRENTLY', async () => {
    writeMigration(tmp, 'migrations/003.sql',
      'CREATE INDEX CONCURRENTLY idx_users_email ON users (email);');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('sql:index-not-concurrent:')), undefined);
  });

  it('warns on DROP INDEX without CONCURRENTLY', async () => {
    writeMigration(tmp, 'migrations/004.sql', 'DROP INDEX idx_users_email;');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:drop-index-not-concurrent:')));
  });

  it('errors on CREATE INDEX CONCURRENTLY inside BEGIN', async () => {
    writeMigration(tmp, 'migrations/005.sql', [
      'BEGIN;',
      'CREATE INDEX CONCURRENTLY idx_x ON users (email);',
      'COMMIT;',
    ].join('\n'));
    const r = await run(tmp);
    const hit = r.checks.find((c) => c.name.startsWith('sql:concurrent-in-tx:'));
    assert.ok(hit);
    assert.strictEqual(hit.severity, 'error');
  });
});

describe('SqlMigrationsModule — rolling deploy + constraints + types', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-roll-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('warns on ALTER TABLE ... RENAME COLUMN', async () => {
    writeMigration(tmp, 'migrations/001.sql',
      'ALTER TABLE users RENAME COLUMN email TO email_address;');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:rename:')));
  });

  it('warns on ALTER COLUMN ... TYPE', async () => {
    writeMigration(tmp, 'migrations/002.sql',
      'ALTER TABLE users ALTER COLUMN email TYPE TEXT;');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:alter-type:')));
  });

  it('warns on ADD CONSTRAINT CHECK without NOT VALID', async () => {
    writeMigration(tmp, 'migrations/003.sql',
      'ALTER TABLE users ADD CONSTRAINT users_age_check CHECK (age >= 0);');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:add-constraint-validates:')));
  });

  it('accepts ADD CONSTRAINT ... NOT VALID', async () => {
    writeMigration(tmp, 'migrations/004.sql',
      'ALTER TABLE users ADD CONSTRAINT users_age_check CHECK (age >= 0) NOT VALID;');
    const r = await run(tmp);
    assert.strictEqual(r.checks.find((c) => c.name.startsWith('sql:add-constraint-validates:')), undefined);
  });

  it('warns on ADD CONSTRAINT FOREIGN KEY without NOT VALID', async () => {
    writeMigration(tmp, 'migrations/005.sql',
      'ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id);');
    const r = await run(tmp);
    assert.ok(r.checks.find((c) => c.name.startsWith('sql:add-constraint-validates:')));
  });
});

describe('SqlMigrationsModule — summary', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-sql-sum-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('records a summary', async () => {
    writeMigration(tmp, 'migrations/001.sql', 'CREATE TABLE x (id int);');
    const r = await run(tmp);
    const summary = r.checks.find((c) => c.name === 'sql:summary');
    assert.ok(summary);
    assert.match(summary.message, /1 file\(s\)/);
  });
});
