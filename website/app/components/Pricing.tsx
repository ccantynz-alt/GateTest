// PRE-LAUNCH: checkout is disabled — see website/app/api/checkout/route.ts.
// CTAs link to the waitlist instead of starting checkout. When attorney
// review clears and Stripe is re-enabled, restore the `"use client"`
// directive, the `useState` imports, the `handleCheckout` handler, the
// `<input id="repo-url" />` block, and swap the `<a>` CTAs back to the
// `<button onClick={handleCheckout}>` shape.
const WAITLIST_HREF =
  "mailto:hello@gatetest.io?subject=GateTest%20waitlist&body=Please%20add%20me%20to%20the%20GateTest%20launch%20waitlist.";

const scanPlans = [
  {
    id: "quick",
    name: "Quick Scan",
    price: "$29",
    period: "per scan",
    description:
      "Essential checks. Syntax, linting, secrets, and code quality.",
    modules: "4 modules",
    features: [
      "Syntax & compilation validation",
      "Linting checks",
      "Secret & credential detection",
      "Code quality analysis",
      "Detailed report with file & line numbers",
      "Pay only when scan completes",
    ],
    cta: "Join waitlist",
    highlight: false,
  },
  {
    id: "full",
    name: "Full Scan",
    price: "$99",
    period: "per scan",
    badge: "Most Popular",
    description:
      "Every module. Security, accessibility, SEO, AI code review, and more.",
    modules: "All 67 modules",
    features: [
      "Everything in Quick Scan",
      "Security (OWASP, XSS, SQLi, Docker)",
      "Accessibility (WCAG 2.2 AAA)",
      "SEO & metadata validation",
      "Performance & bundle analysis",
      "AI code review by Claude",
      "Broken link detection",
      "Browser compatibility checks",
      "Data integrity & documentation",
    ],
    cta: "Join waitlist",
    highlight: true,
  },
];

const comingSoon = [
  "Auto-fix PRs — GateTest creates a PR that fixes the issues",
  "Live browser testing — real Playwright-powered page testing",
  "Visual regression — screenshot comparison between deploys",
  "Continuous monitoring — scan on every push, $49/month",
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-6 section-accent">
      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="text-center mb-6">
          <span className="text-sm font-semibold text-accent uppercase tracking-wider">
            Pricing
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4 text-foreground">
            Pay when it&apos;s done. <span className="gradient-text">Not before.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            We hold your card, run the scan, deliver the report. If we
            can&apos;t complete it, you pay nothing.
          </p>
        </div>

        {/* Trust badge */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex items-center gap-2 badge-accent px-5 py-2 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Card hold only &mdash; charged after successful scan delivery
          </div>
        </div>

        {/* PRE-LAUNCH notice (replaces the repo URL + tier-picker input) */}
        <div className="max-w-xl mx-auto mb-12 text-center">
          <div className="inline-block rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            <span className="font-semibold">Pre-launch:</span>{" "}
            scans are not yet available for purchase. Join the waitlist below
            and we&apos;ll email you the moment checkout opens.
          </div>
        </div>

        {/* Scan tiers */}
        <div className="grid md:grid-cols-2 gap-6 mb-16 max-w-3xl mx-auto">
          {scanPlans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl p-6 transition-all flex flex-col ${
                plan.highlight
                  ? "card-highlight"
                  : "card"
              }`}
            >
              {plan.highlight && (
                <div className="text-xs font-semibold text-accent uppercase tracking-wider mb-3">
                  {plan.badge}
                </div>
              )}

              <h3 className="text-lg font-bold text-foreground mb-1">{plan.name}</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold gradient-text">{plan.price}</span>
                <span className="text-sm text-muted">{plan.period}</span>
              </div>
              <div className="text-xs text-accent font-medium mb-3">
                {plan.modules}
              </div>
              <p className="text-sm text-muted mb-5">{plan.description}</p>

              <a
                href={WAITLIST_HREF}
                className={`block w-full text-center py-3 px-5 rounded-xl font-semibold text-sm transition-all mb-6 cursor-pointer ${
                  plan.highlight ? "btn-primary" : "btn-secondary"
                }`}
              >
                {plan.cta}
              </a>

              <ul className="space-y-2.5 mt-auto">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <span className="text-success mt-0.5 shrink-0">&#10003;</span>
                    <span className="text-muted">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Coming Soon */}
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-lg font-bold text-foreground mb-4">Coming Soon</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {comingSoon.map((item) => (
              <div key={item} className="flex items-start gap-2 text-left p-3 rounded-xl border border-dashed border-border bg-white">
                <span className="text-xs font-medium text-muted bg-surface-dark border border-border rounded-full px-2 py-0.5 shrink-0 mt-0.5">Soon</span>
                <span className="text-sm text-muted">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom trust line */}
        <p className="text-center text-xs text-muted mt-10">
          All scans include a detailed report. Payments processed securely via Stripe.
          Card hold released immediately if scan cannot complete.
        </p>
      </div>
    </section>
  );
}
