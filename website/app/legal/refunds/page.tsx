import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy — GateTest",
  description: "GateTest refund and cancellation policy.",
};

export default function Refunds() {
  return (
    <div className="min-h-screen grid-bg px-6 py-24">
      <div className="max-w-3xl mx-auto prose-invert">
        <h1 className="text-3xl font-bold mb-2">Refund &amp; Cancellation Policy</h1>
        <p className="text-sm text-muted mb-8">Effective date: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Payment Model</h2>
            <p>
              GateTest uses a <strong>hold-then-charge</strong> payment model for per-scan purchases.
              When you initiate a scan, your payment method is authorised (held) for the scan amount.
              The charge is only captured — and you are only billed — after the scan successfully
              completes and results are delivered to you. This model is designed to ensure you only
              pay for services that are actually delivered.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Automatic Release of Hold (No Charge)</h2>
            <p>Your card hold is <strong>automatically released</strong> and you are <strong>NOT charged</strong> in any of the following situations:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The scan cannot access your repository (permissions error, private repo without access, authentication failure)</li>
              <li>The scan fails due to a GateTest infrastructure or technical error</li>
              <li>GitHub is experiencing an outage that prevents repository access</li>
              <li>The scan does not complete within the expected timeframe</li>
              <li>Any other failure on our side that prevents delivery of scan results</li>
            </ul>
            <p className="mt-2">
              You do not need to request a release — it happens automatically. The hold typically
              drops from your statement within 3-7 business days, depending on your bank or card issuer.
              Some institutions may show the hold for up to 14 days before it clears.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. After Scan Delivery — Completed Scans</h2>
            <p>
              Once a scan has completed successfully and the report has been delivered, the payment
              is captured and the service is considered <strong>fulfilled</strong>. Because code scans
              are digital services that are delivered and consumed instantly, <strong>completed scans
              are generally non-refundable.</strong>
            </p>
            <p className="mt-2">
              The scan report, analysis results, and any auto-fix pull requests constitute the
              delivered service. Once you have received these deliverables, the transaction is complete.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Exceptions — When We Will Issue a Refund</h2>
            <p>
              We will issue a full refund for a completed scan if:
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The scan report was materially incomplete (e.g., major modules failed to run but were listed as included in your tier)</li>
              <li>You were charged a different amount than the price displayed at the time of purchase</li>
              <li>A duplicate charge occurred due to a technical error</li>
              <li>The auto-fix tier was purchased but no pull request was delivered</li>
            </ul>
            <p className="mt-2">
              Refund requests must be submitted within <strong>7 days</strong> of the scan delivery date
              to{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>{" "}
              with your scan ID or Stripe receipt. We will review and respond within 3 business days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. What Is NOT Grounds for a Refund</h2>
            <p>We do not issue refunds in the following situations:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>You disagree with the scan results or believe a finding is a false positive — scan results are automated analysis, not a guarantee (see Terms of Service, Section 6)</li>
              <li>The scan passed but bugs were later found in your code — a passing scan does not guarantee bug-free code</li>
              <li>You did not review auto-fix changes before merging and they caused issues — review responsibility is yours (see Terms of Service, Section 7)</li>
              <li>You purchased a higher tier than needed — you received the service described for that tier</li>
              <li>Your repository had no issues and the scan &quot;didn&apos;t find anything&quot; — a clean scan is a valid result</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Continuous Subscription</h2>
            <p>
              For the Continuous plan ($49/month):
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>You may cancel at any time through your account settings or by contacting us</li>
              <li>Cancellation takes effect at the end of the current billing period</li>
              <li>You retain access to the service until the end of the period you have paid for</li>
              <li>No refunds are issued for partial months or unused portions of a billing period</li>
              <li>No refunds are issued for prior billing periods</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Free CLI Tool</h2>
            <p>
              The GateTest CLI tool is free and open source under the MIT License. No payments are
              involved and no refund policy applies. The CLI is provided &quot;as is&quot; without
              warranty.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Chargebacks and Disputes</h2>
            <p>
              <strong>Please contact us before filing a chargeback or dispute with your bank.</strong> We
              resolve most billing issues within 24 hours at{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>.
            </p>
            <p className="mt-2">
              Filing a chargeback without first contacting us may result in suspension of your account
              and access to the Service. We will provide all relevant transaction evidence to your bank
              in the event of a dispute, including proof of service delivery.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. How Refunds Are Processed</h2>
            <p>
              Approved refunds are processed via Stripe to the original payment method. Refunds
              typically appear on your statement within 5-10 business days, depending on your bank.
              We will send email confirmation when a refund is initiated.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Contact</h2>
            <p>
              For billing questions, refund requests, or payment disputes:{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>
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
