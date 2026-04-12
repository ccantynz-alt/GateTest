export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center hero-bg overflow-hidden pt-20">
      {/* Gradient mesh wash */}
      <div className="absolute top-0 left-1/4 w-[800px] h-[600px] bg-gradient-to-br from-emerald-100/60 to-transparent rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-40 right-1/4 w-[600px] h-[400px] bg-gradient-to-bl from-teal-100/40 to-transparent rounded-full blur-[80px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-5xl px-6 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full badge-accent text-sm mb-10 fade-up">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          13 Modules &middot; AI-Powered &middot; Pay Only When Delivered
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-[4.5rem] font-bold tracking-tight leading-[1.1] mb-6 fade-up text-foreground">
          AI writes fast.
          <br />
          <span className="gradient-text">GateTest keeps it honest.</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-12 leading-relaxed fade-up">
          13 modules scan your entire codebase &mdash; security, accessibility, SEO,
          code quality, and more. AI-powered code review finds real bugs.
          You only pay when the scan completes.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 fade-up">
          <a href="#pricing" className="btn-cta px-8 py-4 text-base font-bold pulse-glow rounded-xl">
            Scan My Repo &mdash; From $29
          </a>
          <a href="#how-it-works" className="btn-secondary px-8 py-4 text-base">
            See How It Works
          </a>
        </div>

        {/* Terminal demo */}
        <div className="max-w-3xl mx-auto terminal fade-up">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-4 text-xs text-gray-400 font-[var(--font-mono)]">gatetest --suite full --fix</span>
            <span className="ml-auto text-xs text-emerald-400 font-medium tracking-wider">LIVE</span>
          </div>
          <div className="p-6 font-[var(--font-mono)] text-sm text-left space-y-1.5 leading-relaxed text-gray-300">
            <p className="text-emerald-400 font-bold text-xs tracking-wider">GATETEST &mdash; Quality Assurance Gate</p>
            <p className="text-gray-500 text-xs">Running full suite: 13 modules</p>
            <p className="mt-2" />
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">syntax</span> <span className="text-gray-500">&mdash; 47 checks, 12ms</span></p>
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">secrets</span> <span className="text-gray-500">&mdash; 312 files, 0 found</span></p>
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">security</span> <span className="text-gray-500">&mdash; 0 vulns, OWASP clean</span></p>
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">accessibility</span> <span className="text-gray-500">&mdash; WCAG 2.2 AAA</span></p>
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">performance</span> <span className="text-gray-500">&mdash; 98/100, LCP 1.1s</span></p>
            <p>{"  "}<span className="text-emerald-400">&#10003;</span> <span className="text-white/90 font-medium">aiReview</span> <span className="text-gray-500">&mdash; Claude: 2 suggestions</span></p>
            <p>{"  "}<span className="text-gray-500 text-xs">...15 more modules passed</span></p>
            <p className="mt-2" />
            <p className="text-emerald-400 font-bold">{"  "}GATE: PASSED <span className="text-gray-400 font-normal">&mdash; 13/13 modules, 150+ checks, 2.4s</span></p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-16 max-w-2xl mx-auto fade-up stagger">
          {[
            { value: "13", label: "Test Modules" },
            { value: "200+", label: "Quality Checks" },
            { value: "$0", label: "If Scan Fails" },
            { value: "0", label: "Tolerance for Bugs" },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-4 rounded-2xl glass">
              <div className="text-3xl font-bold gradient-text">{stat.value}</div>
              <div className="text-sm text-muted mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
