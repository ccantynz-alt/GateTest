const activeModules = [
  {
    name: "Syntax",
    description: "Validates JS, TS, JSON, YAML, CSS, HTML. Catches broken imports and unclosed brackets.",
    icon: "{ }",
  },
  {
    name: "Lint",
    description: "ESLint, Stylelint checks. Catches var usage, formatting issues, style violations.",
    icon: "~",
  },
  {
    name: "Secrets",
    description: "14 patterns: AWS keys, GitHub tokens, Stripe keys, passwords, private keys, DB strings.",
    icon: "!",
  },
  {
    name: "Code Quality",
    description: "Catches console.log, debugger, TODO/FIXME, eval(), function complexity.",
    icon: "Q",
  },
  {
    name: "Security",
    description: "OWASP patterns, XSS, SQL injection, innerHTML, shell exec, Docker misconfigs.",
    icon: "S",
  },
  {
    name: "Accessibility",
    description: "WCAG 2.2 AAA — missing alt text, ARIA labels, keyboard traps, heading hierarchy.",
    icon: "A",
  },
  {
    name: "SEO",
    description: "Meta tags, Open Graph, structured data, robots.txt, canonical URLs.",
    icon: "O",
  },
  {
    name: "Links",
    description: "Finds every broken href — dead anchors, placeholder links, 404s.",
    icon: "L",
  },
  {
    name: "Compatibility",
    description: "Browser matrix validation. Modern API and CSS features without polyfills.",
    icon: "C",
  },
  {
    name: "Data Integrity",
    description: "Migration safety, SQL injection patterns, PII in logs, database schema validation.",
    icon: "D",
  },
  {
    name: "Documentation",
    description: "README, CHANGELOG, LICENSE, JSDoc coverage, env documentation.",
    icon: "R",
  },
  {
    name: "Performance",
    description: "Dependency count, bundle size analysis, image optimisation checks.",
    icon: "P",
  },
  {
    name: "AI Code Review",
    description: "Claude AI reads your code and finds real bugs — not patterns, actual understanding.",
    icon: "AI",
  },
];

const comingSoonModules = [
  {
    name: "Live Browser Testing",
    description: "Playwright-powered. Opens a real browser, visits every page, clicks every button.",
  },
  {
    name: "Visual Regression",
    description: "Screenshot comparison between deploys. Catches pixel-level changes automatically.",
  },
  {
    name: "E2E Testing",
    description: "Full user journey testing. Login flows, checkout flows, form submissions.",
  },
  {
    name: "Auto-Fix PRs",
    description: "GateTest creates a pull request that fixes the issues it finds. Automatically.",
  },
  {
    name: "Mutation Testing",
    description: "Modifies your source code to verify your tests actually catch bugs.",
  },
  {
    name: "Chaos Testing",
    description: "Simulates slow networks, API failures, and missing resources.",
  },
  {
    name: "Live Site Crawler",
    description: "Crawls your entire live site checking every page for errors.",
  },
  {
    name: "Autonomous Explorer",
    description: "AI agent that fills forms, clicks buttons, and verifies state changes.",
  },
];

export default function Modules() {
  return (
    <section id="modules" className="py-24 px-6 border-t border-border">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <span className="text-sm font-semibold text-accent uppercase tracking-wider">
            What We Check
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4 text-foreground">
            13 modules. <span className="gradient-text">Every scan.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            Source code analysis that catches what other tools miss.
            Every module runs on every scan. No configuration needed.
          </p>
        </div>

        {/* Active modules */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
          {activeModules.map((mod) => (
            <div
              key={mod.name}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center font-[var(--font-mono)] font-bold text-accent text-sm mb-3">
                {mod.icon}
              </div>
              <h3 className="font-semibold text-foreground mb-1">{mod.name}</h3>
              <p className="text-sm text-muted leading-relaxed">{mod.description}</p>
            </div>
          ))}
        </div>

        {/* Coming Soon */}
        <div className="text-center mb-8">
          <span className="text-sm font-semibold text-muted uppercase tracking-wider">
            Coming Soon
          </span>
          <h3 className="text-2xl font-bold mt-3 mb-2 text-foreground">
            8 more modules in development
          </h3>
          <p className="text-muted max-w-xl mx-auto">
            Live browser testing, visual regression, auto-fix PRs, and more.
            Powered by real browser automation.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {comingSoonModules.map((mod) => (
            <div
              key={mod.name}
              className="p-4 rounded-xl border border-dashed border-border bg-surface-dark"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-muted bg-surface-dark border border-border rounded-full px-2 py-0.5">
                  Soon
                </span>
                <h4 className="font-semibold text-sm text-foreground">{mod.name}</h4>
              </div>
              <p className="text-xs text-muted leading-relaxed">{mod.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
