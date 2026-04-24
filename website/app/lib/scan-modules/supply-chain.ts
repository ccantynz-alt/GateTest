/**
 * Supply-chain scan modules — module #16 (maliciousDeps) + module #17 (licenses).
 *
 * maliciousDeps:   Inspects package.json for signals of a compromised / hostile
 *                  dependency — install scripts that download remote code,
 *                  typosquat names against the npm top 50, and known bad
 *                  patterns inside postinstall / preinstall script bodies.
 *
 * licenses:        Parses the "license" field of package.json plus every
 *                  dependency listed, pulls license strings from the npm
 *                  registry, and flags copyleft (GPL, AGPL, SSPL, BUSL) which
 *                  is typically incompatible with closed-source shipping.
 *
 * Runtime-agnostic: fetch + JSON only. No shell, no package-manager binaries.
 */
import type { ModuleContext, ModuleOutput, ModuleRunner } from "./types";

const NPM_REGISTRY = "https://registry.npmjs.org";
const HTTP_TIMEOUT_MS = 6000;
const MAX_CONCURRENT = 8;
const MAX_DEPS = 100;
const MODULE_BUDGET_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/* maliciousDeps — module #16                                          */
/* ------------------------------------------------------------------ */

/**
 * Curated list of the most-installed npm packages. A dep whose name is one
 * Levenshtein-distance from any of these with different characters is treated
 * as a possible typosquat. Intentionally short — if we include too many we
 * start false-flagging legitimate forks.
 */
const TOP_NPM = [
  "react", "react-dom", "lodash", "axios", "express", "chalk", "commander",
  "debug", "moment", "uuid", "dotenv", "jsonwebtoken", "bcrypt", "bcryptjs",
  "next", "vue", "typescript", "eslint", "prettier", "webpack", "vite",
  "rollup", "tailwindcss", "postcss", "zod", "yup", "dayjs", "date-fns",
  "mongoose", "pg", "mysql2", "redis", "socket.io", "graphql", "apollo-client",
  "stripe", "cors", "helmet", "passport", "body-parser", "cookie-parser",
  "multer", "nodemailer", "sharp", "puppeteer", "playwright", "cypress",
  "jest", "mocha", "vitest",
];

/** Simple Levenshtein — capped to strings under 40 chars. */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length > 40 || b.length > 40) return 999;
  const dp: number[] = Array(b.length + 1).fill(0);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function isTyposquat(name: string): string | null {
  // Ignore scoped packages — @org/name is unlikely to typosquat a bare name.
  if (name.startsWith("@")) return null;
  for (const top of TOP_NPM) {
    if (name === top) return null;
    if (Math.abs(name.length - top.length) > 2) continue;
    const d = lev(name, top);
    if (d > 0 && d <= 1) return top;
  }
  return null;
}

const SUSPICIOUS_SCRIPT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "curl | sh", re: /curl[^;\n]*\|\s*(sh|bash|zsh)/i },
  { name: "wget | sh", re: /wget[^;\n]*\|\s*(sh|bash|zsh)/i },
  { name: "eval of remote response", re: /eval\s*\(\s*(require|fetch|http)/ },
  { name: "base64 decode + exec", re: /Buffer\.from\([^)]+,\s*['"]base64['"]\)[\s\S]{0,80}(exec|spawn|eval)/ },
  { name: "child_process.exec on $ENV", re: /child_process[\s\S]{0,60}exec[\s\S]{0,40}process\.env/ },
  { name: "http get + child_process", re: /require\(['"]https?['"]\)[\s\S]{0,200}child_process/ },
  { name: "new Function on remote data", re: /new\s+Function\s*\(\s*(require|await\s+fetch)/ },
];

export const maliciousDeps: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const pkgFile = ctx.fileContents.find((f) => f.path === "package.json");
  if (!pkgFile) {
    return { checks: 0, issues: 0, details: [], skipped: "no package.json at repo root" };
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgFile.content);
  } catch {
    return { checks: 1, issues: 1, details: ["package.json: invalid JSON — cannot inspect"] };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  // 1. Typosquat detection on every dep name.
  const allDepNames = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  for (const name of allDepNames) {
    checks++;
    const squat = isTyposquat(name);
    if (squat) {
      issues++;
      details.push(
        `package.json: "${name}" is one character away from "${squat}" — possible typosquat`
      );
    }
  }

  // 2. Suspicious patterns in lifecycle scripts.
  const scripts = pkg.scripts ?? {};
  const lifecycleHooks = [
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "prepublishOnly",
    "prepare",
  ];
  for (const hook of lifecycleHooks) {
    const body = scripts[hook];
    if (!body) continue;
    checks++;
    for (const p of SUSPICIOUS_SCRIPT_PATTERNS) {
      if (p.re.test(body)) {
        issues++;
        details.push(`package.json scripts.${hook}: matches "${p.name}" — review for supply-chain risk`);
      }
    }
  }

  // 3. Any non-script file in fileContents can also hide postinstall payloads.
  //    Skim for the same patterns in JS files at repo root.
  for (const f of ctx.fileContents) {
    if (!/(^|\/)(install|postinstall|preinstall|setup)\.(js|cjs|mjs|sh)$/i.test(f.path)) continue;
    checks++;
    for (const p of SUSPICIOUS_SCRIPT_PATTERNS) {
      if (p.re.test(f.content)) {
        issues++;
        details.push(`${f.path}: matches "${p.name}" — review for supply-chain risk`);
      }
    }
  }

  if (checks === 0) {
    return { checks: 0, issues: 0, details: [], skipped: "no dependencies or lifecycle scripts to inspect" };
  }
  return { checks, issues, details };
};

/* ------------------------------------------------------------------ */
/* licenses — module #17                                               */
/* ------------------------------------------------------------------ */

/** Licenses that typically block closed-source shipping when linked at build-time. */
const COPYLEFT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "GPL", re: /^GPL($|-)/i },
  { name: "AGPL", re: /^AGPL/i },
  { name: "LGPL", re: /^LGPL/i },
  { name: "SSPL", re: /^SSPL/i },
  { name: "BUSL / Business Source", re: /^BUSL/i },
  { name: "CDDL", re: /^CDDL/i },
  { name: "EPL", re: /^EPL/i },
  { name: "MPL-1", re: /^MPL-1/i },
];

interface NpmPackageLicense {
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  "dist-tags"?: { latest?: string };
  versions?: Record<string, { license?: string | { type?: string } }>;
}

function extractLicense(meta: NpmPackageLicense, pinnedVersion: string): string | null {
  // Try pinned version first, then latest, then top-level license field.
  const v = meta.versions?.[pinnedVersion] ?? (meta["dist-tags"]?.latest
    ? meta.versions?.[meta["dist-tags"]!.latest!]
    : undefined);
  const candidates: (string | { type?: string } | undefined)[] = [
    v?.license,
    meta.license,
    ...(meta.licenses ?? []),
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "object" && c.type) return c.type.trim();
  }
  return null;
}

function flagCopyleft(license: string): string | null {
  for (const p of COPYLEFT_PATTERNS) {
    if (p.re.test(license)) return p.name;
  }
  return null;
}

async function fetchLicense(name: string, version: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${NPM_REGISTRY}/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const meta = (await res.json()) as NpmPackageLicense;
    return extractLicense(meta, version);
  } catch {
    return null;
  }
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  deadlineAt: number
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      if (Date.now() > deadlineAt) return;
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export const licenses: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const pkgFile = ctx.fileContents.find((f) => f.path === "package.json");
  if (!pkgFile) {
    return { checks: 0, issues: 0, details: [], skipped: "no package.json at repo root" };
  }

  let pkg: {
    license?: string | { type?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgFile.content);
  } catch {
    return { checks: 1, issues: 1, details: ["package.json: invalid JSON"] };
  }

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  // 1. Our own license field — warn if missing (SaaS shipping un-licensed code
  //    is a real compliance smell even when the repo is private).
  checks++;
  const ownLicense =
    typeof pkg.license === "string"
      ? pkg.license
      : typeof pkg.license === "object" && pkg.license?.type
        ? pkg.license.type
        : null;
  if (!ownLicense) {
    issues++;
    details.push("package.json: no top-level \"license\" field declared");
  }

  // 2. Every dep: fetch its license, flag copyleft.
  const allDeps = [
    ...Object.entries(pkg.dependencies ?? {}),
    ...Object.entries(pkg.devDependencies ?? {}),
  ]
    .map(([name, spec]) => {
      const cleaned = spec.replace(/^[\^~>=<\s]+/, "").split(/\s|\|/)[0] || spec;
      return { name, version: /^\d/.test(cleaned) ? cleaned : "latest" };
    })
    .filter((d) => !d.name.startsWith("file:") && !d.name.startsWith("workspace:"));

  const truncated = allDeps.length > MAX_DEPS;
  const deps = allDeps.slice(0, MAX_DEPS);
  const deadlineAt = Date.now() + MODULE_BUDGET_MS;

  await mapLimit(
    deps,
    MAX_CONCURRENT,
    async (dep) => {
      checks++;
      const lic = await fetchLicense(dep.name, dep.version);
      if (!lic) return;
      const flagged = flagCopyleft(lic);
      if (flagged) {
        issues++;
        details.push(
          `${dep.name}@${dep.version}: ${lic} — ${flagged} is copyleft and may require open-sourcing your product`
        );
      }
    },
    deadlineAt
  );

  if (truncated) {
    details.push(
      `package.json: only first ${MAX_DEPS} of ${allDeps.length} dependencies inspected (per-scan cap)`
    );
  }

  return { checks, issues, details };
};
