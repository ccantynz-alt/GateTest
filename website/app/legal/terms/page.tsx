import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — GateTest",
  description: "GateTest terms of service.",
};

export default function Terms() {
  return (
    <div className="min-h-screen grid-bg px-6 py-24">
      <div className="max-w-3xl mx-auto prose-invert">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted mb-8">Last updated: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Service Description</h2>
            <p>
              GateTest (&quot;Service&quot;, &quot;we&quot;, &quot;us&quot;) provides automated code quality
              scanning and analysis for software repositories. Our Service includes static code analysis,
              security scanning, accessibility checking, performance analysis, and related quality assurance
              tools delivered via our website (gatetest.io), GitHub App, and command-line interface.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Payment Terms</h2>
            <p>
              <strong>Hold-then-charge model:</strong> When you purchase a scan, a hold is placed on your
              payment method for the scan amount. The charge is only captured after the scan completes
              successfully and results are delivered. If the scan cannot be completed for any reason
              (access failure, service outage, technical error), the hold is released and no charge is made.
            </p>
            <p className="mt-2">
              All prices are listed in US Dollars (USD). Payments are processed securely by Stripe.
              We do not store your credit card information on our servers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Scan Tiers</h2>
            <p>
              We offer multiple scan tiers at different price points. Each tier specifies which modules
              are included. The scope of each scan is as described on our pricing page at the time of
              purchase. We reserve the right to update pricing for future scans, but any scan already
              purchased will be honoured at the price paid.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Repository Access</h2>
            <p>
              To perform a scan, you grant GateTest temporary read access to the specified repository.
              We access your code solely for the purpose of running quality analysis. We do not modify
              your repository unless you have purchased a tier that includes auto-fix, in which case
              changes are submitted as a pull request for your review — never merged automatically.
            </p>
            <p className="mt-2">
              You represent that you have the authority to grant access to the repository being scanned.
              Do not submit repositories you do not own or have permission to scan.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Data Handling</h2>
            <p>
              Your source code is accessed in memory during the scan and is not permanently stored on
              our servers. Scan results (reports, check outcomes, issue lists) are retained for delivery
              and for your future reference. We do not sell, share, or use your code for any purpose
              other than performing the requested scan. See our Privacy Policy for full details.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. No Guarantee of Bug-Free Code</h2>
            <p>
              GateTest is an automated analysis tool. While we strive to identify as many issues as
              possible, <strong>a passing scan does not guarantee that your code is free of bugs,
              vulnerabilities, or defects.</strong> GateTest is a supplement to — not a replacement
              for — professional code review, security audits, and manual testing.
            </p>
            <p className="mt-2">
              We are not liable for any bugs, security breaches, data loss, or damages that occur in
              code that has been scanned by GateTest, whether the scan passed or failed.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Auto-Fix Disclaimer</h2>
            <p>
              For tiers that include auto-fix, GateTest generates code modifications and submits them
              as pull requests. <strong>You are responsible for reviewing and approving all auto-fix
              changes before merging.</strong> We do not guarantee that auto-fix changes are correct,
              complete, or free of side effects. Always review auto-generated code changes carefully.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. AI Code Review Disclaimer</h2>
            <p>
              Our AI-powered code review module uses third-party AI services to analyse code. AI analysis
              is probabilistic and may produce false positives or miss real issues. AI review results
              should be treated as suggestions, not definitive assessments.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, GateTest and its operators shall not be liable for
              any indirect, incidental, special, consequential, or punitive damages, including but not
              limited to loss of profits, data, or business opportunities, arising from your use of
              the Service.
            </p>
            <p className="mt-2">
              Our total liability for any claim arising from the Service shall not exceed the amount
              you paid for the specific scan giving rise to the claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. GitHub App</h2>
            <p>
              If you install the GateTest GitHub App, you grant us permission to receive webhook events
              (push, pull request) and to read repository contents for the purpose of automated scanning.
              You can revoke access at any time by uninstalling the app from your GitHub settings.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Free CLI Tool</h2>
            <p>
              The GateTest CLI tool is provided free of charge under the MIT License. It is provided
              &quot;as is&quot; without warranty of any kind. Use at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Modifications</h2>
            <p>
              We may update these terms from time to time. Continued use of the Service after changes
              constitutes acceptance of the updated terms. Material changes will be communicated via
              email or notice on our website.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. Governing Law</h2>
            <p>
              These terms are governed by the laws of New Zealand. Any disputes shall be resolved
              in the courts of New Zealand.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">14. Contact</h2>
            <p>
              For questions about these terms, contact us at{" "}
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
