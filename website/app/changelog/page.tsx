import type { Metadata } from "next";
import Link from "next/link";
import { contentMetadata, breadcrumbSchema, jsonLd } from "../lib/seo/schema";
import { getSlugForModuleName } from "../components/howitworks/module-slugs";
import changelog from "../data/changelog.json";

// Every entry on this page comes from website/app/data/changelog.json, which
// scripts/generate-changelog.js writes from the main branch's first-parent
// history — the same contract as site-stats.json and precision.json. Nothing
// here is typed by hand; tests/changelog-sync.test.js fails the build if the
// file stops matching the repository (version, shape, order) or if this page
// stops importing it.

export const metadata: Metadata = contentMetadata({
  title: "Changelog — every change to GateTest, in the order it merged",
  description:
    "The GateTest changelog, generated from the main branch: each pull request that merged, the date, which part of the product it touched and which scan modules it changed. No entry is typed by hand.",
  path: "/changelog",
  keywords: ["gatetest changelog", "gatetest release notes", "code quality gate updates"],
});

type Entry = {
  sha: string;
  short: string;
  date: string;
  pr: number | null;
  title: string;
  area: string;
  areas: Record<string, number>;
  files: number;
  modules: string[];
  version: string | null;
};

const REPO = "https://github.com/crclabs-hq/GateTest";
const entries = changelog.entries as Entry[];
const generated = new Date(changelog.generatedAt);

const AREA_LABEL: Record<string, string> = {
  engine: "engine",
  website: "website",
  integrations: "CI integration",
  ci: "our CI",
  tests: "tests",
  corpus: "precision corpus",
  tooling: "tooling",
  docs: "docs",
  other: "repo",
};

const AREA_TONE: Record<string, string> = {
  engine: "border-teal-500/40 text-teal-300",
  website: "border-sky-500/40 text-sky-300",
  integrations: "border-amber-500/40 text-amber-300",
  corpus: "border-fuchsia-500/40 text-fuchsia-300",
};

function groupByDate(list: Entry[]): Array<[string, Entry[]]> {
  const out: Array<[string, Entry[]]> = [];
  for (const e of list) {
    const last = out[out.length - 1];
    if (last && last[0] === e.date) last[1].push(e);
    else out.push([e.date, [e]]);
  }
  return out;
}

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function ModuleChip({ name }: { name: string }) {
  const slug = getSlugForModuleName(name);
  const cls = "font-mono text-[11px] px-1.5 py-0.5 rounded border border-white/[0.1] text-white/60";
  if (!slug) return <span className={cls}>{name}</span>;
  return (
    <Link href={`/modules/${slug}`} className={`${cls} hover:border-teal-500/50 hover:text-teal-300 transition-colors`}>
      {name}
    </Link>
  );
}

function EntryRow({ e }: { e: Entry }) {
  const tone = AREA_TONE[e.area] ?? "border-white/[0.14] text-white/55";
  const otherAreas = Object.keys(e.areas).filter((a) => a !== e.area);
  return (
    <li className="py-4 border-b border-white/[0.06] last:border-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className={`shrink-0 mt-0.5 text-[11px] font-mono uppercase tracking-[0.08em] px-2 py-0.5 rounded-full border ${tone}`}>
          {AREA_LABEL[e.area] ?? e.area}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug text-white" style={{ textWrap: "pretty" }}>
            {e.title}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40 font-mono tabular-nums">
            {e.pr !== null ? (
              <a href={`${REPO}/pull/${e.pr}`} className="hover:text-teal-400 transition-colors" rel="noopener">
                #{e.pr}
              </a>
            ) : (
              <span title="Committed directly to main">direct to main</span>
            )}
            <a href={`${REPO}/commit/${e.sha}`} className="hover:text-teal-400 transition-colors" rel="noopener">
              {e.short}
            </a>
            <span>{e.files} {e.files === 1 ? "file" : "files"}</span>
            {otherAreas.length > 0 && <span>also {otherAreas.map((a) => AREA_LABEL[a] ?? a).join(", ")}</span>}
            {e.version && (
              <span className="text-emerald-300 border border-emerald-500/40 rounded px-1.5">v{e.version}</span>
            )}
          </p>
          {e.modules.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {e.modules.map((m) => (
                <ModuleChip key={m} name={m} />
              ))}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ChangelogPage() {
  const groups = groupByDate(entries);
  const oldest = entries[entries.length - 1];
  const prCount = entries.filter((e) => e.pr !== null).length;
  const moduleCount = new Set(entries.flatMap((e) => e.modules)).size;

  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(breadcrumbSchema([{ name: "GateTest", path: "/" }, { name: "Changelog" }])),
        }}
      />

      <nav className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm font-mono">G</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              Gate<span className="text-teal-400">Test</span>
            </span>
          </Link>
          <Link href="/precision" className="text-sm text-white/50 hover:text-white transition-colors">
            Precision benchmark &rarr;
          </Link>
        </div>
      </nav>

      <main className="px-6 py-16 max-w-5xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-[0.14em] text-white/40 mb-4">Generated</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5" style={{ textWrap: "balance" }}>
          Every change, in the order it merged
        </h1>
        <p className="text-lg text-white/60 max-w-[62ch] leading-relaxed">
          This is the main branch of the engine, read back as a list. Each entry is a commit that
          reached <code className="font-mono text-white/80 text-[0.92em]">main</code>: the pull request
          it came from, the part of the product it touched most, and the scan modules it changed. It is
          written by a script from the repository history, so it cannot describe a change that did not
          ship or omit one that did.
        </p>

        <dl className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.06]">
          {[
            ["Engine version", `v${changelog.currentVersion}`],
            ["Changes listed", `${entries.length}`],
            ["Via pull request", `${prCount}`],
            ["Modules touched", `${moduleCount}`],
          ].map(([k, v]) => (
            <div key={k} className="bg-black px-4 py-4">
              <dt className="text-[11px] font-mono uppercase tracking-[0.12em] text-white/40">{k}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-xs text-white/40 font-mono tabular-nums">
          Regenerated {generated.toISOString().slice(0, 10)} at{" "}
          <a href={`${REPO}/commit/${changelog.head}`} className="hover:text-teal-400 transition-colors" rel="noopener">
            {String(changelog.head).slice(0, 7)}
          </a>
          {oldest && <> · history shown from {oldest.date}</>} · the narrative behind each release is in{" "}
          <a href={`${REPO}/blob/main/docs/HISTORY.md`} className="hover:text-teal-400 transition-colors" rel="noopener">
            docs/HISTORY.md
          </a>
        </p>

        <section className="mt-14">
          {groups.map(([date, list]) => (
            <div key={date} className="md:grid md:grid-cols-[180px_1fr] md:gap-8 mb-10">
              <h2 className="text-sm font-mono text-teal-400 md:sticky md:top-6 md:self-start mb-2 md:mb-0 tabular-nums">
                {longDate(date)}
              </h2>
              <ul>
                {list.map((e) => (
                  <EntryRow key={e.sha} e={e} />
                ))}
              </ul>
            </div>
          ))}
        </section>

        <p className="mt-6 text-sm text-white/40 max-w-[62ch] leading-relaxed">
          Older history lives in{" "}
          <a href={`${REPO}/blob/main/docs/HISTORY.md`} className="text-white/60 hover:text-teal-400 transition-colors" rel="noopener">
            docs/HISTORY.md
          </a>
          , which also records the measurement behind each release. Want to see the engine on code it
          does not control? The <Link href="/precision" className="text-white/60 hover:text-teal-400 transition-colors">precision benchmark</Link> is
          regenerated nightly.
        </p>
      </main>
    </main>
  );
}
