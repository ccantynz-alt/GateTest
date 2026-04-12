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
        <p className="text-sm text-muted mb-8">Effective date: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Who We Are</h2>
            <p>
              GateTest (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) operates the website gatetest.io
              and provides automated code quality scanning services. This Privacy Policy explains what
              personal data we collect, how we use it, how we protect it, and your rights regarding
              your data. This policy applies to all users of our website, GitHub App, CLI tool, and
              paid scanning services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Data We Collect</h2>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">2.1 Account and Payment Data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Email address (for scan delivery, receipts, and communication)</li>
              <li>Payment information (processed entirely by Stripe — we never see, store, or have access to your full card number, CVV, or billing address)</li>
              <li>GitHub username and organisation name (when installing the GitHub App)</li>
              <li>Repository URLs submitted for scanning</li>
            </ul>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">2.2 Repository Data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Source code is accessed <strong>temporarily in memory</strong> during the scan process</li>
              <li>Source code is <strong>NOT permanently stored</strong> on our servers, databases, or any persistent storage</li>
              <li>Source code is <strong>NOT copied, cached, backed up, or retained</strong> after the scan completes</li>
              <li>Scan results (pass/fail outcomes, issue descriptions, file paths, line numbers) are stored for report delivery</li>
              <li>Scan results do <strong>NOT contain your actual source code</strong> — only metadata about issues found</li>
            </ul>

            <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">2.3 Website Data</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Standard web server logs (IP address, browser type, referring URL, pages visited, timestamps)</li>
              <li>We do <strong>NOT</strong> use third-party tracking cookies</li>
              <li>We do <strong>NOT</strong> use advertising pixels or retargeting</li>
              <li>We do <strong>NOT</strong> use Google Analytics or similar tracking services</li>
              <li>We do <strong>NOT</strong> sell, rent, or trade any user data to third parties</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. How We Use Your Data</h2>
            <p>We use your data strictly for the following purposes:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Performing the code scan you requested and paid for</li>
              <li>Delivering scan reports and auto-fix pull requests</li>
              <li>Processing payments via Stripe</li>
              <li>Sending transactional communications (scan status, receipts)</li>
              <li>Responding to support enquiries</li>
              <li>Improving scan accuracy and module quality (using aggregate, anonymised data only)</li>
            </ul>
            <p className="mt-3 font-semibold text-foreground">We absolutely DO NOT:</p>
            <ul className="list-disc pl-5 space-y-1 mt-1">
              <li>Sell, rent, lease, or trade your personal data or code to any third party</li>
              <li>Use your source code for training AI models or machine learning</li>
              <li>Share your code or scan results with other customers</li>
              <li>Use your data for advertising, profiling, or marketing to third parties</li>
              <li>Access your repositories outside the scope of the requested scan</li>
              <li>Retain your source code after the scan is complete</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. AI Code Review Data Handling</h2>
            <p>
              If your scan includes the AI-powered code review module, relevant code snippets from the
              files being reviewed are sent to the Anthropic Claude API for analysis. This data handling
              is governed by the following:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Anthropic&apos;s API usage policy explicitly prohibits using API inputs for model training</li>
              <li>Code sent for AI review is processed in real-time and is not stored by Anthropic after analysis</li>
              <li>Only files selected for review are sent — not your entire repository</li>
              <li>You may opt out of AI review by selecting a scan tier that does not include it</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. GitHub App Data</h2>
            <p>
              If you install the GateTest GitHub App on your account or organisation:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>We receive webhook events for push and pull request activities on connected repositories</li>
              <li>We receive temporary read access to repository contents for the purpose of scanning</li>
              <li>We do not access repositories that are not connected to the App</li>
              <li>We do not access any repositories after the App is uninstalled</li>
              <li>You can revoke access at any time by uninstalling the App from your GitHub settings</li>
              <li>Uninstallation is immediate and irrevocable — we lose all access instantly</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Retention</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Source code:</strong> NOT stored. Accessed in memory during scan, discarded immediately upon completion. Zero retention.</li>
              <li><strong>Scan reports:</strong> Retained for 90 days for your reference and re-download, then permanently deleted.</li>
              <li><strong>Payment records:</strong> Retained as required by New Zealand tax law and financial regulations (currently 7 years for tax records).</li>
              <li><strong>Email address:</strong> Retained until you request deletion or unsubscribe.</li>
              <li><strong>Server logs:</strong> Retained for 30 days for security and debugging, then deleted.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Data Security</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>All connections to gatetest.io are encrypted via TLS 1.2+ (HTTPS)</li>
              <li>Payment processing is handled entirely by Stripe (PCI-DSS Level 1 compliant)</li>
              <li>Repository access uses GitHub&apos;s authenticated API with time-limited installation tokens</li>
              <li>Minimal permissions requested — read-only for contents, write only for PR comments and commit statuses</li>
              <li>No source code is written to disk, databases, or persistent storage at any point</li>
              <li>Infrastructure hosted on Vercel with SOC 2 Type II compliance</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Your Rights</h2>
            <p>
              Regardless of your location, you have the following rights regarding your personal data:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><strong>Right to access:</strong> Request a copy of all personal data we hold about you</li>
              <li><strong>Right to rectification:</strong> Request correction of inaccurate data</li>
              <li><strong>Right to deletion:</strong> Request permanent deletion of your data</li>
              <li><strong>Right to portability:</strong> Request your data in a machine-readable format</li>
              <li><strong>Right to withdraw consent:</strong> Revoke GitHub App access or unsubscribe at any time</li>
              <li><strong>Right to object:</strong> Object to specific data processing activities</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, contact{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>.
              We will respond to all requests within 20 working days, as required by the New Zealand
              Privacy Act 2020.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. International Data Transfers</h2>
            <p>
              Your data may be processed in countries outside your jurisdiction, including the United States
              (where our infrastructure providers Vercel, Stripe, and GitHub operate). These transfers are
              necessary to provide the Service. We rely on our providers&apos; compliance frameworks
              (including SOC 2, PCI-DSS) to ensure adequate data protection.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Children&apos;s Privacy</h2>
            <p>
              The Service is not directed at individuals under the age of 16. We do not knowingly collect
              personal data from children. If we become aware that we have collected data from a child
              under 16, we will delete it immediately.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Third-Party Services</h2>
            <p>We use the following third-party services to operate GateTest:</p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>
                <strong>Stripe, Inc.</strong> — Payment processing.
                <a href="https://stripe.com/privacy" className="text-accent-light hover:underline ml-1" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              </li>
              <li>
                <strong>GitHub, Inc. (Microsoft)</strong> — Repository access, GitHub App, webhooks.
                <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" className="text-accent-light hover:underline ml-1" target="_blank" rel="noopener noreferrer">Privacy Statement</a>
              </li>
              <li>
                <strong>Anthropic, PBC</strong> — AI code review processing.
                <a href="https://www.anthropic.com/privacy" className="text-accent-light hover:underline ml-1" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              </li>
              <li>
                <strong>Vercel, Inc.</strong> — Website and API hosting.
                <a href="https://vercel.com/legal/privacy-policy" className="text-accent-light hover:underline ml-1" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              </li>
            </ul>
            <p className="mt-2">
              We do not share your data with any other third parties. The above services receive only
              the minimum data necessary to perform their function.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Data Breach Notification</h2>
            <p>
              In the unlikely event of a data breach affecting your personal data, we will notify
              affected users via email within 72 hours of becoming aware of the breach, as required
              by the New Zealand Privacy Act 2020. We will also notify the Office of the Privacy
              Commissioner where required.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. International Data Protection</h2>
            <p>
              <strong>13.1 European Economic Area (GDPR).</strong> If you are located in the EEA, UK,
              or Switzerland, we process your personal data on the following legal bases: (a) performance
              of a contract (to provide the Service you purchased); (b) legitimate interest (to improve
              the Service and prevent fraud); (c) consent (where you have given it, which you may withdraw
              at any time). Your data may be transferred to New Zealand and the United States (where our
              infrastructure providers operate). We rely on standard contractual clauses and provider
              certifications (SOC 2 Type II) as transfer safeguards.
            </p>
            <p className="mt-2">
              <strong>13.2 GDPR rights.</strong> In addition to the rights listed in section 8 above,
              EEA/UK data subjects have the right to: lodge a complaint with your local supervisory
              authority; object to processing based on legitimate interest; and not be subject to
              automated decision-making with legal effects (our scans are informational tools, not
              automated decisions with legal effect).
            </p>
            <p className="mt-2">
              <strong>13.3 California (CCPA/CPRA).</strong> If you are a California resident, you have the
              right to: know what personal information we collect and why; request deletion of your personal
              information; opt-out of the sale of personal information (we do not sell personal information);
              and non-discrimination for exercising your rights. To exercise these rights, email
              hello@gatetest.io with the subject &quot;CCPA Request&quot;.
            </p>
            <p className="mt-2">
              <strong>13.4 Data Processing Agreement.</strong> Enterprise customers who require a formal
              Data Processing Agreement (DPA) may request one by contacting hello@gatetest.io.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">14. Data Security</h2>
            <p>
              All data in transit is encrypted using TLS 1.2 or higher. Scan reports stored in our
              database are encrypted at rest. Payment information is handled exclusively by Stripe and
              never touches our servers. Source code is processed in-memory and is not written to
              persistent storage. We conduct periodic security reviews of our infrastructure and
              follow the principle of least privilege for all system access.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">15. Governing Law</h2>
            <p>
              This Privacy Policy is governed by the laws of New Zealand, including the Privacy Act 2020.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">16. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Material changes will be communicated via email
              or prominent notice on our website at least 14 days before taking effect. The &quot;Effective
              date&quot; at the top of this page indicates the latest revision.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">17. Contact</h2>
            <p>
              For privacy questions, data requests, or concerns, contact us at{" "}
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
