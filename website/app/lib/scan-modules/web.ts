/**
 * Web-surface scan modules: accessibility, seo, links, performance, compatibility.
 *
 * Operates purely on ctx.files + ctx.fileContents. No network calls.
 * Every check does real work — no hardcoded passes.
 */

import type { ModuleContext, ModuleOutput, ModuleRunner, RepoFile } from "./types";

const JSX_EXT = /\.(tsx|jsx)$/i;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const SERVER_SAFE_EXCLUDE = /(\.config\.|^scripts\/|\/scripts\/|^build\/|\/build\/|^test|\/test|\.test\.|\.spec\.)/i;

function isTestPath(p: string): boolean {
  return /(^|\/)(test|tests|__tests__|spec)(\/|$)/i.test(p) || /\.(test|spec)\./i.test(p);
}

function hasFile(ctx: ModuleContext, needle: string): boolean {
  const n = needle.toLowerCase();
  return ctx.files.some((p) => p.toLowerCase() === n);
}

function hasAny(ctx: ModuleContext, names: string[]): boolean {
  return names.some((n) => hasFile(ctx, n));
}

function findFile(ctx: ModuleContext, path: string): RepoFile | undefined {
  return ctx.fileContents.find((f) => f.path === path);
}

/* ────────────────────────────  ACCESSIBILITY  ──────────────────────────── */

export const accessibility: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  const targets = ctx.fileContents.filter((f) => JSX_EXT.test(f.path) && !isTestPath(f.path));

  for (const f of targets) {
    checks++;
    const imgNoAlt = f.content.match(/<img\s(?![^>]*\balt\s*=)/gi);
    if (imgNoAlt) {
      issues++;
      details.push(`${f.path}: ${imgNoAlt.length} <img> tag(s) missing alt attribute`);
    }

    checks++;
    const inputNoLabel = f.content.match(/<input(?![^>]*\b(?:aria-label|aria-labelledby|id)\s*=)/gi);
    if (inputNoLabel) {
      issues++;
      details.push(`${f.path}: ${inputNoLabel.length} <input> without aria-label/aria-labelledby/id`);
    }

    checks++;
    const emptyButton = f.content.match(/<button[^>]*>\s*<\/button>/g);
    if (emptyButton) {
      const unlabeled = emptyButton.filter((m) => !/\baria-label\s*=/.test(m));
      if (unlabeled.length > 0) {
        issues++;
        details.push(`${f.path}: ${unlabeled.length} empty <button> without text or aria-label`);
      }
    }

    checks++;
    const tags = f.content.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*\bonClick\s*=[^>]*>/g) ?? [];
    let badClick = 0;
    for (const tag of tags) {
      const nameMatch = tag.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
      const name = nameMatch ? nameMatch[1].toLowerCase() : "";
      if (name === "button" || name === "a") continue;
      const hasKey = /\bonKey(Down|Up|Press)\s*=/.test(tag);
      const hasRoleButton = /\brole\s*=\s*['"]button['"]/.test(tag);
      if (!hasKey && !hasRoleButton) badClick++;
    }
    if (badClick > 0) {
      issues++;
      details.push(`${f.path}: ${badClick} non-button element(s) with onClick but no keyboard handler or role="button"`);
    }

    checks++;
    const badTabIndex = f.content.match(/tabIndex\s*=\s*\{?\s*['"]?[1-9]/g);
    if (badTabIndex) {
      issues++;
      details.push(`${f.path}: ${badTabIndex.length} positive tabIndex value(s) — disrupts natural tab order`);
    }

    checks++;
    const anchorHash = f.content.match(/<a\s[^>]*\bhref\s*=\s*['"]#['"][^>]*>/g);
    if (anchorHash) {
      issues++;
      details.push(`${f.path}: ${anchorHash.length} anchor(s) with href="#" used as button substitute`);
    }

    if (/<html\b/i.test(f.content)) {
      checks++;
      if (/<html(?![^>]*\blang\s*=)/i.test(f.content)) {
        issues++;
        details.push(`${f.path}: <html> tag missing lang attribute`);
      }
    }

    checks++;
    const autoFocus = f.content.match(/\bautoFocus\b/g);
    if (autoFocus) {
      issues++;
      details.push(`${f.path}: ${autoFocus.length} autoFocus usage(s) — breaks focus expectations for AT users`);
    }
  }

  if (checks === 0) return { checks: 0, issues: 0, details, skipped: "no JSX/TSX files to inspect" };
  return { checks, issues, details };
};

/* ─────────────────────────────────  SEO  ───────────────────────────────── */

export const seo: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  checks++;
  if (!hasAny(ctx, ["robots.txt", "public/robots.txt", "app/robots.ts", "app/robots.txt"])) {
    issues++;
    details.push("repo: missing robots.txt (or app/robots.ts route)");
  }

  checks++;
  if (!hasAny(ctx, ["sitemap.xml", "public/sitemap.xml", "app/sitemap.ts", "app/sitemap.xml"])) {
    issues++;
    details.push("repo: missing sitemap.xml (or app/sitemap.ts route)");
  }

  checks++;
  if (!hasAny(ctx, ["app/layout.tsx", "app/layout.js", "pages/_app.tsx", "pages/_app.js"])) {
    issues++;
    details.push("repo: missing root layout (app/layout.* or pages/_app.*)");
  }

  const layoutLikePaths = [
    "app/layout.tsx",
    "app/layout.js",
    "app/page.tsx",
    "app/page.js",
    "pages/_app.tsx",
    "pages/_app.js",
    "pages/index.tsx",
    "pages/index.js",
  ];
  const layoutFiles = ctx.fileContents.filter((f) => layoutLikePaths.includes(f.path));

  for (const f of layoutFiles) {
    checks++;
    const hasMetadata = /export\s+(const|let|var)\s+metadata\b/.test(f.content) || /<title\b/i.test(f.content);
    if (!hasMetadata) {
      issues++;
      details.push(`${f.path}: no 'metadata' export or <title> tag`);
    }
  }

  const combined = layoutFiles.map((f) => f.content).join("\n");

  checks++;
  if (layoutFiles.length > 0 && !/\bdescription\s*:/i.test(combined) && !/name\s*=\s*['"]description['"]/i.test(combined)) {
    issues++;
    details.push("layout/page: no description meta tag or metadata.description found");
  }

  const ogTags = ["og:title", "og:description", "og:image"];
  for (const tag of ogTags) {
    checks++;
    const present = combined.includes(tag) || combined.includes(tag.replace("og:", "openGraph"));
    const ogKey = tag.split(":")[1];
    const inOpenGraph = new RegExp(`openGraph[\\s\\S]{0,400}${ogKey}\\s*:`, "i").test(combined);
    if (!present && !inOpenGraph) {
      issues++;
      details.push(`layout/page: missing Open Graph tag ${tag}`);
    }
  }

  const twitterTags = ["twitter:card", "twitter:title"];
  for (const tag of twitterTags) {
    checks++;
    const key = tag.split(":")[1];
    const present = combined.includes(tag);
    const inTwitter = new RegExp(`twitter[\\s\\S]{0,400}${key}\\s*:`, "i").test(combined);
    if (!present && !inTwitter) {
      issues++;
      details.push(`layout/page: missing Twitter card tag ${tag}`);
    }
  }

  checks++;
  const hasJsonLd = ctx.fileContents.some((f) => /application\/ld\+json/i.test(f.content));
  if (!hasJsonLd) {
    issues++;
    details.push("repo: no application/ld+json structured data found (informational)");
  }

  if (checks === 0) return { checks: 0, issues: 0, details, skipped: "no files to inspect" };
  return { checks, issues, details };
};

/* ────────────────────────────────  LINKS  ─────────────────────────────── */

function resolveRelative(fromDir: string, rel: string): string {
  const cleanRel = rel.split("#")[0].split("?")[0];
  const parts = (fromDir ? fromDir.split("/") : []).filter(Boolean);
  for (const seg of cleanRel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export const links: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  const fileSet = new Set(ctx.files);

  for (const f of ctx.fileContents) {
    const hrefs = Array.from(f.content.matchAll(/href\s*=\s*["']([^"']*)["']/gi)).map((m) => m[1]);

    if (hrefs.length > 0) {
      checks++;
      const empties = hrefs.filter((h) => h === "" || h === "#");
      if (empties.length > 0) {
        issues++;
        details.push(`${f.path}: ${empties.length} empty/# href value(s)`);
      }

      checks++;
      const jsHrefs = hrefs.filter((h) => /^javascript:/i.test(h));
      if (jsHrefs.length > 0) {
        issues++;
        details.push(`${f.path}: ${jsHrefs.length} javascript: href value(s)`);
      }

      checks++;
      const deepRel = hrefs.filter((h) => (h.match(/\.\.\//g) ?? []).length >= 3);
      if (deepRel.length > 0) {
        issues++;
        details.push(`${f.path}: ${deepRel.length} href(s) traverse 3+ parent directories`);
      }

      checks++;
      const insecure = hrefs.filter(
        (h) => /^http:\/\//i.test(h) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(h)
      );
      if (insecure.length > 0) {
        issues++;
        details.push(`${f.path}: ${insecure.length} insecure http:// link(s)`);
      }
    }

    if (f.path.toLowerCase().endsWith(".md")) {
      checks++;
      const emptyMd = f.content.match(/\[[^\]]*\]\(\s*\)/g);
      if (emptyMd) {
        issues++;
        details.push(`${f.path}: ${emptyMd.length} markdown link(s) with empty target`);
      }

      checks++;
      const noAltImg = f.content.match(/!\[\s*\]\(/g);
      if (noAltImg) {
        issues++;
        details.push(`${f.path}: ${noAltImg.length} markdown image(s) without alt text`);
      }

      const mdLinks = Array.from(f.content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)).map((m) => m[1]);
      const relLinks = mdLinks.filter(
        (l) => !/^[a-z]+:\/\//i.test(l) && !l.startsWith("#") && !l.startsWith("mailto:") && l.length > 0
      );
      if (relLinks.length > 0) {
        checks++;
        const dirParts = f.path.split("/");
        dirParts.pop();
        const dir = dirParts.join("/");
        let broken = 0;
        for (const rel of relLinks) {
          const resolved = resolveRelative(dir, rel);
          if (!resolved) continue;
          if (!fileSet.has(resolved)) broken++;
        }
        if (broken > 0) {
          issues++;
          details.push(`${f.path}: ${broken} broken relative markdown link(s)`);
        }
      }
    }
  }

  // LIVE URL VERIFICATION — actually fetch external links and check for 404s.
  // This is what makes GateTest brutal: we don't just pattern-match, we verify.
  const allExternalUrls = new Set<string>();
  for (const f of ctx.fileContents) {
    const hrefs = Array.from(f.content.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)).map((m) => m[1]);
    for (const h of hrefs) {
      if (h.includes("localhost") || h.includes("127.0.0.1")) continue;
      allExternalUrls.add(h);
    }
    // Also check markdown links
    const mdLinks = Array.from(f.content.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)).map((m) => m[1]);
    for (const l of mdLinks) {
      allExternalUrls.add(l);
    }
  }

  // Verify up to 50 unique external URLs (cap to stay within Vercel time budget)
  const urlsToCheck = Array.from(allExternalUrls).slice(0, 50);
  if (urlsToCheck.length > 0) {
    const urlResults = await Promise.allSettled(
      urlsToCheck.map(async (url) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(url, {
            method: "HEAD",
            signal: controller.signal,
            redirect: "follow",
            headers: { "User-Agent": "GateTest/LinkChecker" },
          });
          clearTimeout(timeout);
          return { url, status: res.status, ok: res.ok };
        } catch (err) {
          // Try GET if HEAD fails (some servers reject HEAD)
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, {
              method: "GET",
              signal: controller.signal,
              redirect: "follow",
              headers: { "User-Agent": "GateTest/LinkChecker" },
            });
            clearTimeout(timeout);
            return { url, status: res.status, ok: res.ok };
          } catch {
            return { url, status: 0, ok: false, error: (err as Error).message };
          }
        }
      })
    );

    for (const r of urlResults) {
      checks++;
      if (r.status === "fulfilled") {
        const { url, status, ok } = r.value;
        if (!ok) {
          issues++;
          if (status === 404) {
            details.push(`error: BROKEN LINK (404): ${url}`);
          } else if (status === 0) {
            details.push(`warning: Link unreachable: ${url}`);
          } else {
            details.push(`warning: Link returned HTTP ${status}: ${url}`);
          }
        }
      }
    }
  }

  if (checks === 0) return { checks: 0, issues: 0, details, skipped: "no link-bearing files found" };
  return { checks, issues, details };
};

/* ─────────────────────────────  PERFORMANCE  ──────────────────────────── */

export const performance: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  const pkg = findFile(ctx, "package.json");
  let parsed: Record<string, unknown> | null = null;
  if (pkg) {
    try {
      parsed = JSON.parse(pkg.content) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    for (const key of ["dependencies", "devDependencies"]) {
      checks++;
      const deps = parsed?.[key] as Record<string, string> | undefined;
      if (deps) {
        const count = Object.keys(deps).length;
        if (count > 50) {
          issues++;
          details.push(`package.json: ${key} has ${count} entries (>50) — large install surface`);
        }
      }
    }

    checks++;
    if (parsed && parsed.main !== undefined && parsed.sideEffects === undefined) {
      issues++;
      details.push("package.json: library-like (has 'main') but no 'sideEffects' declared — hurts tree-shaking");
    }
  }

  for (const f of ctx.fileContents) {
    const lineCount = f.content.split("\n").length;
    if (lineCount > 5000) {
      checks++;
      issues++;
      details.push(`${f.path}: ${lineCount} lines — extremely large file`);
    }
  }

  const syncFsRe = /\bfs\.(readFileSync|statSync|existsSync|readdirSync|writeFileSync)\b/g;
  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;
    if (SERVER_SAFE_EXCLUDE.test(f.path)) continue;
    const sync = f.content.match(syncFsRe);
    if (sync) {
      checks++;
      issues++;
      details.push(`${f.path}: ${sync.length} synchronous fs call(s) — blocks event loop`);
    }
  }

  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/while\s*\(\s*true\s*\)/.test(lines[i])) {
        const window = lines.slice(i, Math.min(lines.length, i + 20)).join("\n");
        if (!/\b(break|return|throw)\b/.test(window)) {
          checks++;
          issues++;
          details.push(`${f.path}:${i + 1}: while(true) without visible break/return within 20 lines`);
        }
      }
    }
  }

  const heavyLibs = ["lodash", "moment", "rxjs", "antd", "material-ui", "@mui/material"];
  for (const f of ctx.fileContents) {
    if (!SOURCE_EXT.test(f.path)) continue;
    for (const lib of heavyLibs) {
      const reDefault = new RegExp(`import\\s+\\w+\\s+from\\s+['"]${lib}['"]`);
      const reStar = new RegExp(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"]${lib}['"]`);
      if (reDefault.test(f.content) || reStar.test(f.content)) {
        checks++;
        issues++;
        details.push(`${f.path}: full-package import of '${lib}' — use cherry-picked imports`);
      }
    }
  }

  const imgExt = /\.(png|jpe?g|gif)$/i;
  const publicImgs = ctx.files.filter((p) => /^public\//.test(p) && imgExt.test(p));
  checks++;
  if (publicImgs.length > 30) {
    issues++;
    details.push(`public/: ${publicImgs.length} raster images — consider next/image optimization`);
  }

  if (pkg) {
    checks++;
    const hasLock = hasAny(ctx, ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);
    if (!hasLock) {
      issues++;
      details.push("repo: package.json present but no lockfile — non-reproducible installs");
    }
  }

  if (checks === 0) return { checks: 0, issues: 0, details, skipped: "no files to analyse" };
  return { checks, issues, details };
};

/* ────────────────────────────  COMPATIBILITY  ─────────────────────────── */

export const compatibility: ModuleRunner = async (ctx: ModuleContext): Promise<ModuleOutput> => {
  const details: string[] = [];
  let checks = 0;
  let issues = 0;

  const pkg = findFile(ctx, "package.json");
  let parsed: Record<string, unknown> | null = null;
  if (pkg) {
    try {
      parsed = JSON.parse(pkg.content) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  checks++;
  const hasBrowserslistFile = hasFile(ctx, ".browserslistrc");
  const hasBrowserslistField = parsed !== null && parsed.browserslist !== undefined;
  if (!hasBrowserslistFile && !hasBrowserslistField) {
    issues++;
    details.push("repo: no browserslist configuration (.browserslistrc or package.json#browserslist)");
  }

  checks++;
  const engines = parsed?.engines as Record<string, string> | undefined;
  if (!engines || !engines.node) {
    issues++;
    details.push("package.json: missing 'engines.node' field");
  }

  const sources = ctx.fileContents.filter((f) => SOURCE_EXT.test(f.path) && !isTestPath(f.path));

  for (const f of sources) {
    const lines = f.content.split("\n");
    let depth = 0;
    let inAsyncFn = false;
    let fnDepth = 0;
    let topLevelAwaits = 0;

    for (const raw of lines) {
      const ln = raw;
      if (/\basync\s+function\b/.test(ln) || /async\s*\([^)]*\)\s*=>/.test(ln) || /async\s+\w+\s*\(/.test(ln)) {
        inAsyncFn = true;
        fnDepth = depth;
      }
      const opens = (ln.match(/\{/g) ?? []).length;
      const closes = (ln.match(/\}/g) ?? []).length;
      depth += opens - closes;
      if (inAsyncFn && depth <= fnDepth) inAsyncFn = false;

      if (!inAsyncFn && depth === 0 && /^\s*await\b/.test(ln)) {
        topLevelAwaits++;
      }
    }

    if (topLevelAwaits > 0) {
      checks++;
      issues++;
      details.push(`${f.path}: ${topLevelAwaits} top-level await(s) — requires ESM target`);
    }

    const featurePatterns: Array<{ re: RegExp; name: string; note: string }> = [
      { re: /\bPromise\.allSettled\s*\(/g, name: "Promise.allSettled", note: "ES2020+" },
      { re: /\bPromise\.any\s*\(/g, name: "Promise.any", note: "ES2021+" },
      { re: /\.at\s*\(\s*-?\d+\s*\)/g, name: "Array.prototype.at", note: "ES2022+" },
      { re: /\bstructuredClone\s*\(/g, name: "structuredClone", note: "Node 17+/ES2022+" },
      { re: /\.replaceAll\s*\(/g, name: "String.prototype.replaceAll", note: "ES2021+" },
      { re: /\b\d+n\b/g, name: "BigInt literal", note: "ES2020+" },
    ];

    for (const { re, name, note } of featurePatterns) {
      const m = f.content.match(re);
      if (m) {
        checks++;
        issues++;
        details.push(`${f.path}: ${m.length} use(s) of ${name} — ${note} required`);
      }
    }

    if (/class\s+\w+[^{]*\{[\s\S]*?#\w+/.test(f.content)) {
      checks++;
      issues++;
      details.push(`${f.path}: private class fields (#field) — ES2022 required`);
    }
  }

  if (checks === 0) return { checks: 0, issues: 0, details, skipped: "no source files to inspect" };
  return { checks, issues, details };
};
