import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import registry from "./registry.json";

// =============================================================================
// PUBLIC PROOF PAGE — phase-6 gap 3
// =============================================================================
// Every shipped GateTest scan + fix logged here as proof. Marketing flywheel:
// "real fixes from real repos, with real timestamps + real PR diffs".
//
// Today reads from /app/fixes/registry.json (4 real proofs we shipped during
// Phases 1-3). Future iterations: opt-in customer fixes via a /api/fixes/submit
// endpoint and a Neon table — but launch-day proof comes from the four
// validated real-repo runs.
// =============================================================================

export const metadata: Metadata = {
  title: "Fixes shipped — GateTest",
  description: "Every GateTest scan + fix that's been shipped to a real repo, logged with timestamps, finding counts, and proof artifacts.",
  openGraph: {
    title: "Fixes shipped — GateTest",
    description: "Real fixes, real repos, real timestamps. The proof registry behind GateTest.",
  },
};

interface RegistryFix {
  id: string;
  repo: string;
  publicUrl: string;
  displayName: string;
  tier: "quick" | "full" | "scan_fix" | "nuclear";
  scannedAt: string;
  duration: string;
  stats: {
    modulesRun?: number;
    modulesPassed?: number;
    errors?: number;
    warnings?: number;
    fixesShipped?: number;
    diagnosed?: number;
    chains?: number;
  };
  notableFix: string;
  proofDoc?: string;
}

const TIER_LABEL: Record<string, string> = {
  quick: "Quick · $29",
  full: "Full · $99",
  scan_fix: "Scan + Fix · $199",
  nuclear: "Nuclear · $399",
};

const TIER_BADGE: Record<string, string> = {
  quick: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
  full: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  scan_fix: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30",
  nuclear: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

export default function FixesPage() {
  const fixes = (registry.fixes ?? []) as RegistryFix[];

  return (
    <>
      <Navbar />
      <main className="px-6 py-20 min-h-screen">
        <div className="mx-auto max-w-5xl">
          <header className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-4">
              Public proof registry
            </div>
            <h1 className="text-5xl md:text-6xl font-bold mb-4 tracking-tight">
              Fixes shipped by GateTest
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Every scan + fix we&apos;ve run on a real repo, with real
              timestamps and proof artifacts. We don&apos;t pad the list.
              We don&apos;t hide the failures. Last updated{" "}
              {registry.lastUpdated}.
            </p>
          </header>

          <div className="grid gap-6">
            {fixes.map((fix) => (
              <article
                key={fix.id}
                className="rounded-xl border border-foreground/15 bg-card p-6 hover:border-teal-500/40 transition-colors"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-xl font-bold">{fix.displayName}</h2>
                    <a
                      href={fix.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-mono text-muted-foreground hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                    >
                      {fix.repo}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border ${TIER_BADGE[fix.tier]}`}
                    >
                      {TIER_LABEL[fix.tier]}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {fix.scannedAt}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {fix.stats.modulesRun !== undefined && (
                    <Stat label="Modules" value={`${fix.stats.modulesPassed ?? 0}/${fix.stats.modulesRun}`} />
                  )}
                  {fix.stats.errors !== undefined && (
                    <Stat label="Errors" value={fix.stats.errors} />
                  )}
                  {fix.stats.diagnosed !== undefined && (
                    <Stat label="Diagnosed" value={fix.stats.diagnosed} />
                  )}
                  {fix.stats.chains !== undefined && (
                    <Stat label="Attack chains" value={fix.stats.chains} />
                  )}
                  {fix.stats.fixesShipped !== undefined && (
                    <Stat label="Fixes shipped" value={fix.stats.fixesShipped} />
                  )}
                </div>

                <p className="text-sm text-foreground/90 mb-3">
                  <span className="font-semibold">Notable: </span>
                  {fix.notableFix}
                </p>

                {fix.proofDoc && (
                  <Link
                    href={fix.proofDoc}
                    className="text-sm text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1"
                  >
                    Read full proof →
                  </Link>
                )}
              </article>
            ))}
          </div>

          <div className="mt-16 rounded-2xl border-2 border-teal-500/40 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-8 text-center">
            <h2 className="text-2xl font-bold mb-3">Want yours on this list?</h2>
            <p className="text-muted-foreground mb-5 max-w-xl mx-auto">
              Run a scan, ship the fix, opt in to add your repo to the
              public registry. Closed systems stay private — open-source
              wins extra credibility points.
            </p>
            <Link
              href="/"
              className="btn-primary px-6 py-3 inline-block font-semibold"
            >
              Scan your repo →
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}
