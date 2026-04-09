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
        <p className="text-sm text-muted mb-8">Effective date: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Agreement to Terms</h2>
            <p>
              By accessing or using GateTest (&quot;Service&quot;), including the website at gatetest.io,
              the GateTest GitHub App, the GateTest CLI tool, and any associated APIs, you
              (&quot;Customer&quot;, &quot;you&quot;, &quot;your&quot;) agree to be bound by these Terms
              of Service (&quot;Terms&quot;). If you do not agree to these Terms, do not use the Service.
            </p>
            <p className="mt-2">
              If you are using the Service on behalf of an organisation, you represent and warrant that
              you have authority to bind that organisation to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Service Description</h2>
            <p>
              GateTest provides automated code quality scanning and analysis for software repositories.
              The Service includes static code analysis, security pattern detection, accessibility checking,
              performance analysis, and related quality assurance tools. The Service is an automated tool
              and does not constitute professional consulting, security auditing, legal compliance
              certification, or any form of professional advice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Payment Terms</h2>
            <p>
              <strong>3.1 Hold-then-charge model.</strong> When you purchase a scan, a hold (authorisation)
              is placed on your payment method for the full scan amount. The charge is captured only after
              the scan completes and results are delivered. If the scan cannot be completed due to access
              failure, service outage, or technical error on our part, the hold is released and no charge
              is made.
            </p>
            <p className="mt-2">
              <strong>3.2 Currency and processing.</strong> All prices are in US Dollars (USD). Payments
              are processed by Stripe, Inc. We do not store, process, or have access to your full credit
              card number. By providing payment information, you represent that you are authorised to use
              the payment method provided.
            </p>
            <p className="mt-2">
              <strong>3.3 Price changes.</strong> We reserve the right to change pricing at any time.
              Price changes do not affect scans already purchased. Current pricing is displayed on our
              website at the time of purchase and constitutes the binding price for that transaction.
            </p>
            <p className="mt-2">
              <strong>3.4 Taxes.</strong> Prices are exclusive of applicable taxes. You are responsible for
              any sales tax, VAT, GST, or similar taxes applicable in your jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Repository Access and Authorisation</h2>
            <p>
              <strong>4.1 Grant of access.</strong> To perform a scan, you grant GateTest temporary,
              limited, read-only access to the specified repository solely for the purpose of performing
              the requested quality analysis. This access terminates immediately upon scan completion.
            </p>
            <p className="mt-2">
              <strong>4.2 Auto-fix access.</strong> For tiers that include auto-fix functionality, you
              additionally grant GateTest permission to create branches and submit pull requests to the
              specified repository. GateTest will never merge pull requests automatically — all merges
              require your explicit approval.
            </p>
            <p className="mt-2">
              <strong>4.3 Authorisation warranty.</strong> You represent and warrant that (a) you own the
              repository or have explicit authorisation from the owner to scan it, (b) scanning the
              repository does not violate any agreement, law, or third-party right, and (c) the repository
              does not contain content that is illegal in your jurisdiction. You agree to indemnify and
              hold harmless GateTest from any claims arising from your breach of this warranty.
            </p>
            <p className="mt-2">
              <strong>4.4 Prohibited use.</strong> You may not use the Service to scan repositories you
              do not own or have permission to scan. You may not use the Service to identify vulnerabilities
              in code for the purpose of exploiting them. You may not use the Service in any manner that
              violates applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Intellectual Property</h2>
            <p>
              <strong>5.1 Your code.</strong> You retain all ownership and intellectual property rights
              in your source code. GateTest does not claim any ownership of your code. We do not use your
              code for any purpose other than performing the requested scan.
            </p>
            <p className="mt-2">
              <strong>5.2 Scan reports.</strong> Scan reports generated by GateTest are licensed to you
              for your internal use. You may share reports within your organisation. You may not resell
              GateTest reports as a standalone service.
            </p>
            <p className="mt-2">
              <strong>5.3 Our Service.</strong> GateTest, its modules, algorithms, reports, website,
              and all associated intellectual property are owned by GateTest and its operators. These
              Terms do not grant you any rights to our intellectual property beyond the limited right
              to use the Service as described.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Disclaimer of Warranties</h2>
            <p>
              <strong>THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
              WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING
              WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              TITLE, AND NON-INFRINGEMENT.</strong>
            </p>
            <p className="mt-2">
              <strong>6.1</strong> GateTest is an automated scanning tool. A passing scan result
              <strong> DOES NOT constitute a guarantee, warranty, certification, or representation
              that your code is free of bugs, security vulnerabilities, compliance issues, or
              defects of any kind.</strong>
            </p>
            <p className="mt-2">
              <strong>6.2</strong> GateTest does not guarantee that it will detect all issues in
              your code. No automated tool can identify every possible defect. The Service is a
              supplement to — not a replacement for — professional code review, manual testing,
              security audits, penetration testing, and compliance assessments.
            </p>
            <p className="mt-2">
              <strong>6.3</strong> We do not warrant that the Service will be uninterrupted,
              timely, secure, or error-free, or that defects will be corrected.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Auto-Fix Disclaimer</h2>
            <p>
              For tiers that include auto-fix functionality, GateTest generates automated code
              modifications and submits them as pull requests. <strong>YOU ARE SOLELY RESPONSIBLE
              FOR REVIEWING, TESTING, AND APPROVING ALL AUTO-FIX CHANGES BEFORE MERGING THEM INTO
              YOUR CODEBASE.</strong> GateTest does not guarantee that auto-fix changes are correct,
              complete, free of side effects, or suitable for your use case. Auto-fix changes may
              introduce new bugs, break existing functionality, or cause data loss. By using auto-fix,
              you accept full responsibility for any consequences of merging auto-generated code changes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. AI Code Review Disclaimer</h2>
            <p>
              The AI-powered code review module uses third-party AI services (Anthropic Claude) to
              analyse code. AI analysis is probabilistic in nature and may produce false positives
              (flagging non-issues), false negatives (missing real issues), or incorrect suggestions.
              AI review results should be treated as suggestions requiring human verification, not as
              definitive assessments. GateTest is not responsible for any actions taken based on AI
              review output.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Limitation of Liability</h2>
            <p>
              <strong>9.1</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT
              SHALL GATETEST, ITS OPERATORS, DIRECTORS, EMPLOYEES, AGENTS, OR AFFILIATES BE LIABLE
              FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES,
              INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, REVENUE, DATA, BUSINESS OPPORTUNITIES,
              GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING FROM OR RELATED TO YOUR USE OF OR
              INABILITY TO USE THE SERVICE, REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, TORT,
              STRICT LIABILITY, OR OTHERWISE) AND EVEN IF GATETEST HAS BEEN ADVISED OF THE POSSIBILITY
              OF SUCH DAMAGES.
            </p>
            <p className="mt-2">
              <strong>9.2</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, GATETEST&apos;S
              TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING FROM OR RELATED TO THE SERVICE SHALL
              NOT EXCEED THE AMOUNT YOU ACTUALLY PAID TO GATETEST FOR THE SPECIFIC SCAN OR SERVICE
              GIVING RISE TO THE CLAIM IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
            <p className="mt-2">
              <strong>9.3</strong> Without limiting the above, GateTest shall have no liability for:
              (a) any bugs, security breaches, data loss, downtime, or damages occurring in code that
              has been scanned by GateTest, whether the scan passed or failed; (b) any consequences of
              merging auto-fix pull requests; (c) any actions taken or not taken based on scan results
              or AI review output; (d) any third-party claims related to your code or repositories.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless GateTest and its operators from and
              against any and all claims, damages, losses, liabilities, costs, and expenses (including
              reasonable legal fees) arising from or related to: (a) your use of the Service;
              (b) your breach of these Terms; (c) your violation of any law or third-party right;
              (d) any repository content you submit for scanning; (e) any dispute between you and a
              third party related to code scanned by GateTest.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>Use the Service to scan repositories without proper authorisation</li>
              <li>Use the Service for competitive intelligence gathering against GateTest</li>
              <li>Attempt to reverse-engineer, decompile, or extract the scanning algorithms</li>
              <li>Interfere with or disrupt the Service or its infrastructure</li>
              <li>Use the Service to identify vulnerabilities for malicious exploitation</li>
              <li>Submit repositories containing malware designed to attack our scanning infrastructure</li>
              <li>Exceed reasonable usage limits or abuse the Service in a manner that degrades it for others</li>
              <li>Resell, sublicense, or redistribute the Service without written permission</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">12. Termination</h2>
            <p>
              <strong>12.1</strong> We may suspend or terminate your access to the Service at any time,
              with or without cause, with or without notice. Grounds for termination include but are not
              limited to violation of these Terms, abusive behaviour, fraudulent payment activity, or
              actions that harm the Service or its users.
            </p>
            <p className="mt-2">
              <strong>12.2</strong> Upon termination, your right to use the Service ceases immediately.
              Sections 5 (Intellectual Property), 6 (Disclaimers), 7 (Auto-Fix Disclaimer), 8 (AI Disclaimer),
              9 (Limitation of Liability), 10 (Indemnification), and 13 (Governing Law) survive termination.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">13. Governing Law and Disputes</h2>
            <p>
              <strong>13.1</strong> These Terms are governed by and construed in accordance with the
              laws of New Zealand, without regard to conflict of law principles.
            </p>
            <p className="mt-2">
              <strong>13.2</strong> Any dispute arising from or relating to these Terms or the Service
              shall be resolved exclusively in the courts of New Zealand, and you consent to the personal
              jurisdiction of such courts.
            </p>
            <p className="mt-2">
              <strong>13.3</strong> Nothing in these Terms excludes or limits any consumer rights that
              cannot be excluded or limited under New Zealand law, including the Consumer Guarantees Act
              1993 where applicable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">14. GitHub App</h2>
            <p>
              Installation of the GateTest GitHub App constitutes acceptance of these Terms. The App
              receives webhook events (push, pull request) and reads repository contents solely for
              automated scanning. You can revoke access at any time by uninstalling the App from your
              GitHub account or organisation settings. Uninstallation terminates our access immediately.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">15. Free CLI Tool</h2>
            <p>
              The GateTest CLI tool is provided free of charge under the MIT License and is provided
              &quot;AS IS&quot; without warranty of any kind, express or implied. The full MIT License
              terms apply. Use of the CLI tool is entirely at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">16. Severability</h2>
            <p>
              If any provision of these Terms is found to be unenforceable or invalid by a court of
              competent jurisdiction, that provision shall be limited or eliminated to the minimum extent
              necessary, and the remaining provisions shall continue in full force and effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">17. Entire Agreement</h2>
            <p>
              These Terms, together with the Privacy Policy and Refund Policy, constitute the entire
              agreement between you and GateTest regarding the Service and supersede all prior agreements,
              communications, and understandings.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">18. Modifications</h2>
            <p>
              We reserve the right to modify these Terms at any time. Material changes will be
              communicated via email or prominent notice on our website at least 14 days before
              taking effect. Continued use of the Service after the effective date of changes
              constitutes acceptance of the modified Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">19. Contact</h2>
            <p>
              For questions about these Terms, contact us at{" "}
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
