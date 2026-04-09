import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — GateTest",
  description: "GateTest privacy policy.",
};

export default function Privacy() {
  return (
    <div className="min-h-screen grid-bg px-6 py-24">
      <div className="max-w-3xl mx-auto prose-invert">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted mb-8">Last updated: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Who We Are</h2>
            <p>
              GateTest (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the website gatetest.io
              and provides automated code quality scanning services. This policy explains what data we
              collect, how we use it, and your rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. What Data We Collect</h2>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">Account & Payment Data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Email address (for scan delivery and communication)</li>
              <li>Payment information (processed by Stripe — we never see or store your full card number)</li>
              <li>GitHub username and repository URLs (to perform scans)</li>
            </ul>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">Repository Data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Source code is accessed temporarily in memory during scans</li>
              <li>Source code is <strong>not</strong> permanently stored on our servers</li>
              <li>Scan results (pass/fail outcomes, issue descriptions, file paths) are stored for report delivery</li>
            </ul>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">Website Analytics</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Standard web server logs (IP address, browser type, pages visited)</li>
              <li>We do not use third-party tracking cookies or advertising pixels</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To perform the code scan you requested</li>
              <li>To deliver scan reports and auto-fix pull requests</li>
              <li>To process payments via Stripe</li>
              <li>To communicate about your scan status</li>
              <li>To improve our scanning modules and service quality</li>
            </ul>
            <p className="mt-2">
              <strong>We do not:</strong> sell your data, use your code for training AI models,
              share your code with third parties, or use your data for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. AI Code Review</h2>
            <p>
              If your scan includes AI-powered code review, relevant code snippets are sent to
              Anthropic&apos;s Claude API for analysis. This data is processed under Anthropic&apos;s
              API terms, which prohibit using API inputs for model training. Code sent for AI review
              is not stored by us or Anthropic after the analysis is complete.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. GitHub App Data</h2>
            <p>
              If you install the GateTest GitHub App, we receive webhook events (push and pull request
              notifications) and temporary read access to repository contents. We use this data solely
              to perform automated scans. You can revoke access at any time by uninstalling the app.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Retention</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Source code:</strong> Not stored. Accessed in memory during scan, then discarded.</li>
              <li><strong>Scan reports:</strong> Retained for 90 days for your reference, then deleted.</li>
              <li><strong>Payment records:</strong> Retained as required by tax and financial regulations.</li>
              <li><strong>Email address:</strong> Retained until you request deletion.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Data Security</h2>
            <p>
              All connections to gatetest.io are encrypted via TLS/HTTPS. Payment processing is
              handled entirely by Stripe (PCI-DSS compliant). Repository access uses GitHub&apos;s
              authenticated API with minimal required permissions (read-only for contents).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Request a copy of any data we hold about you</li>
              <li>Request deletion of your data</li>
              <li>Revoke GitHub App access at any time</li>
              <li>Opt out of any communications</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Third-Party Services</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Stripe</strong> — Payment processing (<a href="https://stripe.com/privacy" className="text-accent-light hover:underline" target="_blank" rel="noopener noreferrer">Stripe Privacy Policy</a>)</li>
              <li><strong>GitHub</strong> — Repository access and GitHub App (<a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" className="text-accent-light hover:underline" target="_blank" rel="noopener noreferrer">GitHub Privacy Statement</a>)</li>
              <li><strong>Anthropic</strong> — AI code review (<a href="https://www.anthropic.com/privacy" className="text-accent-light hover:underline" target="_blank" rel="noopener noreferrer">Anthropic Privacy Policy</a>)</li>
              <li><strong>Vercel</strong> — Website hosting (<a href="https://vercel.com/legal/privacy-policy" className="text-accent-light hover:underline" target="_blank" rel="noopener noreferrer">Vercel Privacy Policy</a>)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Changes will be posted on this page with
              an updated date. Continued use of the Service after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Contact</h2>
            <p>
              For privacy questions or data requests, contact us at{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-12">
          <a href="/" className="text-sm text-muted hover:text-foreground transition-colors">
            &larr; Back to gatetest.io
          </a>
        </div>
      </div>
    </div>
  );
}
