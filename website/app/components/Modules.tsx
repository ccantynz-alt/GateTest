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
  {
    name: "Fake-Fix Detector",
    description: "Catches AI-generated symptom patches — skipped tests, swallowed errors, dead code.",
    icon: "FF",
  },
  {
    name: "Dependency Freshness",
    description: "CVE scan + staleness check on every package.json dependency via OSV.dev + npm.",
    icon: "DF",
  },
  {
    name: "Supply Chain",
    description: "Typosquat detection against top npm packages. Lifecycle script audit for malicious payloads.",
    icon: "SC",
  },
  {
    name: "License Compliance",
    description: "Per-dependency license lookup. Flags GPL, AGPL, SSPL — copyleft risks for SaaS.",
    icon: "LC",
  },
  {
    name: "IaC Security",
    description: "Dockerfiles, Kubernetes manifests, Terraform — :latest tags, privileged mode, 0.0.0.0/0.",
    icon: "IC",
  },
  {
    name: "CI/CD Hardening",
    description: "GitHub Actions audit — unpinned actions, pull_request_target, missing permissions.",
    icon: "CI",
  },
  {
    name: "Migration Safety",
    description: "SQL migration files — DROP COLUMN, non-concurrent indexes, DELETE without WHERE.",
    icon: "MS",
  },
  {
    name: "Auth Flaws",
    description: "JWT alg:none, bcrypt rounds < 10, httpOnly:false, hardcoded session secrets.",
    icon: "AF",
  },
  {
    name: "Flaky Tests",
    description: "Catches .only/.skip leaks, setTimeout in tests, Math.random without seeds, missing await.",
    icon: "FT",
  },
];

const categories = [
  {
    name: "Security",
    blurb: "Vulnerabilities that get you breached",
    modules: [
      { name: "Secrets", desc: "AWS keys, GitHub tokens, Stripe keys, 14 credential patterns" },
      { name: "SSRF", desc: "User-controlled URLs reaching internal services or cloud metadata" },
      { name: "TLS Security", desc: "rejectUnauthorized:false, verify=False, NODE_TLS_REJECT_UNAUTHORIZED=0" },
      { name: "Cookie Security", desc: "httpOnly:false, secure:false, weak session secrets" },
      { name: "Hardcoded URLs", desc: "localhost, RFC1918 IPs, staging subdomains baked into prod code" },
      { name: "ReDoS", desc: "Catastrophic regex backtracking — nested quantifiers, overlapping alternation" },
    ],
  },
  {
    name: "Code Quality",
    blurb: "Bugs hiding in plain sight",
    modules: [
      { name: "N+1 Queries", desc: "DB calls inside loops across Prisma, Sequelize, TypeORM, Mongoose, Drizzle" },
      { name: "Race Conditions", desc: "TOCTOU / check-then-act: stat → unlink, findOne → create without transaction" },
      { name: "Resource Leaks", desc: "Unclosed streams, setInterval with no clearInterval, open file handles" },
      { name: "Error Swallow", desc: "Empty catch {}, .catch(() => {}), fire-and-forget .save() without await" },
      { name: "Async Iteration", desc: ".forEach(async), .filter(async), unwrapped .map(async)" },
      { name: "Import Cycles", desc: "Circular dependencies causing runtime TDZ — Tarjan SCC algorithm" },
      { name: "Retry Hygiene", desc: "No backoff, no jitter, unbounded while(true) retry loops" },
    ],
  },
  {
    name: "AI & Safety",
    blurb: "LLM-era attack surfaces",
    modules: [
      { name: "Prompt Safety", desc: "Injection surfaces, NEXT_PUBLIC_ API keys, unbounded max_tokens cost-DoS" },
      { name: "Deprecated Models", desc: "claude-v1, text-davinci-*, palm-2 — retired models in production" },
      { name: "AI Code Review", desc: "Claude reads your code, finds real bugs, explains root causes" },
      { name: "Agentic Explorer", desc: "AI agent investigates memory-informed hypotheses about your codebase" },
    ],
  },
  {
    name: "TypeScript",
    blurb: "Type safety drift that bites at runtime",
    modules: [
      { name: "TypeScript Strictness", desc: "strict:false, noImplicitAny:false, @ts-nocheck, any-typed exports" },
      { name: "Syntax", desc: "JS, TS, JSON, YAML, CSS, HTML parse errors — broken imports, unclosed brackets" },
      { name: "Lint", desc: "ESLint with flat config (v9+), Stylelint — runs from correct config directory" },
      { name: "Dead Code", desc: "Unused exports, orphaned files, 10+ line commented-out blocks" },
      { name: "Flaky Tests", desc: ".only/.skip committed, Math.random(), real fetch in tests, unrestored env" },
      { name: "Feature Flags", desc: "if(true), if(false), FEATURE_X=true stale-const collapsed flags" },
    ],
  },
  {
    name: "Infrastructure",
    blurb: "Misconfigs that own your cloud",
    modules: [
      { name: "Dockerfile", desc: "root user, :latest tags, curl|sh, secrets baked into layers" },
      { name: "CI Security", desc: "Unpinned Actions, shell injection via ${{ github.event }}, soft-fail gate" },
      { name: "Kubernetes", desc: "privileged, hostNetwork, :latest images, docker.sock, missing resource limits" },
      { name: "Terraform", desc: "Public S3 ACL, 0.0.0.0/0 on SSH/RDP, unencrypted RDS, IAM Principal=*" },
      { name: "Shell Scripts", desc: "curl|sh, unsafe rm -rf $VAR, eval injection, missing set -euo pipefail" },
      { name: "SQL Migrations", desc: "DROP COLUMN, ADD NOT NULL without default, INDEX without CONCURRENTLY" },
    ],
  },
  {
    name: "Developer Hygiene",
    blurb: "The quiet tax on every codebase",
    modules: [
      { name: "Log PII", desc: "console.log(password), logger.info(user), JSON.stringify(headers)" },
      { name: "Env Vars", desc: "References without declaration, unused declared vars, NEXT_PUBLIC_ exposure" },
      { name: "Cron Expressions", desc: "Invalid fields, impossible dates (Feb 30), @weely typos" },
      { name: "Datetime Bugs", desc: "datetime.now() naive, Date() month 0-vs-1, moment() without .tz()" },
      { name: "Money Float", desc: "parseFloat(price), float(amount) — currency drift via IEEE-754" },
      { name: "Secret Rotation", desc: "Credentials > 90 days old (git blame), .env ↔ .env.example drift" },
      { name: "Web Headers", desc: "CSP unsafe-eval, wildcard CORS+credentials, HSTS < 180 days" },
      { name: "OpenAPI Drift", desc: "Code routes missing from spec, spec paths with no handler" },
      { name: "Homoglyphs", desc: "Trojan Source bidi chars (CVE-2021-42574), Cyrillic in Latin identifiers" },
      { name: "PR Size", desc: "Files > 100, lines > 1000, per-file > 500, directory sprawl > 3" },
    ],
  },
  {
    name: "Language Coverage",
    blurb: "9 language backends — same engine",
    modules: [
      { name: "Python", desc: "Django, Flask, FastAPI — same 67 checks, Python-native patterns" },
      { name: "Go", desc: "Go modules, goroutine patterns, standard library idioms" },
      { name: "Rust", desc: "Cargo ecosystem, unsafe blocks, ownership-adjacent patterns" },
      { name: "Java", desc: "Maven/Gradle, Spring patterns, Java-specific security rules" },
      { name: "Ruby", desc: "Bundler, Rails patterns, Ruby security idioms" },
      { name: "PHP", desc: "Composer, WordPress patterns, PHP-specific injection vectors" },
      { name: "C#", desc: ".NET/NuGet ecosystem, ASP.NET patterns" },
      { name: "Kotlin", desc: "Gradle/Maven, Android and JVM Kotlin patterns" },
      { name: "Swift", desc: "Swift Package Manager, iOS/macOS security patterns" },
    ],
  },
  {
    name: "Scanning & Testing",
    blurb: "Beyond static analysis",
    modules: [
      { name: "Performance", desc: "Lighthouse metrics — FCP, LCP, CLS, TTI, TBT" },
      { name: "Accessibility", desc: "WCAG 2.2 AAA — alt text, ARIA, keyboard traps, heading hierarchy" },
      { name: "SEO", desc: "Meta tags, Open Graph, canonical URLs, structured data" },
      { name: "Links", desc: "Broken internal and external links — no dead anchors" },
      { name: "Mutation Testing", desc: "Modifies your source to verify tests actually catch bugs" },
      { name: "Visual Regression", desc: "Screenshot comparison between deploys — pixel-level changes" },
      { name: "Chaos Testing", desc: "Network failures, slow responses, dependency outages" },
      { name: "Live Crawler", desc: "Playwright browser — visits every page, clicks every button" },
    ],
  },
  {
    name: "Source & Quality",
    blurb: "Foundation of every scan",
    modules: [
      { name: "Code Quality", desc: "console.log, debugger, TODO/FIXME, eval(), complexity thresholds" },
      { name: "Security", desc: "OWASP patterns, XSS, SQL injection, innerHTML, shell exec" },
      { name: "Dependencies", desc: "npm/pip/Cargo/Go — wildcards, :latest pins, deprecated packages" },
      { name: "Unit Tests", desc: "Test coverage, missing test files, test quality analysis" },
      { name: "Integration Tests", desc: "API contract tests, service boundary verification" },
      { name: "Documentation", desc: "README accuracy, JSDoc completeness, OpenAPI spec presence" },
      { name: "Compatibility", desc: "Node.js version, browser targets, breaking API usage" },
      { name: "Data Integrity", desc: "Schema validation, data contract enforcement" },
      { name: "Fake-Fix Detector", desc: "Catches AI chicken-scratching — symptom patches, not root causes" },
    ],
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
    name: "Auto-Fix PRs",
    description: "GateTest creates a pull request that fixes the issues it finds. Automatically.",
  },
  {
    name: "Mutation Testing",
    description: "Modifies your source code to verify your tests actually catch bugs.",
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
            Source code analysis, AI review, infrastructure hardening, supply chain,
            and 9 language backends. Every module runs on every Full Scan. No
            configuration needed.
          </p>
        </div>

        {/* Active modules */}
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

        {/* Coming Soon */}
        <div className="text-center mb-8">
          <span className="text-sm font-semibold text-muted uppercase tracking-wider">
            Coming Soon
          </span>
          <h3 className="text-2xl font-bold mt-3 mb-2 text-foreground">
            More modules in development
          </h3>
          <p className="text-muted max-w-xl mx-auto">
            Live browser testing, visual regression, auto-fix PRs, and mutation testing.
            Powered by real browser automation.
          </p>
        </div>

        {/* Active modules — the 13 flagship module cards. The remaining
            54 modules (infra, supply-chain, language checkers, etc.) are
            summarised in the subtitle above; see CLAUDE.md for the full
            list. */}
        {categories.map((cat) => (
          <div key={cat.name} className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground">{cat.name}</h3>
                <p className="text-sm text-muted">{cat.blurb}</p>
              </div>
              <span className="text-xs font-mono text-muted shrink-0 ml-4">
                {cat.modules.length} module{cat.modules.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cat.modules.map((mod) => (
                <div key={mod.name} className="card p-4">
                  <span className="text-sm font-semibold text-foreground">{mod.name}</span>
                  <p className="text-xs text-muted mt-1">{mod.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

      </div>
    </section>
  );
}
