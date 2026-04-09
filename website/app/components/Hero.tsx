export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center hero-bg overflow-hidden pt-20">
      {/* Ambient orbs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-accent/8 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 left-0 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none" />

      {/* Floating particles */}
      <div className="particle particle-sm" style={{ top: "15%", left: "10%" }} />
      <div className="particle particle-md" style={{ top: "25%", right: "15%" }} />
      <div className="particle particle-lg" style={{ top: "60%", left: "20%" }} />
      <div className="particle particle-sm" style={{ top: "70%", right: "25%" }} />
      <div className="particle particle-md" style={{ top: "40%", left: "80%" }} />
      <div className="particle particle-lg" style={{ top: "80%", left: "50%" }} />

      <div className="scan-line" />

      <div className="relative z-10 mx-auto max-w-6xl px-6 text-center stagger">
        {/* Badge */}
        <div className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full glass border-border-bright text-sm text-accent-light mb-10 fade-up">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
          </span>
          21 Modules &middot; AI-Powered &middot; Pay Only When Delivered
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-7xl lg:text-[5.5rem] font-bold tracking-tight leading-[1.05] mb-7 fade-up">
          AI writes fast.
          <br />
          <span className="gradient-text">GateTest keeps it honest.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-12 leading-relaxed fade-up">
          21 modules scan your entire codebase — security, accessibility, performance,
          and 18 more. We find the bugs <strong className="text-foreground">AND fix them</strong>.
          You only pay when the scan completes.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 fade-up">
          <a
            href="#pricing"
            className="btn-primary px-10 py-4.5 text-base pulse-glow"
          >
            Scan My Repo — From $29
          </a>
          <a
            href="#how-it-works"
            className="btn-secondary px-10 py-4.5 text-base"
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
            <span className="ml-4 text-xs text-muted font-[var(--font-mono)]">gatetest --suite full --fix</span>
            <span className="ml-auto text-xs text-success font-medium">LIVE</span>
          </div>
          <div className="p-6 font-[var(--font-mono)] text-sm text-left space-y-1.5 leading-relaxed">
            <p className="text-accent-light">========================================</p>
            <p className="text-accent-light font-bold">{"  "}GATETEST — Quality Assurance Gate</p>
            <p className="text-accent-light">========================================</p>
            <p className="text-muted text-xs">{"  "}Running full suite: 21 modules (auto-fix ON)</p>
            <p />
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">syntax</span> <span className="text-muted">— 47 checks, 12ms</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">secrets</span> <span className="text-muted">— 312 files, 0 found</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">security</span> <span className="text-muted">— 0 vulns, OWASP clean</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">accessibility</span> <span className="text-muted">— WCAG 2.2 AAA</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">performance</span> <span className="text-muted">— 98/100, LCP 1.1s</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">mutation</span> <span className="text-muted">— 91% score, 3 survived</span></p>
            <p>{"  "}<span className="text-success">&#10003;</span> <span className="text-success/80">aiReview</span> <span className="text-muted">— Claude: 2 suggestions</span></p>
            <p>{"  "}<span className="text-muted text-xs">...14 more modules passed</span></p>
            <p />
            <p>{"  "}<span className="text-success font-medium">+ auto-fixed:</span> <span className="text-muted">Removed 3 console.log statements</span></p>
            <p>{"  "}<span className="text-success font-medium">+ auto-fixed:</span> <span className="text-muted">Added missing alt text to 2 images</span></p>
            <p />
            <p className="text-accent-light">────────────────────────────────────────</p>
            <p className="text-lg font-bold">{"  "}<span className="text-success px-3 py-0.5 bg-success/10 rounded-md border border-success/20">GATE: PASSED</span></p>
            <p className="text-muted text-xs">{"  "}21/21 modules | 200+ checks | 5 auto-fixed | 2.4s</p>
            <p className="text-accent-light">========================================</p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 mt-20 max-w-3xl mx-auto fade-up stagger">
          {[
            { value: "21", label: "Test Modules" },
            { value: "200+", label: "Quality Checks" },
            { value: "$0", label: "If Scan Fails" },
            { value: "0", label: "Tolerance for Bugs" },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-4 rounded-xl glass">
              <div className="text-3xl sm:text-4xl font-bold gradient-text">{stat.value}</div>
              <div className="text-xs sm:text-sm text-muted mt-1.5">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
