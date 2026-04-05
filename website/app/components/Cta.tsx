export default function Cta() {
  return (
    <section id="get-started" className="py-24 px-6 border-t border-border/30 grid-bg relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-accent/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <h2 className="text-3xl sm:text-5xl font-bold mb-6">
          Stop shipping <span className="text-danger">broken code</span>.
        </h2>
        <p className="text-lg text-muted mb-10 max-w-xl mx-auto">
          Install GateTest in 30 seconds. Run your first gate check in 60.
          All 16 modules. Free forever.
        </p>

        {/* Install command */}
        <div className="terminal max-w-xl mx-auto mb-10">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
          </div>
          <div className="p-5 font-[var(--font-mono)] text-sm text-left">
            <p className="text-muted">
              <span className="text-accent-light">$</span> npm install -g gatetest
            </p>
            <p className="text-muted">
              <span className="text-accent-light">$</span> gatetest --init
            </p>
            <p className="text-muted">
              <span className="text-accent-light">$</span> gatetest --suite full
            </p>
            <p className="text-success mt-3 font-bold">GATE: PASSED</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#"
            className="px-8 py-4 text-base font-semibold rounded-xl bg-accent hover:bg-accent-light text-white transition-all pulse-glow"
          >
            Get Started Free
          </a>
          <a
            href="#"
            className="px-8 py-4 text-base font-semibold rounded-xl border border-border hover:border-accent/50 text-foreground transition-all"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
