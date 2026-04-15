/**
 * dependencyFreshness module — CVE + staleness scan of package.json.
 *
 * Inspects every dependency and devDependency in package.json and flags:
 *   - CVE affecting the pinned version (via OSV.dev — free, no API key)
 *   - >180 days behind latest release (via npm registry — free, no API key)
 *
 * Runtime-agnostic: pure HTTP + JSON parsing, no shell, no git, no package
 * manager binaries. Works on Vercel today; will run identically on GlueCron.
 *
 * Budget discipline: caps at 100 deps per scan and 15s total wall-clock so it
 * fits inside the full-scan 60s target even on slow network days.
 */

import type { ModuleContext, ModuleOutput, ModuleRunner } from "./types";

const OSV_API = "https://api.osv.dev/v1/query";
const NPM_REGISTRY = "https://registry.npmjs.org";

const STALENESS_DAYS = 180;
const HTTP_TIMEOUT_MS = 6000;
const MAX_CONCURRENT = 8;
const MAX_DEPS = 100;
const MODULE_BUDGET_MS = 15_000;

interface OsvVuln {
  id: string;
  summary?: string;
}
interface OsvResponse {
  vulns?: OsvVuln[];
}
interface NpmMeta {
  "dist-tags"?: { latest?: string };
  time?: Record<string, string>;
}
interface ParsedDep {
  name: string;
  pinnedVersion: string;
  rawSpec: string;
}

/** Extract concrete pinned versions from a dependencies map. */
function parseDeps(obj: Record<string, string>): ParsedDep[] {
  return Object.entries(obj)
    .filter(([, v]) => {
      // Skip non-registry deps: workspace refs, local paths, git URLs.
      return (
        !v.startsWith("workspace:") &&
        !v.startsWith("file:") &&
        !v.startsWith("link:") &&
        !v.startsWith("git+") &&
        !v.startsWith("git:") &&
        !v.includes("://")
      );
    })
    .map(([name, spec]) => {
      const cleaned = spec.replace(/^[\^~>=<\s]+/, "").split(/\s|\|/)[0] || spec;
      return { name, pinnedVersion: cleaned, rawSpec: spec };
    })
    .filter((d) => /^\d/.test(d.pinnedVersion));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function queryOsv(dep: ParsedDep): Promise<OsvVuln[]> {
  try {
    const res = await fetchWithTimeout(OSV_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        package: { name: dep.name, ecosystem: "npm" },
        version: dep.pinnedVersion,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OsvResponse;
    return data.vulns ?? [];
  } catch {
    return [];
  }
}

async function queryStaleness(
  dep: ParsedDep
): Promise<{ latest: string; daysBehind: number } | null> {
  try {
    const res = await fetchWithTimeout(`${NPM_REGISTRY}/${encodeURIComponent(dep.name)}`);
    if (!res.ok) return null;
    const meta = (await res.json()) as NpmMeta;
    const latest = meta["dist-tags"]?.latest;
    if (!latest) return null;
    const currentAt = meta.time?.[dep.pinnedVersion];
    const latestAt = meta.time?.[latest];
    if (!currentAt || !latestAt) return { latest, daysBehind: 0 };
    const daysBehind = Math.floor(
      (new Date(latestAt).getTime() - new Date(currentAt).getTime()) / 86_400_000
    );
    return { latest, daysBehind: Math.max(0, daysBehind) };
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

export const dependencyFreshness: ModuleRunner = async (
  ctx: ModuleContext
): Promise<ModuleOutput> => {
  const pkgFile = ctx.fileContents.find((f) => f.path === "package.json");
  if (!pkgFile) {
    return { checks: 0, issues: 0, details: [], skipped: "no package.json at repo root" };
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgFile.content);
  } catch {
    return {
      checks: 1,
      issues: 1,
      details: ["package.json: invalid JSON — cannot inspect dependencies"],
    };
  }

  const allDeps = [
    ...parseDeps(pkg.dependencies ?? {}),
    ...parseDeps(pkg.devDependencies ?? {}),
  ];

  if (allDeps.length === 0) {
    return { checks: 1, issues: 0, details: [] };
  }

  const truncated = allDeps.length > MAX_DEPS;
  const deps = allDeps.slice(0, MAX_DEPS);

  const details: string[] = [];
  let checks = 0;
  let issues = 0;
  const deadlineAt = Date.now() + MODULE_BUDGET_MS;

  await mapLimit(
    deps,
    MAX_CONCURRENT,
    async (dep) => {
      // 2 checks per dep: one for CVE, one for staleness.
      checks += 2;
      const [vulns, stale] = await Promise.all([queryOsv(dep), queryStaleness(dep)]);

      for (const v of vulns) {
        issues++;
        details.push(
          `package.json: ${dep.name}@${dep.pinnedVersion} — ${v.id}${
            v.summary ? ` — ${v.summary}` : ""
          }`
        );
      }
      if (stale && stale.daysBehind > STALENESS_DAYS) {
        issues++;
        details.push(
          `package.json: ${dep.name}@${dep.pinnedVersion} is ${stale.daysBehind} days behind latest (${stale.latest})`
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
