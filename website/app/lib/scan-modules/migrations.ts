/**
 * migrations module — #20. Inspects SQL migration files for dangerous
 * patterns that cause real production outages:
 *
 *   - DROP COLUMN / DROP TABLE without a corresponding rollback step.
 *   - ALTER TABLE ... ADD COLUMN ... NOT NULL without a DEFAULT — locks the
 *     table and fails on any existing row on most engines.
 *   - CREATE INDEX without CONCURRENTLY (Postgres) — blocks writes for the
 *     entire build of the index on large tables.
 *   - DELETE / UPDATE without WHERE — wipes the whole table.
 *   - TRUNCATE — almost always a mistake when left in a migration.
 *
 * Pure text analysis. No database connection, no binary. Works on Vercel
 * today, identical behaviour in GlueCron.
 */
import type { ModuleContext, ModuleOutput, ModuleRunner, RepoFile } from "./types";

const MIGRATION_PATH_RE =
  /(^|\/)(migrations?|db\/migrate|drizzle|prisma\/migrations|supabase\/migrations|schemas?)(\/|$)/i;

function isMigrationFile(path: string): boolean {
  if (!/\.(sql|SQL)$/.test(path)) return false;
  if (MIGRATION_PATH_RE.test(path)) return true;
  // Numeric prefix like 0001_init.sql is the near-universal convention.
  const base = path.split("/").pop() || "";
  return /^\d{3,}[_-]/.test(base);
}

/**
 * Strip SQL line and block comments so regex matches aren't false-positive
 * in a commented-out example.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function lineOf(content: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx && i < content.length; i++) if (content[i] === "\n") n++;
  return n;
}

interface Rule {
  name: string;
  re: RegExp;
  message: string;
  /** If provided, match only when this *also* does NOT appear anywhere in the file. */
  absentUnless?: RegExp;
}

const RULES: Rule[] = [
  {
    name: "DROP COLUMN",
    re: /\bALTER\s+TABLE\s+[^\s;]+\s+DROP\s+COLUMN\s+/i,
    message:
      "DROP COLUMN — destructive and non-reversible; ship a two-phase migration (stop writing, deploy, then drop)",
  },
  {
    name: "DROP TABLE",
    re: /\bDROP\s+TABLE\s+(?!IF\s+EXISTS\s+)?[^\s;]+/i,
    message: "DROP TABLE — destructive; confirm you have a tested restore path",
  },
  {
    name: "ADD COLUMN NOT NULL without DEFAULT",
    re: /\bALTER\s+TABLE\s+[^\s;]+\s+ADD\s+COLUMN\s+[^\s;]+\s+[A-Z0-9_(),\s]+NOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i,
    message:
      "ADD COLUMN ... NOT NULL without DEFAULT — will fail on any existing row; add a DEFAULT or backfill then set NOT NULL",
  },
  {
    name: "CREATE INDEX without CONCURRENTLY",
    re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?![^;]*\bCONCURRENTLY\b)/i,
    message:
      "CREATE INDEX without CONCURRENTLY — blocks writes for the whole index build on Postgres; add CONCURRENTLY",
  },
  {
    name: "DELETE without WHERE",
    re: /\bDELETE\s+FROM\s+[^\s;]+\s*(;|$)/i,
    message: "DELETE without WHERE — wipes the entire table",
  },
  {
    name: "UPDATE without WHERE",
    re: /\bUPDATE\s+[^\s;]+\s+SET\s+[^;]+?(?<!\bWHERE\b[^;]{0,400})(;|$)/i,
    message: "UPDATE without WHERE — rewrites every row in the table",
  },
  {
    name: "TRUNCATE",
    re: /\bTRUNCATE\s+(?:TABLE\s+)?[^\s;]+/i,
    message: "TRUNCATE in a migration — data loss on every deploy",
  },
  {
    name: "RENAME COLUMN",
    re: /\bALTER\s+TABLE\s+[^\s;]+\s+RENAME\s+COLUMN\s+/i,
    message:
      "RENAME COLUMN — breaks any still-running app version; use expand/contract: add new column, backfill, switch, drop",
  },
  {
    name: "ALTER COLUMN TYPE",
    re: /\bALTER\s+TABLE\s+[^\s;]+\s+ALTER\s+COLUMN\s+[^\s;]+\s+TYPE\s+/i,
    message:
      "ALTER COLUMN TYPE — rewrites the table on most engines; plan for a lock window or online migration",
  },
];

export const migrations: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const migrationFiles: RepoFile[] = ctx.fileContents.filter((f) => isMigrationFile(f.path));
  if (migrationFiles.length === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no SQL migration files found",
    };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of migrationFiles) {
    const sql = stripSqlComments(f.content);
    for (const rule of RULES) {
      checks++;
      const m = rule.re.exec(sql);
      if (!m) continue;
      if (rule.absentUnless && rule.absentUnless.test(sql)) continue;
      issues++;
      // lineOf references the stripped content; close enough for the user to find the statement.
      details.push(`${f.path}:${lineOf(sql, m.index)}: ${rule.message}`);
    }
  }

  return { checks, issues, details };
};
