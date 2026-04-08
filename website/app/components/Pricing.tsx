const scanPlans = [
  {
    name: "Quick Scan",
    price: "$29",
    period: "per scan",
    description:
      "Fast quality check. Syntax, linting, secrets, and code quality in under 60 seconds.",
    modules: "4 modules",
    features: [
      "Syntax & compilation validation",
      "Linting (ESLint, Stylelint)",
      "Secret & credential detection",
      "Code quality analysis",
      "Detailed report with fix suggestions",
      "Pay only when scan completes",
    ],
    cta: "Run Quick Scan",
    highlight: false,
  },
  {
    name: "Full Scan",
    price: "$99",
    period: "per scan",
    description:
      "Every module. Every check. Security, accessibility, performance, SEO, and more.",
    modules: "All 20 modules",
    features: [
      "Everything in Quick Scan",
      "Security (OWASP, CVEs, XSS, SQLi)",
      "Accessibility (WCAG 2.2 AAA)",
      "Performance & Core Web Vitals",
      "SEO & metadata validation",
      "Visual regression checks",
      "Browser compatibility",
      "SARIF + JUnit reports for CI",
    ],
    cta: "Run Full Scan",
    highlight: false,
  },
  {
    name: "Scan + Fix",
    price: "$199",
    period: "per scan",
    badge: "Most Popular",
    description:
      "We find every issue AND fix them. A PR with auto-fixes lands in your repo.",
    modules: "20 modules + auto-fix",
    features: [
      "Everything in Full Scan",
      "Auto-fix engine applies safe fixes",
      "Pull request with all fixes applied",
      "Before/after comparison report",
      "Diff-based analysis (changed files only)",
      "Priority processing",
      "Direct support for that scan",
    ],
    cta: "Scan + Fix My Repo",
    highlight: true,
  },
  {
    name: "Nuclear",
    price: "$399",
    period: "per scan",
    description:
      "The most thorough code audit available anywhere. Mutation testing, live crawl, chaos testing.",
    modules: "20 modules + mutation + crawl",
    features: [
      "Everything in Scan + Fix",
      "Mutation testing (tests your tests)",
      "Live site crawl & verification",
      "Chaos & resilience testing",
      "Autonomous element explorer",
      "Full HTML dashboard report",
      "Executive summary PDF",
      "30-day re-scan included",
    ],
    cta: "Go Nuclear",
    highlight: false,
  },
];

const recurringPlans = [
  {
    name: "Continuous",
    price: "$49",
    period: "/month",
    description: "Scan every push. Dashboard. Alerts. Never ship a bug again.",
    features: [
      "Scan on every git push",
      "Cloud dashboard with trends",
      "Slack & email alerts",
      "GitHub PR status checks",
      "Historical reports",
      "Team collaboration",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "tailored",
    description: "Compliance, SSO, audit logs, SLAs, and dedicated support.",
    features: [
      "Everything in Continuous",
      "HIPAA / SOC2 / PCI-DSS modules",
      "SSO / SAML integration",
      "Audit logs & retention",
      "Dedicated support engineer",
      "99.9% SLA",
    ],
  },
];

export default function Pricing() {
  return (
    <section
      id="pricing"
      className="py-24 px-6 border-t border-border/30 grid-bg relative"
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <div className="text-center mb-6">
          <span className="text-sm font-semibold text-accent-light uppercase tracking-wider">
            Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4">
            Pay when it&apos;s done.{" "}
            <span className="gradient-text">Not before.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            We hold your card, run the scan, deliver the report. If we
            can&apos;t complete it, you pay nothing. Zero risk.
          </p>
        </div>

        {/* Trust badge */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-2 bg-success/10 border border-success/20 rounded-full px-5 py-2 text-sm text-success">
            <span>&#9679;</span>
            <span>
              Card hold only &mdash; charged after successful scan delivery
            </span>
          </div>
        </div>

        {/* Per-scan tiers */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 mb-16">
          {scanPlans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl p-6 border transition-all flex flex-col ${
                plan.highlight
                  ? "glow-border bg-surface scale-[1.02]"
                  : "border-border bg-surface hover:border-accent/20"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-accent-light uppercase tracking-wider mb-3">
                  {plan.badge}
                </div>
              )}

              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold gradient-text">
                  {plan.price}
                </span>
                <span className="text-sm text-muted">{plan.period}</span>
              </div>
              <div className="text-xs text-accent-light font-medium mb-3">
                {plan.modules}
              </div>
              <p className="text-sm text-muted mb-5">{plan.description}</p>

              <a
                href="#get-started"
                className={`block text-center py-3 px-5 rounded-lg font-semibold text-sm transition-colors mb-6 ${
                  plan.highlight
                    ? "bg-accent hover:bg-accent-light text-white"
                    : "border border-border hover:border-accent/50 text-foreground"
                }`}
              >
                {plan.cta}
              </a>

              <ul className="space-y-2 mt-auto">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="text-success mt-0.5 shrink-0">
                      &#10003;
                    </span>
                    <span className="text-muted">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Recurring plans */}
        <div className="text-center mb-8">
          <h3 className="text-xl font-bold">
            Need continuous protection?
          </h3>
          <p className="text-muted text-sm mt-2">
            After your first scan proves the value, lock in ongoing coverage.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {recurringPlans.map((plan) => (
            <div
              key={plan.name}
              className="rounded-xl p-6 border border-border bg-surface hover:border-accent/20 transition-all"
            >
              <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-2xl font-bold gradient-text">
                  {plan.price}
                </span>
                <span className="text-sm text-muted">{plan.period}</span>
              </div>
              <p className="text-sm text-muted mb-4">{plan.description}</p>
              <ul className="space-y-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="text-success mt-0.5 shrink-0">
                      &#10003;
                    </span>
                    <span className="text-muted">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom trust line */}
        <p className="text-center text-xs text-muted mt-10">
          All scans include a timestamped report. Payments processed securely
          via Stripe. Card hold released immediately if scan cannot complete.
        </p>
      </div>
    </section>
  );
}
