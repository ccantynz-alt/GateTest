const modules = [
  {
    name: "Syntax",
    description: "Zero compilation errors. JS, TS, JSON, YAML — every file validates.",
    icon: "{ }",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/20",
  },
  {
    name: "Lint",
    description: "ESLint, Stylelint, Markdownlint. Zero warnings policy.",
    icon: "~",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/20",
  },
  {
    name: "Secrets",
    description: "Detects API keys, tokens, passwords, private keys in source code.",
    icon: "!",
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
  },
  {
    name: "Code Quality",
    description: "Catches console.log, debugger, TODO/FIXME, eval(), complexity issues.",
    icon: "Q",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  {
    name: "Unit Tests",
    description: "Auto-detects Jest, Vitest, Mocha. Enforces coverage thresholds.",
    icon: "U",
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/20",
  },
  {
    name: "Integration",
    description: "API endpoints, database operations, service integrations.",
    icon: "I",
    color: "text-teal-400",
    bg: "bg-teal-400/10",
    border: "border-teal-400/20",
  },
  {
    name: "E2E",
    description: "Playwright, Cypress, Puppeteer. Full user journey testing.",
    icon: "E",
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/20",
  },
  {
    name: "Visual",
    description: "Pixel-diff regression, fonts, layout shifts, design tokens.",
    icon: "V",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
    border: "border-pink-400/20",
  },
  {
    name: "Accessibility",
    description: "WCAG 2.2 AAA — alt text, ARIA, focus, contrast, screen readers.",
    icon: "A",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    border: "border-violet-400/20",
  },
  {
    name: "Performance",
    description: "Bundle budgets, Core Web Vitals, Lighthouse scores, memory leaks.",
    icon: "P",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    border: "border-orange-400/20",
  },
  {
    name: "Security",
    description: "OWASP patterns, CVE scanning, XSS, SQLi, CSRF, CSP validation.",
    icon: "S",
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  {
    name: "SEO",
    description: "Meta tags, Open Graph, structured data, sitemaps, robots.txt.",
    icon: "O",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
  {
    name: "Links",
    description: "Broken internal and external link detection across your entire site.",
    icon: "L",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    border: "border-sky-400/20",
  },
  {
    name: "Compatibility",
    description: "Browser matrix validation. Modern API and CSS polyfill checks.",
    icon: "C",
    color: "text-indigo-400",
    bg: "bg-indigo-400/10",
    border: "border-indigo-400/20",
  },
  {
    name: "Data Integrity",
    description: "Database schema, migrations, PII handling, GDPR compliance.",
    icon: "D",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/20",
  },
  {
    name: "Documentation",
    description: "README, CHANGELOG, env docs, API documentation completeness.",
    icon: "R",
    color: "text-slate-400",
    bg: "bg-slate-400/10",
    border: "border-slate-400/20",
  },
];

export default function Modules() {
  return (
    <section id="modules" className="py-24 px-6 border-t border-border/30">
      <div className="mx-auto max-w-7xl">
        <div className="text-center mb-16">
          <span className="text-sm font-semibold text-accent-light uppercase tracking-wider">
            16 Test Modules
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold mt-4 mb-4">
            Every angle. <span className="gradient-text">Every check.</span>
          </h2>
          <p className="text-muted text-lg max-w-2xl mx-auto">
            From syntax to security, from fonts to GDPR. If it can break, GateTest catches it.
            No other tool covers this much ground.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {modules.map((mod) => (
            <div
              key={mod.name}
              className={`rounded-xl p-5 border ${mod.border} ${mod.bg} hover:scale-[1.02] transition-transform`}
            >
              <div className={`w-10 h-10 rounded-lg ${mod.bg} border ${mod.border} flex items-center justify-center font-[var(--font-mono)] font-bold ${mod.color} text-lg mb-3`}>
                {mod.icon}
              </div>
              <h3 className={`font-semibold ${mod.color} mb-1`}>{mod.name}</h3>
              <p className="text-sm text-muted leading-relaxed">{mod.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
