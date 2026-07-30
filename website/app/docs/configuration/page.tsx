import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Configuration & suppression — GateTest",
  description:
    "Silence a false positive without weakening the gate: .gatetestignore syntax, baseline mode, auto-softening, gatetest --noise, and .gatetest.json options.",
  alternates: { canonical: "/docs/configuration" },
};

const ignoreExample = `# One rule from one module
secrets:generic-api-key

# A whole module
deadCode

# A rule everywhere it fires, whichever module raised it
*:trailing-whitespace

# Scope a suppression to a path
secrets:generic-api-key@tests/fixtures/**

# Skip a path entirely
vendor/**`;

const noiseExample = `$ gatetest --noise

  GateTest — module noise report
  (learned from this repo's scan history: .gatetest/memory.json)

  module                fires          dismissed  status
  ──────────────────────────────────────────────────────
  hardcodedUrl          100% (63/63)   38         softened (x0.5)
  moneyFloat            84%  (53/63)   38         softened (x0.5)
  lint                  100% (63/63)   0          high-fire`;

const baselineExample = `# Snapshot every current finding, then commit the file
gatetest --baseline
git add .gatetest/baseline.json && git commit -m "chore: baseline GateTest"

# From now on the gate blocks only on findings that aren't in it
gatetest --suite full`;

export default function ConfigurationDocs() {
  return (
    <div className="min-h-screen grid-bg px-6 py-24">
      <div className="max-w-4xl mx-auto">
        <div className="mb-10">
          <p className="text-xs font-mono uppercase tracking-wider text-accent mb-2">
            Docs · Configuration
          </p>
          <h1 className="text-4xl font-bold mb-3">Configuration &amp; suppression</h1>
          <p className="text-muted leading-relaxed">
            Every scanner gets something wrong eventually. The question is whether
            you can tell it so without turning the gate off. Each control below
            narrows what <em>blocks</em> &mdash; none of them hide a finding from
            you.
          </p>
        </div>

        {/* .gatetestignore */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">
            <code className="font-mono text-xl">.gatetestignore</code>
          </h2>
          <p className="text-muted mb-4">
            A file at your repo root. One rule per line;{" "}
            <code className="font-mono text-sm">#</code> comments and blank lines
            are ignored. Module and rule names are matched case-insensitively.
          </p>
          <pre className="card p-4 text-sm overflow-x-auto mb-4">
            <code className="font-mono">{ignoreExample}</code>
          </pre>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border/40">
                  <th className="py-2 pr-4 font-semibold">Form</th>
                  <th className="py-2 font-semibold">Suppresses</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4 font-mono text-xs">module:rule</td>
                  <td className="py-2">one rule in one module</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4 font-mono text-xs">module:* or module</td>
                  <td className="py-2">an entire module</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4 font-mono text-xs">*:rule</td>
                  <td className="py-2">that rule across all modules</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4 font-mono text-xs">module:rule@glob</td>
                  <td className="py-2">that rule, only in matching files</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs">path/glob/**</td>
                  <td className="py-2">any finding whose file matches</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted text-sm leading-relaxed">
            Globs use <code className="font-mono text-xs">*</code> (any run within
            a path segment), <code className="font-mono text-xs">**</code> (any
            run, crossing <code className="font-mono text-xs">/</code>) and{" "}
            <code className="font-mono text-xs">?</code> (one character).
          </p>
          <div className="card p-4 text-sm text-muted mt-4">
            <strong className="text-foreground">Suppressed is not hidden.</strong>{" "}
            A suppressed finding is removed from the gate decision and from every
            failure count, but still reported in a{" "}
            <code className="font-mono text-xs">suppressedChecks</code> list. The
            distinction matters: &ldquo;we don&apos;t block on this&rdquo; is a
            decision you can revisit, &ldquo;we pretend it isn&apos;t
            there&rdquo; isn&apos;t.
          </div>
          <div className="card p-4 text-sm text-muted mt-3">
            A <strong className="text-foreground">path-scoped</strong> entry like{" "}
            <code className="font-mono text-xs">vendor/**</code> says
            &ldquo;this isn&apos;t our code,&rdquo; so it says nothing about
            whether a module is accurate. Only module-scoped entries feed the
            auto-softening below &mdash; excluding a fixture directory should not
            teach the engine to distrust a module that was right.
          </div>
        </section>

        {/* --noise */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">
            Find the noise: <code className="font-mono text-xl">gatetest --noise</code>
          </h2>
          <p className="text-muted mb-4">
            Ranks modules by how often they fire against how often you dismiss
            them, learned from this repo&apos;s own scan history, and prints the
            exact ignore line to copy.
          </p>
          <pre className="card p-4 text-sm overflow-x-auto">
            <code className="font-mono">{noiseExample}</code>
          </pre>
        </section>

        {/* Auto-softening */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">Auto-softening</h2>
          <p className="text-muted leading-relaxed">
            A module you keep dismissing stops blocking the gate on its own. It
            takes repeated dismissals at a high fire-rate &mdash; never a single
            one &mdash; so a module that is occasionally wrong keeps its teeth
            while one that is reliably wrong for <em>your</em> codebase loses
            them. Softened modules still report; they just stop failing the
            build. <code className="font-mono text-sm">--noise</code> shows which
            ones are in that state.
          </p>
        </section>

        {/* Baseline */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">
            Onboarding an existing repo: baseline mode
          </h2>
          <p className="text-muted mb-4">
            Point any scanner at a mature codebase and the first run is a backlog
            you didn&apos;t write. Baseline mode grandfathers everything that
            exists today, so the gate only ever fails on <strong>new</strong>{" "}
            findings.
          </p>
          <pre className="card p-4 text-sm overflow-x-auto mb-4">
            <code className="font-mono">{baselineExample}</code>
          </pre>
          <p className="text-muted text-sm leading-relaxed">
            The count is tracked per file, so you can&apos;t sneak a new problem
            in behind an old one &mdash; add a second empty catch to a file that
            already had one baselined and the gate blocks again. Refresh with{" "}
            <code className="font-mono text-xs">gatetest --baseline</code> after
            paying down debt, or delete{" "}
            <code className="font-mono text-xs">.gatetest/baseline.json</code> to
            see everything again. More in the{" "}
            <Link href="/quickstart" className="text-accent hover:underline">
              quickstart
            </Link>
            .
          </p>
        </section>

        {/* .gatetest.json */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">
            <code className="font-mono text-xl">.gatetest.json</code>
          </h2>
          <p className="text-muted mb-4">
            Project-wide options: which suite runs, per-module configuration, and
            severity overrides. Scaffold one with{" "}
            <code className="font-mono text-sm">gatetest --init</code> rather than
            writing it from scratch &mdash; the generated file reflects the
            options your installed version actually supports.
          </p>
          <p className="text-muted text-sm leading-relaxed">
            Two flags worth knowing while you triage:{" "}
            <code className="font-mono text-xs">--report-only</code> surfaces
            everything without failing the build, and{" "}
            <code className="font-mono text-xs">--strict</code> forces enforcement
            back on when you&apos;re ready. Use{" "}
            <code className="font-mono text-xs">--report-only</code> to see the
            shape of the problem, then baseline it and turn the gate on &mdash;
            leaving a gate permanently in report-only is how teams end up with a
            scanner nobody reads.
          </p>
        </section>

        {/* Choosing */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-3">Which one should I use?</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border/40">
                  <th className="py-2 pr-4 font-semibold">Situation</th>
                  <th className="py-2 font-semibold">Reach for</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4">This finding is simply wrong here</td>
                  <td className="py-2 font-mono text-xs">.gatetestignore</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4">
                    Turning it on over years of existing code
                  </td>
                  <td className="py-2 font-mono text-xs">gatetest --baseline</td>
                </tr>
                <tr className="border-b border-border/20">
                  <td className="py-2 pr-4">
                    A whole module is wrong for our stack
                  </td>
                  <td className="py-2 font-mono text-xs">
                    .gatetestignore (module) or a severity override
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">
                    I want to see everything before deciding
                  </td>
                  <td className="py-2 font-mono text-xs">--report-only, then --noise</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="card p-5 text-sm text-muted">
          Still fighting a false positive? That&apos;s a GateTest bug, not your
          problem to work around forever &mdash; tell us which module and rule at{" "}
          <a className="text-accent hover:underline" href="mailto:hello@gatetest.ai">
            hello@gatetest.ai
          </a>{" "}
          and it gets fixed in the engine.
        </div>
      </div>
    </div>
  );
}
