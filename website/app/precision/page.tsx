import type { Metadata } from "next";
import Link from "next/link";
import { contentMetadata, breadcrumbSchema, jsonLd } from "../lib/seo/schema";
import precision from "../data/precision.json";

// Every number on this page comes from website/app/data/precision.json,
// which scripts/real-world-precision.js writes from its own measurement —
// the same contract as site-stats.json. Nothing here is typed by hand, and
// tests/precision-page-sync.test.js fails the build if the JSON and the
// corpus manifest ever disagree.

export const metadata: Metadata = contentMetadata({
  title: "Precision benchmark — GateTest measured on repositories it does not control",
  description:
    "Blocking findings from a full GateTest scan of pinned commits of express, Django, Rails, zod, hono and more, with the ceiling each is held to and the recall floor on OWASP NodeGoat. Regenerated from a real run; no number is typed by hand.",
  path: "/precision",
  keywords: [
    "static analysis false positive rate",
    "code scanner precision benchmark",
    "sast false positives",
    "gatetest precision",
  ],
});

type Row = {
  name: string;
  url: string;
  sha: string;
  why?: string;
  blocking: number;
  ceiling?: number;
  floor?: number;
};

const rows = precision.repos as Row[];
const precisionRows = rows.filter((r) => typeof r.ceiling === "number");
const recallRows = rows.filter((r) => typeof r.floor === "number");
const commitUrl = (r: Row) => `${r.url.replace(/\.git$/, "")}/commit/${r.sha}`;
const generated = new Date(precision.generatedAt);

export default function PrecisionPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(breadcrumbSchema([{ name: "GateTest", path: "/" }, { name: "Precision" }])),
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
          <Link href="/modules" className="text-sm text-white/50 hover:text-white transition-colors">
            121 modules &rarr;
          </Link>
        </div>
      </nav>

      <main className="px-6 py-16 max-w-5xl mx-auto">
        <p className="text-xs font-mono uppercase tracking-[0.14em] text-white/40 mb-4">Measured</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-5" style={{ textWrap: "balance" }}>
          Precision, on code we do not control
        </h1>
        <p className="text-lg text-white/60 max-w-[62ch] leading-relaxed">
          A scanner tuned against its own repository looks perfect on its own repository. The only
          honest test is code its authors did not write and cannot quietly adjust. Each repository
          below is cloned fresh at a pinned commit and scanned with{" "}
          <code className="font-mono text-white/80 text-[0.92em]">--suite full</code> — exactly what a
          paying Full Scan runs. The number is blocking findings; the ceiling is what CI holds the engine
          to, and it only ever moves down.
        </p>

        <section className="mt-14">
          <h2 className="text-xs font-mono uppercase tracking-[0.13em] text-teal-400 mb-4">
            Precision — clean code must pass
          </h2>
          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-white/40">
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Commit</th>
                  <th className="px-4 py-3 font-medium text-right">Blocking</th>
                  <th className="px-4 py-3 font-medium text-right">Ceiling</th>
                  <th className="px-4 py-3 font-medium">Why it is in the corpus</th>
                </tr>
              </thead>
              <tbody>
                {precisionRows.map((r) => (
                  <tr key={r.name} className="border-b border-white/[0.05] last:border-0">
                    <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-white/50">
                      <a href={commitUrl(r)} className="hover:text-teal-400 transition-colors" rel="noopener">
                        {r.sha.slice(0, 8)}
                      </a>
                    </td>
                    <td
                      className={`px-4 py-3 font-mono text-right tabular-nums ${
                        r.blocking === 0 ? "text-emerald-400" : "text-white"
                      }`}
                    >
                      {r.blocking}
                    </td>
                    <td className="px-4 py-3 font-mono text-right tabular-nums text-white/50">{r.ceiling}</td>
                    <td className="px-4 py-3 text-white/55 max-w-[38ch]">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-xs font-mono uppercase tracking-[0.13em] text-teal-400 mb-4">
            Recall — a vulnerable app must keep failing
          </h2>
          <p className="text-white/60 max-w-[62ch] leading-relaxed mb-4">
            Precision alone is satisfied by a scanner that reports nothing. So a deliberately vulnerable
            application is held to a <em>floor</em>: if it ever stops failing, the gate goes red.
          </p>
          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-white/40">
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Commit</th>
                  <th className="px-4 py-3 font-medium text-right">Blocking</th>
                  <th className="px-4 py-3 font-medium text-right">Floor</th>
                </tr>
              </thead>
              <tbody>
                {recallRows.map((r) => (
                  <tr key={r.name} className="border-b border-white/[0.05] last:border-0">
                    <td className="px-4 py-3 font-medium text-white">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-white/50">
                      <a href={commitUrl(r)} className="hover:text-teal-400 transition-colors" rel="noopener">
                        {r.sha.slice(0, 8)}
                      </a>
                    </td>
                    <td className="px-4 py-3 font-mono text-right tabular-nums text-rose-300">{r.blocking}</td>
                    <td className="px-4 py-3 font-mono text-right tabular-nums text-white/50">{r.floor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12 text-sm text-white/45 max-w-[66ch] leading-relaxed space-y-3">
          <p>
            What remains on a repository is reported, not hidden. Django&rsquo;s ORM builds SQL by string
            inside <code className="font-mono">django/db</code>, which is the one place that is the job;{" "}
            <code className="font-mono">rails runner</code> evaluates its input by contract. A scanner
            should say so, and the project is right to accept it.
          </p>
          <p>
            Generated {generated.toISOString().slice(0, 10)} by{" "}
            <code className="font-mono">{precision.source}</code> on engine v{precision.engineVersion}
            {precision.engineCommit && precision.engineCommit !== "unknown" ? ` @ ${precision.engineCommit}` : ""}.
            The corpus manifest and the runner are in the repository, so anyone can re-run the table.{" "}
            <Link href="/modules" className="text-teal-400 hover:underline">
              What the 121 modules check &rarr;
            </Link>
          </p>
        </section>
      </main>
    </main>
  );
}
