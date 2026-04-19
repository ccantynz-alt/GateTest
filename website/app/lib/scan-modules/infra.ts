/**
 * Infrastructure & Supply-chain modules for the web scanner.
 *
 * These port the CLI module pattern-matching logic to work with in-memory
 * file contents (RepoFile[]) instead of filesystem access.
 */

import type { ModuleRunner, ModuleContext, ModuleOutput } from "./types";

function scan(ctx: ModuleContext, extensions: string[], patterns: Array<{ regex: RegExp; msg: string; severity?: string }>): ModuleOutput {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;
  const files = ctx.fileContents.filter((f) => extensions.some((e) => f.path.endsWith(e)));

  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const p of patterns) {
        p.regex.lastIndex = 0;
        if (p.regex.test(lines[i])) {
          checks++;
          issues++;
          const sev = p.severity || "error";
          details.push(`${sev}: ${file.path}:${i + 1}: ${p.msg}`);
        }
      }
    }
  }
  if (files.length > 0 && issues === 0) checks = files.length;
  return { checks, issues, details };
}

const SRC_EXTS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts"];
const ALL_EXTS = [...SRC_EXTS, ".py", ".go", ".rs", ".java", ".rb", ".php", ".cs", ".kt", ".swift"];

export const errorSwallow: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /catch\s*\([^)]*\)\s*\{\s*\}/, msg: "Empty catch block — errors silently swallowed" },
    { regex: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/, msg: ".catch(() => {}) — promise errors silently discarded" },
    { regex: /\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)/, msg: ".catch(() => null) — error swallowed" },
  ]);
};

export const hardcodedUrl: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /['"`]https?:\/\/localhost[:/]/, msg: "Hardcoded localhost URL", severity: "error" },
    { regex: /['"`]https?:\/\/127\.0\.0\.1[:/]/, msg: "Hardcoded 127.0.0.1", severity: "error" },
    { regex: /['"`]https?:\/\/0\.0\.0\.0[:/]/, msg: "Hardcoded 0.0.0.0", severity: "error" },
    { regex: /['"`]https?:\/\/192\.168\./, msg: "Hardcoded private IP (192.168.x.x)", severity: "error" },
    { regex: /['"`]https?:\/\/10\./, msg: "Hardcoded private IP (10.x.x.x)", severity: "error" },
    { regex: /['"`]https?:\/\/172\.(1[6-9]|2\d|3[01])\./, msg: "Hardcoded private IP (172.16-31.x.x)", severity: "error" },
  ]);
};

export const flakyTests: ModuleRunner = async (ctx) => {
  const testFiles = ctx.fileContents.filter((f) =>
    f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__")
  );
  if (testFiles.length === 0) return { checks: 0, issues: 0, details: [], skipped: "No test files found" };

  return scan({ ...ctx, fileContents: testFiles }, ALL_EXTS, [
    { regex: /\.(only|fit|fdescribe)\s*\(/, msg: "Committed .only / fit / fdescribe — blocks other tests", severity: "error" },
    { regex: /\.(skip|xit|xtest|xdescribe)\s*\(/, msg: "Committed .skip / xit — skipped tests rot", severity: "warning" },
    { regex: /Math\.random\s*\(/, msg: "Math.random() in test — nondeterministic", severity: "warning" },
  ]);
};

export const typescriptStrictness: ModuleRunner = async (ctx) => {
  const tsconfigs = ctx.fileContents.filter((f) => f.path.includes("tsconfig") && f.path.endsWith(".json"));
  if (tsconfigs.length === 0) return { checks: 0, issues: 0, details: [], skipped: "No tsconfig.json found" };

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  for (const f of tsconfigs) {
    checks++;
    if (/"strict"\s*:\s*false/.test(f.content)) { issues++; details.push(`error: ${f.path}: strict: false`); }
    if (/"noImplicitAny"\s*:\s*false/.test(f.content)) { issues++; details.push(`error: ${f.path}: noImplicitAny: false`); }
    if (/"skipLibCheck"\s*:\s*true/.test(f.content)) { issues++; details.push(`warning: ${f.path}: skipLibCheck: true`); }
    if (/"strictNullChecks"\s*:\s*false/.test(f.content)) { issues++; details.push(`warning: ${f.path}: strictNullChecks: false`); }
  }

  const tsFiles = ctx.fileContents.filter((f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx"));
  for (const f of tsFiles) {
    checks++;
    if (/@ts-nocheck/.test(f.content)) { issues++; details.push(`error: ${f.path}: @ts-nocheck suppression`); }
    const anyCount = (f.content.match(/as any/g) || []).length;
    if (anyCount > 3) { issues++; details.push(`warning: ${f.path}: ${anyCount} 'as any' casts`); }
  }

  return { checks, issues, details };
};

export const envVars: ModuleRunner = async (ctx) => {
  const envExample = ctx.fileContents.find((f) => f.path === ".env.example" || f.path.endsWith("/.env.example"));
  if (!envExample) return { checks: 1, issues: 1, details: ["warning: No .env.example file found — env vars undocumented"] };

  const declared = new Set<string>();
  for (const line of envExample.content.split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]+)/);
    if (m) declared.add(m[1]);
  }

  const used = new Set<string>();
  const srcFiles = ctx.fileContents.filter((f) => SRC_EXTS.some((e) => f.path.endsWith(e)));
  for (const f of srcFiles) {
    const matches = f.content.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g);
    for (const m of matches) used.add(m[1]);
  }

  const details: string[] = [];
  let issues = 0;
  const runtime = new Set(["NODE_ENV", "PORT", "CI", "PATH", "HOME", "USER", "SHELL", "TERM", "LANG"]);
  const vercel = /^(VERCEL_|NEXT_RUNTIME|__NEXT_)/;
  const github = /^(GITHUB_|RUNNER_)/;

  for (const key of used) {
    if (runtime.has(key) || vercel.test(key) || github.test(key)) continue;
    if (!declared.has(key)) {
      issues++;
      details.push(`error: ${key} used in code but missing from .env.example`);
    }
  }
  for (const key of declared) {
    if (!used.has(key) && !runtime.has(key)) {
      details.push(`warning: ${key} declared in .env.example but never used in code`);
    }
  }

  return { checks: declared.size + used.size, issues, details };
};

export const deadCode: ModuleRunner = async (ctx) => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;
  const srcFiles = ctx.fileContents.filter((f) => SRC_EXTS.some((e) => f.path.endsWith(e)));

  for (const f of srcFiles) {
    const lines = f.content.split("\n");
    let commentBlock = 0;
    let commentStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("//") && /\/\/\s*(const|let|var|function|if|for|while|return|import|export|class)\s/.test(trimmed)) {
        if (commentBlock === 0) commentStart = i;
        commentBlock++;
      } else {
        if (commentBlock >= 5) {
          checks++;
          issues++;
          details.push(`warning: ${f.path}:${commentStart + 1}: ${commentBlock} lines of commented-out code`);
        }
        commentBlock = 0;
      }
    }
  }

  if (srcFiles.length > 0 && issues === 0) checks = srcFiles.length;
  return { checks, issues, details };
};

export const dependencies: ModuleRunner = async (ctx) => {
  const pkg = ctx.fileContents.find((f) => f.path === "package.json" || f.path.endsWith("/package.json"));
  if (!pkg) return { checks: 0, issues: 0, details: [], skipped: "No package.json found" };

  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  try {
    const parsed = JSON.parse(pkg.content);
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      checks++;
      const v = String(version);
      if (v === "*" || v === "latest") {
        issues++;
        details.push(`error: ${name}: ${v} — unpinned, any version could install`);
      }
    }

    // Check for lockfile
    checks++;
    const hasLock = ctx.files.some((f) => f === "package-lock.json" || f === "yarn.lock" || f === "pnpm-lock.yaml");
    if (!hasLock) {
      issues++;
      details.push("warning: No lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml)");
    }
  } catch {
    issues++;
    details.push("error: package.json is invalid JSON");
  }

  return { checks, issues, details };
};

export const dockerfile: ModuleRunner = async (ctx) => {
  const dockerfiles = ctx.fileContents.filter((f) =>
    f.path.toLowerCase().includes("dockerfile") || f.path.endsWith("Dockerfile")
  );
  if (dockerfiles.length === 0) return { checks: 0, issues: 0, details: [], skipped: "No Dockerfile found" };

  return scan({ ...ctx, fileContents: dockerfiles }, ["Dockerfile", "dockerfile", ".dockerfile"], [
    { regex: /FROM\s+\S+:latest/, msg: "FROM :latest — unpinned base image", severity: "error" },
    { regex: /USER\s+root/, msg: "Running as root user", severity: "warning" },
    { regex: /chmod\s+777/, msg: "chmod 777 — world-writable permissions", severity: "error" },
    { regex: /curl.*\|\s*sh/, msg: "curl | sh — untrusted remote execution", severity: "error" },
    { regex: /ADD\s+https?:\/\//, msg: "ADD from URL — use COPY + explicit download", severity: "warning" },
  ]);
};

export const shell: ModuleRunner = async (ctx) => {
  const shells = ctx.fileContents.filter((f) => f.path.endsWith(".sh") || f.path.endsWith(".bash"));
  if (shells.length === 0) return { checks: 0, issues: 0, details: [], skipped: "No shell scripts found" };

  return scan({ ...ctx, fileContents: shells }, [".sh", ".bash"], [
    { regex: /curl.*\|\s*(ba)?sh/, msg: "curl | sh — untrusted remote execution", severity: "error" },
    { regex: /rm\s+-rf\s+\$/, msg: "rm -rf with unquoted variable — dangerous", severity: "error" },
    { regex: /eval\s+\$/, msg: "eval with variable — injection risk", severity: "error" },
  ]);
};

export const tlsSecurity: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /rejectUnauthorized\s*:\s*false/, msg: "rejectUnauthorized: false — MITM vulnerability", severity: "error" },
    { regex: /NODE_TLS_REJECT_UNAUTHORIZED.*=.*["']0["']/, msg: "NODE_TLS_REJECT_UNAUTHORIZED=0 — TLS disabled globally", severity: "error" },
    { regex: /strictSSL\s*:\s*false/, msg: "strictSSL: false — TLS validation bypassed", severity: "error" },
    { regex: /verify\s*=\s*False/, msg: "verify=False — Python TLS validation disabled", severity: "error" },
  ]);
};

export const cookieSecurity: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /httpOnly\s*:\s*false/, msg: "httpOnly: false — cookie readable by JS (XSS vector)", severity: "error" },
    { regex: /secure\s*:\s*false/, msg: "secure: false — cookie sent over plain HTTP", severity: "warning" },
    { regex: /secret\s*:\s*['"](?:changeme|secret|password|default|test|keyboard cat)['"]/, msg: "Weak session secret — change to a random string", severity: "error" },
  ]);
};

export const ssrf: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /169\.254\.169\.254/, msg: "AWS metadata endpoint hardcoded — SSRF target", severity: "error" },
    { regex: /metadata\.google\.internal/, msg: "GCP metadata endpoint — SSRF target", severity: "error" },
    { regex: /metadata\.azure\.com/, msg: "Azure metadata endpoint — SSRF target", severity: "error" },
  ]);
};

export const asyncIteration: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /\.reduce\s*\(\s*async\b/, msg: ".reduce(async) — silently serialises, accumulator becomes Promise", severity: "error" },
    { regex: /\.filter\s*\(\s*async\b/, msg: ".filter(async) — Promise is truthy, predicate always passes", severity: "error" },
    { regex: /\.some\s*\(\s*async\b/, msg: ".some(async) — Promise is truthy, always returns true", severity: "error" },
    { regex: /\.every\s*\(\s*async\b/, msg: ".every(async) — Promise is truthy, always returns true", severity: "error" },
    { regex: /\.forEach\s*\(\s*async\b/, msg: ".forEach(async) — does not await, enclosing function returns early", severity: "warning" },
  ]);
};

export const retryHygiene: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /while\s*\(\s*true\s*\)[\s\S]{0,200}fetch\s*\(/, msg: "Unbounded retry loop with fetch — no break/max attempts", severity: "error" },
    { regex: /for\s*\(\s*;;\s*\)[\s\S]{0,200}fetch\s*\(/, msg: "Infinite for(;;) with fetch — unbounded retry", severity: "error" },
  ]);
};

export const nPlusOne: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /\.forEach\s*\([\s\S]{0,100}await\s+[\s\S]{0,50}\.find/, msg: "DB query inside forEach — N+1 query pattern", severity: "warning" },
    { regex: /for\s*\([\s\S]{0,100}await\s+[\s\S]{0,50}\.query/, msg: "DB query inside for loop — N+1 pattern", severity: "warning" },
    { regex: /\.map\s*\(\s*async[\s\S]{0,100}prisma\./, msg: "Prisma query inside .map(async) — N+1", severity: "warning" },
  ]);
};

export const logPii: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /console\.(log|info|debug|warn|error)\s*\(\s*(password|token|secret|apiKey|credential|authorization|accessToken|refreshToken|jwt|cookie|session|ssn|creditCard|cvv|pin|privateKey)\s*[,)]/, msg: "Logging sensitive data (PII/credentials)", severity: "error" },
    { regex: /console\.(log|info|debug)\s*\(\s*(req|request|body|payload|headers)\s*[,)]/, msg: "Logging request/body object — may contain PII", severity: "warning" },
    { regex: /JSON\.stringify\s*\(\s*(user|member|account|profile|customer)\s*\)/, msg: "JSON.stringify on user-like object — PII exposure risk", severity: "warning" },
  ]);
};

export const moneyFloat: ModuleRunner = async (ctx) => {
  return scan(ctx, SRC_EXTS, [
    { regex: /(price|total|amount|tax|fee|subtotal|balance|discount)\s*=\s*parseFloat\s*\(/, msg: "parseFloat on money-named variable — IEEE-754 precision loss", severity: "error" },
    { regex: /(price|total|amount|tax|fee)\s*=\s*Number\s*\(/, msg: "Number() on money-named variable — float precision", severity: "error" },
    { regex: /\.(toFixed)\s*\(\s*[01]\s*\)/, msg: ".toFixed(0) or .toFixed(1) — sub-cent precision loss", severity: "warning" },
  ]);
};

export const importCycle: ModuleRunner = async (ctx) => {
  const srcFiles = ctx.fileContents.filter((f) => SRC_EXTS.some((e) => f.path.endsWith(e)));
  const graph = new Map<string, Set<string>>();

  for (const f of srcFiles) {
    const imports = new Set<string>();
    const importMatches = f.content.matchAll(/(?:import\s+.*\s+from|require\s*\(\s*)['"](\.[^'"]+)['"]/g);
    for (const m of importMatches) {
      const resolved = resolveImport(f.path, m[1], ctx.files);
      if (resolved) imports.add(resolved);
    }
    graph.set(f.path, imports);
  }

  const details: string[] = [];
  let issues = 0;
  const visited = new Set<string>();

  for (const file of graph.keys()) {
    if (visited.has(file)) continue;
    const stack = [file];
    const stackSet = new Set([file]);
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const deps = graph.get(current);
      let pushed = false;
      if (deps) {
        for (const dep of deps) {
          if (stackSet.has(dep)) {
            issues++;
            details.push(`error: Circular import: ${current} → ${dep}`);
          } else if (!visited.has(dep) && graph.has(dep)) {
            stack.push(dep);
            stackSet.add(dep);
            pushed = true;
            break;
          }
        }
      }
      if (!pushed) {
        visited.add(current);
        stackSet.delete(current);
        stack.pop();
      }
    }
  }

  return { checks: graph.size, issues, details };
};

function resolveImport(from: string, specifier: string, files: string[]): string | null {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  let target = dir ? `${dir}/${specifier}` : specifier;
  target = target.replace(/^\.\//, "");

  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
    if (files.includes(target + ext)) return target + ext;
  }
  return null;
}
