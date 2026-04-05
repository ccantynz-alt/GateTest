const rules = [
  {
    number: "01",
    name: "Zero Tolerance",
    description: "Any single check failure blocks the entire pipeline. No \"it's just a warning\" — warnings are errors.",
  },
  {
    number: "02",
    name: "No Manual Overrides",
    description: "No human can bypass the gate. The checks either pass or the build is rejected. Period.",
  },
  {
    number: "03",
    name: "No Partial Deploys",
    description: "Either everything passes and ships, or nothing ships. No \"deploy anyway, we'll fix it later.\"",
  },
  {
    number: "04",
    name: "Evidence Required",
    description: "Every gate pass produces a timestamped report with full pass/fail details. Reports stored permanently.",
  },
  {
    number: "05",
    name: "Regression = Rollback",
    description: "If production monitoring detects a regression within 15 minutes of deploy, automatic rollback triggers.",
  },
  {
    number: "06",
    name: "Shift Left",
    description: "Catch issues as early as possible. IDE-level first, pre-commit second, CI third. Never defer.",
  },
];

export default function GateRules() {
  return (
    <section className="py-24 px-6 border-t border-border/30">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <span className="text-sm font-semibold text-danger uppercase tracking-wider">
            Non-Negotiable
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4">
            The gate rules are <span className="text-danger">absolute</span>.
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            These aren&apos;t guidelines. They&apos;re laws. Every build, every commit, every push
            is held to these standards without exception.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rules.map((rule) => (
            <div
              key={rule.number}
              className="rounded-xl p-6 border border-danger/20 bg-danger/5 hover:border-danger/40 transition-colors"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="w-8 h-8 rounded-md bg-danger/10 border border-danger/20 flex items-center justify-center font-[var(--font-mono)] text-xs text-danger font-bold">
                  {rule.number}
                </span>
                <h3 className="font-semibold text-danger">{rule.name}</h3>
              </div>
              <p className="text-sm text-muted leading-relaxed">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
