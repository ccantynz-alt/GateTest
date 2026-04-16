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

export default function Modules() {
  return (
    <section id="modules" className="py-24 px-6 border-t border-border">
      <div className="mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <span className="text-sm font-semibold text-accent uppercase tracking-wider">
            What We Check
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4 text-foreground">
            67 modules. <span className="gradient-text">Every scan.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            Source code analysis that catches what other tools miss.
            Every module runs on every scan. No configuration needed.
          </p>
          <p className="text-muted text-sm max-w-2xl mx-auto mt-3">
            13 core modules shown below &mdash; plus 54 more covering
            polyglot dependencies, Dockerfile &amp; Kubernetes hygiene,
            CI security, Terraform, SQL migrations, TLS &amp; cookie
            config, PII-in-logs, N+1 queries, SSRF, ReDoS, and more.
          </p>
        </div>

        {/* Active modules — the 13 flagship module cards. The remaining
            54 modules (infra, supply-chain, language checkers, etc.) are
            summarised in the subtitle above; see CLAUDE.md for the full
            list. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
          {activeModules.map((mod) => (
            <div
              key={mod.name}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center font-[var(--font-mono)] font-bold text-accent text-sm mb-3">
                {mod.icon}
              </div>
              <h3 className="font-semibold text-foreground mb-1">{mod.name}</h3>
              <p className="text-sm text-muted leading-relaxed">{mod.description}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
