export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center grid-bg overflow-hidden pt-20">
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="scan-line" />

      <div className="relative z-10 mx-auto max-w-6xl px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/30 bg-accent/5 text-sm text-accent-light mb-8 fade-up">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          v1.0 — 16 Test Modules. Zero Tolerance.
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-8xl font-bold tracking-tight leading-[1.05] mb-6 fade-up">
          AI writes fast.
          <br />
          <span className="gradient-text">GateTest keeps it honest.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed fade-up">
          The advanced QA gate between AI and production. 16 test modules covering
          security, accessibility, performance, visual regression, SEO, and everything
          in between. One gate. One decision. Nothing ships unless it&apos;s pristine.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 fade-up">
          <a
            href="#get-started"
            className="px-8 py-4 text-base font-semibold rounded-xl bg-accent hover:bg-accent-light text-white transition-all pulse-glow"
          >
            Get Started Free
          </a>
          <a
            href="#how-it-works"
            className="px-8 py-4 text-base font-semibold rounded-xl border border-border hover:border-accent/50 text-foreground transition-all"
          >
            See How It Works
          </a>
        </div>

        {/* Terminal demo */}
        <div className="max-w-3xl mx-auto terminal fade-up">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-4 text-xs text-muted font-[var(--font-mono)]">gatetest --suite full</span>
          </div>
          <div className="p-6 font-[var(--font-mono)] text-sm text-left space-y-1.5 leading-relaxed">
            <p className="text-accent-light">========================================</p>
            <p className="text-accent-light font-bold">{"  "}GATETEST — Quality Assurance Gate</p>
            <p className="text-accent-light">========================================</p>
            <p className="text-muted">{"  "}Running full suite: 16 modules</p>
            <p className="text-muted" />
            <p>{"  "}<span className="text-success">[PASS]</span> syntax <span className="text-muted">— 47 checks, 12ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> lint <span className="text-muted">— 183 checks, 89ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> secrets <span className="text-muted">— 312 files scanned, 0 found</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> codeQuality <span className="text-muted">— 28 checks, 34ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> unitTests <span className="text-muted">— 94% coverage, 1.2s</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> security <span className="text-muted">— 0 vulnerabilities, 156ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> accessibility <span className="text-muted">— WCAG 2.2 AAA, 89ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> performance <span className="text-muted">— 98/100, LCP 1.1s</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> visual <span className="text-muted">— 0 regressions, 234ms</span></p>
            <p>{"  "}<span className="text-success">[PASS]</span> seo <span className="text-muted">— 100/100, structured data valid</span></p>
            <p className="text-muted" />
            <p className="text-accent-light">----------------------------------------</p>
            <p className="text-lg font-bold">{"  "}<span className="text-success px-3 py-0.5 bg-success/10 rounded">GATE: PASSED</span></p>
            <p className="text-muted">{"  "}16/16 modules passed — 847 checks in 2.1s</p>
            <p className="text-accent-light">========================================</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-16 max-w-3xl mx-auto fade-up">
          {[
            { value: "16", label: "Test Modules" },
            { value: "150+", label: "Quality Checks" },
            { value: "24/7", label: "Continuous Scanning" },
            { value: "0", label: "Tolerance for Bugs" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-bold gradient-text">{stat.value}</div>
              <div className="text-sm text-muted mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
