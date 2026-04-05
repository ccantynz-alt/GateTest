const plans = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Full CLI. All 16 modules. Unlimited local runs. No credit card.",
    features: [
      "All 16 test modules",
      "150+ quality checks",
      "Console, JSON, HTML reports",
      "Pre-commit & pre-push hooks",
      "CLAUDE.md enforcement",
      "Unlimited local runs",
      "Community support",
    ],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$49",
    period: "/month per team",
    description: "Cloud dashboard, historical reports, team collaboration, and managed scanning.",
    features: [
      "Everything in Free",
      "Cloud dashboard",
      "Historical trend analytics",
      "Team collaboration",
      "Shared visual baselines",
      "Managed continuous scanning",
      "GitHub PR integration",
      "Slack & Teams alerts",
      "Priority support",
    ],
    cta: "Start Pro Trial",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "tailored to your needs",
    description: "Compliance modules, SSO, audit logs, SLAs, and dedicated support.",
    features: [
      "Everything in Pro",
      "HIPAA compliance module",
      "SOC2 compliance module",
      "PCI-DSS compliance module",
      "SSO / SAML integration",
      "Audit logs & retention",
      "Custom gate rules",
      "Dedicated support engineer",
      "99.9% SLA",
      "On-premise option",
    ],
    cta: "Contact Sales",
    highlight: false,
  },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-6 border-t border-border/30 grid-bg relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-accent/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <span className="text-sm font-semibold text-accent-light uppercase tracking-wider">
            Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4">
            Start free. <span className="gradient-text">Scale when ready.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            The full CLI with all 16 modules is free. Forever. No catch.
            Upgrade when your team needs dashboards, collaboration, and managed scanning.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl p-8 border transition-all ${
                plan.highlight
                  ? "glow-border bg-surface scale-[1.02]"
                  : "border-border bg-surface hover:border-accent/20"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-accent-light uppercase tracking-wider mb-4">
                  Most Popular
                </div>
              )}

              <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-bold gradient-text">{plan.price}</span>
                <span className="text-sm text-muted">{plan.period}</span>
              </div>
              <p className="text-sm text-muted mb-6">{plan.description}</p>

              <a
                href="#get-started"
                className={`block text-center py-3 px-6 rounded-lg font-semibold text-sm transition-colors mb-8 ${
                  plan.highlight
                    ? "bg-accent hover:bg-accent-light text-white"
                    : "border border-border hover:border-accent/50 text-foreground"
                }`}
              >
                {plan.cta}
              </a>

              <ul className="space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="text-success mt-0.5">&#10003;</span>
                    <span className="text-muted">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
