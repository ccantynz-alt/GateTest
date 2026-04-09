import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Scan Requested — GateTest",
  description: "Your GateTest scan is being processed.",
};

export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-6 py-24">
      <div className="max-w-xl w-full text-center">
        <div className="w-20 h-20 rounded-full bg-success/10 border-2 border-success/30 flex items-center justify-center mx-auto mb-8">
          <span className="text-4xl text-success">&#10003;</span>
        </div>

        <h1 className="text-4xl font-bold mb-4">
          <span className="gradient-text">Scan requested.</span>
        </h1>
        <p className="text-lg text-muted mb-4">
          Your card has been held — not charged. We&apos;ll only charge once
          the scan completes and your report is delivered.
        </p>

        <div className="terminal max-w-md mx-auto mb-8">
          <div className="terminal-header">
            <div className="terminal-dot bg-[#ff5f57]" />
            <div className="terminal-dot bg-[#febc2e]" />
            <div className="terminal-dot bg-[#28c840]" />
            <span className="ml-3 text-xs text-muted">What happens next</span>
          </div>
          <div className="p-6 text-left text-sm space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-accent-light shrink-0">1.</span>
              <span className="text-muted">
                We clone your repo and run the full scan
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-accent-light shrink-0">2.</span>
              <span className="text-muted">
                21 modules analyze security, accessibility, performance, and more
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-accent-light shrink-0">3.</span>
              <span className="text-muted">
                You receive the full report via email
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-accent-light shrink-0">4.</span>
              <span className="text-muted">
                If you chose Scan + Fix, a PR with auto-fixes lands in your repo
              </span>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-accent-light shrink-0">5.</span>
              <span className="text-muted">
                Payment captured only after delivery. If scan fails, hold is released.
              </span>
            </div>
          </div>
        </div>

        <p className="text-sm text-muted mb-8">
          You&apos;ll receive an email when your scan is complete.
          Most scans finish within 5 minutes.
        </p>

        <a
          href="/"
          className="text-sm text-muted hover:text-foreground transition-colors"
        >
          &larr; Back to gatetest.io
        </a>
      </div>
    </div>
  );
}
