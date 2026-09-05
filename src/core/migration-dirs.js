'use strict';

/**
 * One answer to "where do this repo's schema migrations live?"
 *
 * KI #106 / the Fifty move 11. Two modules had their own answer and both
 * were wrong in different directions: `dataIntegrity` probed four literal
 * paths at the project root (`migrations`, `db/migrations`,
 * `database/migrations`, `prisma/migrations`) and read only the files
 * DIRECTLY inside — so a Rails `db/migrate`, an Alembic `alembic/versions`,
 * a Flyway `db/migration`, a Django `<app>/migrations/` two levels down, or
 * Prisma's own nested `prisma/migrations/<ts>/migration.sql` all reported
 * "No migration directory found". `sqlMigrations` matched any segment
 * spelled `migration`/`migrate` anywhere, which is how a framework's
 * migration IMPLEMENTATION (`activerecord/lib/active_record/migration`,
 * `packages/…/tooling/migration`, `docs/…/migration`) counted as a
 * migration tree. This file is the convention, once, for both.
 *
 * Layouts recognised (dir path is repo-relative, segment-anchored,
 * case-insensitive — EF Core capitalises `Migrations/`):
 *   `migrations`            Knex · Sequelize · TypeORM `src/migrations` ·
 *                           Django `<app>/migrations` · Laravel
 *                           `database/migrations` · Supabase · Prisma ·
 *                           golang-migrate `db/migrations` · EF Core
 *   `db/migrate`            Rails ActiveRecord
 *   `db/migration`          Flyway (`src/main/resources/db/migration`)
 *   `db/changelog`          Liquibase
 *   `alembic/versions`      Alembic
 *   `drizzle` + a sibling `drizzle.config.*`   Drizzle Kit (marker-based —
 *                           the dir name alone is too common a word)
 *   any dir holding `atlas.sum`                 Atlas (marker-based)
 *
 * Deliberately NOT a bare `migration` / `migrate` segment: across the
 * real-world corpus every such dir was framework source or docs (rails ×4,
 * laravel, prisma ×3, trpc ×2) and not one was a migration tree. Flyway is
 * the only tool that uses the singular, and Flyway puts it under `db/`.
 *
 * The name is necessary, not sufficient. `django/db/migrations/` is
 * Django's migration FRAMEWORK (`loader.py`, `executor.py`),
 * `src/Illuminate/Database/Migrations/` is Laravel's, prisma's
 * `packages/…/src/core/migrations/op-factory-call.ts` renders DDL — and a
 * substring rule reading those as migrations reported four BLOCKING
 * "DROP TABLE without IF EXISTS" on a DDL renderer (measured 2026-09-05).
 * A migration TREE is one whose entries carry an ordered name (timestamp,
 * sequence, Flyway version, Alembic revision — `ORDERED_NAME_RE`, within
 * two levels because Prisma nests `<ts>/migration.sql`), or which holds raw
 * `.sql` files, or which a tool marker identifies. Everything else that is
 * merely NAMED like one is returned under `skipped` so the caller can say
 * it was not checked (Doctrine §6) rather than silently pass it.
 */

const fs = require('fs');
const path = require('path');

// A COPY of the default exclude list in `BaseModule._collectFiles`
// (src/modules/base-module.js). core/ cannot require modules/ without
// inverting the layering, and BaseModule does not export the list. If that
// list changes, change this one — tests/migration-dirs.test.js pins the two
// together.
const WALK_EXCLUDES = new Set(require('./walk-excludes').WALK_EXCLUDES);

/**
 * Name conventions, each with the tool family it belongs to. The regex is
 * built from this table so the classification and the match cannot drift.
 */
const CONVENTIONS = [
  { kind: 'migrations', source: String.raw`migrations` },
  { kind: 'rails', source: String.raw`db\/migrate` },
  { kind: 'flyway', source: String.raw`db\/migration` },
  { kind: 'liquibase', source: String.raw`db\/changelog` },
  { kind: 'alembic', source: String.raw`alembic\/versions` },
];

/**
 * Tested against a repo-relative DIRECTORY path (forward slashes). Anchored
 * on a segment boundary at the front and the end of the path, so
 * `src/migrationsHelper`, `docs/migration-guide`, `adb/migrate` and
 * `lib/active_record/migration` stay quiet.
 */
const MIGRATION_DIR_RE = new RegExp(
  String.raw`(?:^|\/)(?:${CONVENTIONS.map((c) => c.source).join('|')})$`,
  'i',
);

const DRIZZLE_CONFIG_RE = /^drizzle\.config\.(?:[cm]?[jt]s|json)$/i;
const ATLAS_SUM = 'atlas.sum';

/**
 * An entry name that carries migration ORDER, each shape from a tool's
 * documented convention: timestamp (Rails, Laravel, Prisma, Supabase, Knex,
 * Sequelize, EF Core, Atlas, golang-migrate's `000001_`), epoch-ms
 * (TypeORM), sequence (Django `0001_`, Drizzle `0000_`), Flyway
 * `V1_2__desc` / `U…__` / `R__`, Alembic's 12-hex revision id.
 */
const ORDERED_NAME_RE = /^(?:\d{4}|\d{13,}|\d{3,4}_|[VU]\d[\w.]*__|R__|[0-9a-f]{12}_)/;

// How deep an ordered entry may sit below the dir and still make it a tree:
// Prisma is `<ts>/migration.sql`, Prisma 8 is `app/<ts>/migration.ts`.
const ORDERED_ENTRY_DEPTH = 2;

// Snapshot / journal dirs that live INSIDE a migration tree but hold tool
// state, not migrations (Drizzle's `meta/`).
const NON_MIGRATION_SUBDIRS = new Set(['meta']);

function normalise(rel) {
  return String(rel || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Which convention does this repo-relative dir path follow, or null. */
function migrationDirKind(relDir) {
  const rel = normalise(relDir);
  if (!rel) return null;
  for (const c of CONVENTIONS) {
    if (new RegExp(String.raw`(?:^|\/)${c.source}$`, 'i').test(rel)) return c.kind;
  }
  return null;
}

/** Does this repo-relative dir path follow a migration-dir naming convention? */
function isMigrationDirPath(relDir) {
  return MIGRATION_DIR_RE.test(normalise(relDir));
}

function readDirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function visibleEntries(dir) {
  return readDirEntries(dir).filter((e) => !e.name.startsWith('.')
    && !(e.isDirectory() && (WALK_EXCLUDES.has(e.name) || NON_MIGRATION_SUBDIRS.has(e.name.toLowerCase()))));
}

/** Does any entry within `depth` levels carry an ordered migration name? */
function hasOrderedEntry(dir, depth) {
  const entries = visibleEntries(dir);
  if (entries.some((e) => ORDERED_NAME_RE.test(e.name))) return true;
  if (depth <= 1) return false;
  return entries.some((e) => e.isDirectory() && hasOrderedEntry(path.join(dir, e.name), depth - 1));
}

/**
 * Why a conventionally-named dir is (or is not) a migration tree.
 * @returns {{tree: boolean, ordered: boolean, reason?: string}}
 */
function classifyTree(dirAbs, kind) {
  if (hasOrderedEntry(dirAbs, ORDERED_ENTRY_DEPTH)) return { tree: true, ordered: true };
  // Order carried by the tool's own ledger — `atlas.sum`, Drizzle's
  // `meta/_journal.json`, the Liquibase master changelog — so a naming rule
  // has nothing to say: reported as ordered.
  if (kind === 'drizzle' || kind === 'atlas' || kind === 'liquibase') return { tree: true, ordered: true };
  const ordered = false;
  const entries = visibleEntries(dirAbs);
  if (entries.length === 0) return { tree: false, ordered, reason: 'empty' };
  // Hand-named raw SQL sets (`migrations/create_users.sql`) are migrations
  // with a naming problem, not source code — keep them, let the naming rule
  // say so.
  if (entries.some((e) => e.isFile() && /\.sql$/i.test(e.name))) return { tree: true, ordered };
  return { tree: false, ordered, reason: 'no ordered migration entries — source or docs named like a migration dir' };
}

/**
 * Every migration directory in the project, walking with the same excludes
 * as the module file walk. A matched directory is returned and NOT
 * descended into (Alembic's `migrations/versions` is part of the
 * `migrations` tree, not a second tree).
 *
 * @returns {{
 *   dirs: {abs: string, rel: string, kind: string, ordered: boolean}[],
 *   skipped: {abs: string, rel: string, kind: string, reason: string}[],
 * }} each sorted by `rel`. `ordered` is false only for a raw-`.sql` set
 * whose names carry no order — the one case the naming rule is for.
 */
function scanMigrationDirs(projectRoot) {
  const dirs = [];
  const skipped = [];
  const root = path.resolve(projectRoot);

  const walk = (dir, rel) => {
    const entries = readDirEntries(dir);
    const hasDrizzleConfig = entries.some((e) => e.isFile() && DRIZZLE_CONFIG_RE.test(e.name));
    for (const entry of entries) {
      if (!entry.isDirectory() || WALK_EXCLUDES.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(dir, entry.name);
      const kind = migrationDirKind(childRel)
        || (hasDrizzleConfig && entry.name.toLowerCase() === 'drizzle' ? 'drizzle' : null)
        || (fs.existsSync(path.join(childAbs, ATLAS_SUM)) ? 'atlas' : null);
      if (!kind) {
        walk(childAbs, childRel);
        continue;
      }
      const verdict = classifyTree(childAbs, kind);
      if (verdict.tree) dirs.push({ abs: childAbs, rel: childRel, kind, ordered: verdict.ordered });
      else skipped.push({ abs: childAbs, rel: childRel, kind, reason: verdict.reason });
    }
  };

  walk(root, '');
  const byRel = (a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  return { dirs: dirs.sort(byRel), skipped: skipped.sort(byRel) };
}

/** The migration trees only — `scanMigrationDirs(projectRoot).dirs`. */
function findMigrationDirs(projectRoot) {
  return scanMigrationDirs(projectRoot).dirs;
}

/**
 * The migration files inside one migration directory: every non-hidden
 * file at any depth (Prisma nests `<timestamp>/migration.sql`), skipping
 * tool-state subdirs and the walk excludes.
 *
 * @returns {string[]} absolute paths, sorted
 */
function listMigrationFiles(dirAbs) {
  const files = [];
  const walk = (dir) => {
    for (const entry of visibleEntries(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dirAbs);
  return files.sort();
}

/**
 * Is this absolute file path inside one of `dirs` (as returned by
 * `findMigrationDirs`)? Prefix-with-separator, so `migrations2/x.sql` is
 * not "under" `migrations`.
 */
function isUnderMigrationDir(absFile, dirs) {
  const file = path.resolve(absFile);
  return dirs.some((d) => file.startsWith(path.resolve(d.abs) + path.sep));
}

module.exports = {
  MIGRATION_DIR_RE,
  ORDERED_NAME_RE,
  WALK_EXCLUDES,
  migrationDirKind,
  isMigrationDirPath,
  scanMigrationDirs,
  findMigrationDirs,
  listMigrationFiles,
  isUnderMigrationDir,
};
