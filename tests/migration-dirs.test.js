/**
 * Control pairs for `src/core/migration-dirs.js` — the one answer to "where
 * do this repo's migrations live?" (KI #106, the Fifty move 11).
 *
 * Each positive control is a real tool's documented layout, planted alone in
 * an empty project, and must come back as a migration tree. Each negative
 * control is a directory that merely CONTAINS the word, or is NAMED like a
 * migration dir but holds a framework's migration implementation — the
 * shapes that produced four blocking findings on a DDL renderer in the
 * prisma corpus before the tree classification existed.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  MIGRATION_DIR_RE,
  ORDERED_NAME_RE,
  WALK_EXCLUDES,
  migrationDirKind,
  isMigrationDirPath,
  scanMigrationDirs,
  findMigrationDirs,
  listMigrationFiles,
  isUnderMigrationDir,
} = require('../src/core/migration-dirs');

function plant(root, rel, content = '') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('MIGRATION_DIR_RE — segment-anchored dir conventions', () => {
  const MATCH = [
    ['migrations', 'migrations'],
    ['db/migrations', 'migrations'],
    ['database/migrations', 'migrations'],
    ['prisma/migrations', 'migrations'],
    ['supabase/migrations', 'migrations'],
    ['src/migrations', 'migrations'],
    ['apps/api/src/migrations', 'migrations'],
    ['blog/migrations', 'migrations'],            // Django <app>/migrations
    ['Migrations', 'migrations'],                 // EF Core capitalises
    ['db/migrate', 'rails'],
    ['engines/billing/db/migrate', 'rails'],
    ['db/migration', 'flyway'],
    ['src/main/resources/db/migration', 'flyway'],
    ['src/main/resources/db/changelog', 'liquibase'],
    ['alembic/versions', 'alembic'],
    ['backend/alembic/versions', 'alembic'],
  ];
  const NO_MATCH = [
    'src/migrationsHelper',      // contains the word, not the segment
    'docs/migration-guide',
    'docs/migration',            // bare singular: docs (trpc www/docs/migration)
    'lib/active_record/migration', // bare singular: rails' framework
    'packages/tooling/migration',  // bare singular: prisma's framework
    'adb/migrate',               // `db/migrate` must start on a segment
    'migrate',                   // bare `migrate` is not a convention
    'versions',                  // Alembic's versions needs its parent
    'migrations/versions/deep',  // matched at `migrations`, not below it
    'src/migrations2',
    'MIGRATION_GUIDE.md',
    '',
  ];
  for (const [p, kind] of MATCH) {
    it(`matches ${p} as ${kind}`, () => {
      assert.strictEqual(isMigrationDirPath(p), true);
      assert.strictEqual(migrationDirKind(p), kind);
    });
  }
  for (const p of NO_MATCH) {
    it(`does not match ${JSON.stringify(p)}`, () => {
      assert.strictEqual(isMigrationDirPath(p), false);
      assert.strictEqual(migrationDirKind(p), null);
    });
  }
  it('normalises Windows separators and trailing slashes', () => {
    assert.strictEqual(isMigrationDirPath('db\\migrate'), true);
    assert.strictEqual(isMigrationDirPath('prisma/migrations/'), true);
    assert.strictEqual(MIGRATION_DIR_RE.test('src/app/migrations'), true);
  });
});

describe('ORDERED_NAME_RE — the name carries the order', () => {
  const ORDERED = [
    '20170806125915_create_active_storage_tables.rb', // Rails
    '2014_10_12_000000_create_users_table.php',       // Laravel
    '0001_initial.py',                                // Django
    '0000_wandering_hulk.sql',                        // Drizzle
    '000001_init.up.sql',                             // golang-migrate
    '1700000000000-Init.ts',                          // TypeORM epoch-ms
    '20240102030405_init',                            // Prisma dir
    'V1__init.sql', 'V1_2__add_email.sql', 'V2.1__x.sql', 'U1__undo.sql', 'R__views.sql', // Flyway
    '1975ea83b712_create_account_table.py',           // Alembic
    '20240101120000_Init.cs',                         // EF Core
  ];
  const UNORDERED = ['loader.py', 'Migrator.php', 'op-factory-call.ts', 'active-record.md', 'env.py', 'README.md', 'create_users.sql'];
  for (const n of ORDERED) it(`ordered: ${n}`, () => assert.ok(ORDERED_NAME_RE.test(n)));
  for (const n of UNORDERED) it(`unordered: ${n}`, () => assert.ok(!ORDERED_NAME_RE.test(n)));
});

describe('findMigrationDirs — one tool layout at a time', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-migdirs-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  // [label, file to plant, expected dir rel, expected kind]
  const LAYOUTS = [
    ['Rails', 'db/migrate/20170806125915_create_users.rb', 'db/migrate', 'rails'],
    ['Alembic (alembic/)', 'alembic/versions/1975ea83b712_create_account.py', 'alembic/versions', 'alembic'],
    ['Alembic (migrations/ root)', 'migrations/versions/1975ea83b712_create_account.py', 'migrations', 'migrations'],
    ['Flyway', 'src/main/resources/db/migration/V1__init.sql', 'src/main/resources/db/migration', 'flyway'],
    ['Liquibase', 'src/main/resources/db/changelog/db.changelog-master.xml', 'src/main/resources/db/changelog', 'liquibase'],
    ['Supabase', 'supabase/migrations/20240101120000_init.sql', 'supabase/migrations', 'migrations'],
    ['Knex', 'migrations/20240101120000_create_users.js', 'migrations', 'migrations'],
    ['Prisma (nested)', 'prisma/migrations/20240102030405_init/migration.sql', 'prisma/migrations', 'migrations'],
    ['Django app', 'blog/migrations/0001_initial.py', 'blog/migrations', 'migrations'],
    ['TypeORM', 'src/migrations/1700000000000-Init.ts', 'src/migrations', 'migrations'],
    ['Laravel', 'database/migrations/2014_10_12_000000_create_users_table.php', 'database/migrations', 'migrations'],
    ['EF Core', 'Migrations/20240101120000_Init.cs', 'Migrations', 'migrations'],
    ['Sequelize', 'migrations/20240101-create-user.js', 'migrations', 'migrations'],
    ['golang-migrate', 'db/migrations/000001_init.up.sql', 'db/migrations', 'migrations'],
    ['hand-named raw SQL', 'migrations/create_users.sql', 'migrations', 'migrations'],
  ];
  for (const [label, file, rel, kind] of LAYOUTS) {
    it(`POSITIVE: ${label} → ${rel}`, () => {
      plant(tmp, file, '-- x');
      const dirs = findMigrationDirs(tmp);
      assert.deepStrictEqual(dirs.map((d) => [d.rel, d.kind]), [[rel, kind]]);
      assert.deepStrictEqual(listMigrationFiles(dirs[0].abs).map((f) => path.relative(tmp, f).replace(/\\/g, '/')), [file]);
    });
  }

  it('POSITIVE: Drizzle — `drizzle/` beside its config, meta/ snapshots excluded', () => {
    plant(tmp, 'drizzle.config.ts', 'export default {}');
    plant(tmp, 'drizzle/0000_init.sql', 'CREATE TABLE a (id int);');
    plant(tmp, 'drizzle/meta/_journal.json', '{}');
    plant(tmp, 'drizzle/meta/0000_snapshot.json', '{}');
    const dirs = findMigrationDirs(tmp);
    assert.deepStrictEqual(dirs.map((d) => [d.rel, d.kind]), [['drizzle', 'drizzle']]);
    assert.deepStrictEqual(listMigrationFiles(dirs[0].abs).map((f) => path.basename(f)), ['0000_init.sql']);
  });

  it('NEGATIVE: a `drizzle/` dir with no config beside it is just a directory', () => {
    plant(tmp, 'drizzle/notes.md', '');
    assert.deepStrictEqual(findMigrationDirs(tmp), []);
  });

  it('POSITIVE: Atlas — any dir holding atlas.sum', () => {
    plant(tmp, 'schema/atlas.sum', 'h1:abc');
    plant(tmp, 'schema/20240101120000_init.sql', 'CREATE TABLE a (id int);');
    assert.deepStrictEqual(findMigrationDirs(tmp).map((d) => [d.rel, d.kind]), [['schema', 'atlas']]);
  });

  it('only the tree root is returned, not its subdirectories', () => {
    plant(tmp, 'migrations/versions/1975ea83b712_a.py', '');
    plant(tmp, 'migrations/env.py', '');
    assert.deepStrictEqual(findMigrationDirs(tmp).map((d) => d.rel), ['migrations']);
  });

  it('a monorepo yields every tree, sorted', () => {
    plant(tmp, 'apps/api/src/migrations/1700000000000-Init.ts', '');
    plant(tmp, 'apps/web/prisma/migrations/20240102030405_init/migration.sql', '');
    plant(tmp, 'engines/billing/db/migrate/20170806125915_x.rb', '');
    assert.deepStrictEqual(findMigrationDirs(tmp).map((d) => d.rel), [
      'apps/api/src/migrations', 'apps/web/prisma/migrations', 'engines/billing/db/migrate',
    ]);
  });
});

describe('scanMigrationDirs — named like one is not being one', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-migdirs-neg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('NEGATIVE: a directory that merely contains the word is not walked as one', () => {
    plant(tmp, 'src/migrationsHelper/index.js', 'DROP TABLE x');
    plant(tmp, 'docs/migration-guide/v2.md', 'DROP TABLE x');
    plant(tmp, 'docs/migration/index.md', 'DROP TABLE x');
    const { dirs, skipped } = scanMigrationDirs(tmp);
    assert.deepStrictEqual(dirs, []);
    assert.deepStrictEqual(skipped, []);
  });

  it('NEGATIVE: a framework\'s migration implementation is skipped with a reason', () => {
    // django/db/migrations/, src/Illuminate/Database/Migrations/, prisma's
    // packages/…/src/core/migrations/op-factory-call.ts — all real.
    plant(tmp, 'django/db/migrations/loader.py', 'DROP TABLE');
    plant(tmp, 'django/db/migrations/executor.py', '');
    plant(tmp, 'src/Illuminate/Database/Migrations/Migrator.php', '');
    plant(tmp, 'packages/postgres/src/core/migrations/op-factory-call.ts', 'DROP TABLE');
    const { dirs, skipped } = scanMigrationDirs(tmp);
    assert.deepStrictEqual(dirs, []);
    assert.deepStrictEqual(skipped.map((d) => d.rel), [
      'django/db/migrations', 'packages/postgres/src/core/migrations', 'src/Illuminate/Database/Migrations',
    ]);
    assert.ok(skipped.every((d) => /no ordered migration entries/.test(d.reason)), JSON.stringify(skipped));
  });

  it('NEGATIVE: docs that live in a dir called migrations', () => {
    plant(tmp, 'docs/design/migrations/active-record.md', 'CREATE TABLE users');
    const { dirs, skipped } = scanMigrationDirs(tmp);
    assert.deepStrictEqual(dirs, []);
    assert.deepStrictEqual(skipped.map((d) => d.rel), ['docs/design/migrations']);
  });

  it('an empty conventional dir is skipped as empty, not reported as a tree', () => {
    fs.mkdirSync(path.join(tmp, 'migrations'), { recursive: true });
    const { dirs, skipped } = scanMigrationDirs(tmp);
    assert.deepStrictEqual(dirs, []);
    assert.deepStrictEqual(skipped.map((d) => [d.rel, d.reason]), [['migrations', 'empty']]);
  });

  it('CONTROL: the same framework dir with one ordered entry beside the source is a tree', () => {
    plant(tmp, 'django/db/migrations/loader.py', '');
    plant(tmp, 'django/db/migrations/0001_initial.py', '');
    assert.deepStrictEqual(findMigrationDirs(tmp).map((d) => [d.rel, d.ordered]), [['django/db/migrations', true]]);
  });

  it('`ordered` is false only for a hand-named raw SQL set', () => {
    plant(tmp, 'migrations/create_users.sql', '');
    plant(tmp, 'migrations/add_email.sql', '');
    plant(tmp, 'other/db/changelog/db.changelog-master.xml', '');
    assert.deepStrictEqual(findMigrationDirs(tmp).map((d) => [d.rel, d.ordered]), [
      ['migrations', false], ['other/db/changelog', true],
    ]);
  });
});

describe('the walk shares BaseModule\'s excludes', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-migdirs-excl-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('WALK_EXCLUDES is the one list in src/core/walk-excludes.js, which BaseModule._collectFiles also imports', () => {
    const { WALK_EXCLUDES: canonical } = require('../src/core/walk-excludes');
    assert.deepStrictEqual([...WALK_EXCLUDES].sort(), [...canonical].sort());
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'base-module.js'), 'utf-8');
    assert.match(src, /require\('\.\.\/core\/walk-excludes'\)/, 'base-module must import the list, not carry a copy');
    assert.doesNotMatch(src, /const defaultExcludes = \[/, 'base-module re-declares the exclude list');
  });

  it('does not descend into node_modules, vendor, dist, .git', () => {
    plant(tmp, 'node_modules/pkg/migrations/001_x.sql', '');
    plant(tmp, 'vendor/pkg/db/migrate/20170806125915_x.rb', '');
    plant(tmp, 'dist/migrations/001_x.sql', '');
    plant(tmp, '.git/migrations/001_x.sql', '');
    assert.deepStrictEqual(findMigrationDirs(tmp), []);
  });

  it('isUnderMigrationDir is prefix-with-separator, not substring', () => {
    plant(tmp, 'migrations/001_a.sql', '');
    plant(tmp, 'migrations2/001_b.sql', '');
    const dirs = findMigrationDirs(tmp);
    assert.strictEqual(isUnderMigrationDir(path.join(tmp, 'migrations', '001_a.sql'), dirs), true);
    assert.strictEqual(isUnderMigrationDir(path.join(tmp, 'migrations2', '001_b.sql'), dirs), false);
    assert.strictEqual(isUnderMigrationDir(path.join(tmp, 'migrations'), dirs), false);
  });
});
