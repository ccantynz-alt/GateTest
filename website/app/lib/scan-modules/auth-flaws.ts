/**
 * authFlaws module — #21. Catches the authentication anti-patterns that
 * show up in real post-mortems:
 *
 *   - jwt.verify(..., { algorithms: ["none"] }) or alg: "none".
 *   - Hardcoded JWT / session secrets.
 *   - bcrypt / scrypt with insufficient work factor.
 *   - md5 / sha1 used for password hashing.
 *   - Password validation allowing < 8 characters.
 *   - Missing / very large session TTLs.
 *   - process.env.JWT_SECRET with an "||" fallback to a constant.
 *
 * Pure static analysis of source files. No runtime, no dependencies.
 */
import type { ModuleContext, ModuleOutput, ModuleRunner, RepoFile } from "./types";

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|rs|php)$/i;

function isSource(f: RepoFile): boolean {
  return SOURCE_EXT.test(f.path);
}

function isTest(p: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(p) || /\.(test|spec)\./i.test(p);
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
  /** Only apply this rule to files matching (default: all source files). */
  pathFilter?: RegExp;
}

const RULES: Rule[] = [
  {
    name: "JWT alg:none",
    re: /algorithms?\s*:\s*\[\s*['"](none|None|NONE)['"]\s*\]/,
    message: "JWT verify allows alg: none — any attacker can forge tokens",
  },
  {
    name: "JWT alg:none option",
    re: /\balgorithm\s*:\s*['"](none|None|NONE)['"]/,
    message: "JWT signed with algorithm: none — tokens are unauthenticated",
  },
  {
    name: "hardcoded JWT secret",
    re: /(JWT_SECRET|jwtSecret)\s*[:=]\s*['"`][A-Za-z0-9_\-!@#$%^&*()+=]{6,}['"`]/,
    message: "JWT secret hardcoded in source — move to env var",
  },
  {
    name: "env secret with fallback",
    re: /process\.env\.(JWT_SECRET|SESSION_SECRET|COOKIE_SECRET|AUTH_SECRET)\s*\|\|\s*['"`][^'"`\n]{3,}['"`]/,
    message: "env secret has a hardcoded string fallback — strip the fallback, fail fast if unset",
  },
  {
    name: "bcrypt low rounds",
    re: /bcrypt\.(hash|hashSync|genSalt|genSaltSync)\s*\(\s*[^,)]+,\s*(\d+)/,
    message:
      "bcrypt with a numeric work factor — verify it's ≥ 10 (modern guidance 12+); see the matched line",
  },
  {
    name: "md5 for passwords",
    re: /createHash\s*\(\s*['"]md5['"]\s*\)[\s\S]{0,80}(password|pwd|passwd)/i,
    message: "MD5 used for password hashing — switch to bcrypt/argon2/scrypt",
  },
  {
    name: "sha1 for passwords",
    re: /createHash\s*\(\s*['"]sha1['"]\s*\)[\s\S]{0,80}(password|pwd|passwd)/i,
    message: "SHA-1 used for password hashing — switch to bcrypt/argon2/scrypt",
  },
  {
    name: "weak password min length",
    re: /(password|pwd|passwd)[^,;{}\n]{0,50}length\s*[<>=]=?\s*([0-7])\b/i,
    message: "password length check < 8 — raise the minimum",
  },
  {
    name: "eternal session",
    re: /maxAge\s*:\s*(31536000000|86400000\s*\*\s*365|Infinity|Number\.MAX)/,
    message: "session maxAge is a year or more — shorten the TTL",
  },
  {
    name: "http-only disabled",
    re: /httpOnly\s*:\s*false/,
    message: "cookie httpOnly: false — expose token to JS/XSS",
  },
  {
    name: "secure:false in prod-looking cookie",
    re: /cookie[\s\S]{0,200}secure\s*:\s*false(?![\s\S]{0,200}process\.env\.NODE_ENV)/i,
    message: "cookie secure: false without a NODE_ENV guard — cookie sent over plain HTTP",
  },
  {
    name: "sameSite:none without secure",
    re: /sameSite\s*:\s*['"]none['"][\s\S]{0,200}secure\s*:\s*false/i,
    message: "sameSite: none requires secure: true — browsers will reject the cookie",
  },
];

export const authFlaws: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const files = ctx.fileContents.filter((f) => isSource(f) && !isTest(f.path));
  if (files.length === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no non-test source files to inspect",
    };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of files) {
    // A lightweight prefilter: only run expensive regexes if the file even
    // touches auth-ish symbols. Keeps the full-scan within budget.
    const touchesAuth =
      /jwt|session|bcrypt|scrypt|argon|password|cookie|httpOnly|sameSite|createHash|pbkdf2/i.test(
        f.content
      );
    if (!touchesAuth) continue;

    for (const rule of RULES) {
      checks++;
      if (rule.pathFilter && !rule.pathFilter.test(f.path)) continue;
      const m = rule.re.exec(f.content);
      if (!m) continue;
      // bcrypt rule fires but is only an issue if rounds < 10.
      if (rule.name === "bcrypt low rounds") {
        const rounds = Number(m[2]);
        if (!Number.isFinite(rounds) || rounds >= 10) continue;
      }
      issues++;
      details.push(`${f.path}:${lineOf(f.content, m.index)}: ${rule.message}`);
    }
  }

  if (checks === 0) {
    return {
      checks: 0,
      issues: 0,
      details: [],
      skipped: "no files referenced auth primitives (jwt/session/bcrypt/cookie/password)",
    };
  }
  return { checks, issues, details };
};
