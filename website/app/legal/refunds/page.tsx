import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refund Policy — GateTest",
  description: "GateTest refund and cancellation policy.",
};

export default function Refunds() {
  return (
    <div className="min-h-screen grid-bg px-6 py-24">
      <div className="max-w-3xl mx-auto prose-invert">
        <h1 className="text-3xl font-bold mb-2">Refund Policy</h1>
        <p className="text-sm text-muted mb-8">Last updated: April 9, 2026</p>

        <div className="space-y-6 text-sm text-muted leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">How Our Payment Model Works</h2>
            <p>
              GateTest uses a <strong>hold-then-charge</strong> payment model. When you purchase a scan,
              your card is authorised (held) for the scan amount. The charge is only captured after the
              scan completes and results are delivered to you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Automatic Refund Scenarios</h2>
            <p>You are <strong>never charged</strong> if:</p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>The scan cannot access your repository (permissions, outage, network failure)</li>
              <li>The scan fails due to a GateTest technical error</li>
              <li>The scan does not complete within the expected timeframe</li>
            </ul>
            <p className="mt-2">
              In all of the above cases, the hold on your card is automatically released. You do not
              need to request a refund — it happens automatically. The hold typically drops off your
              statement within 3-7 business days depending on your bank.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">After Scan Delivery</h2>
            <p>
              Once a scan has been completed and the report delivered, the payment is captured and the
              service is considered fulfilled. Because our scans are digital services that are delivered
              instantly, we generally do not offer refunds after delivery.
            </p>
            <p className="mt-2">
              However, if you believe the scan results are materially incorrect or the service was not
              delivered as described, please contact us within 7 days of the scan at{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>{" "}
              and we will review your case. We want every customer to feel they received fair value.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Continuous Subscription</h2>
            <p>
              For the Continuous plan ($49/month), you may cancel at any time. Cancellation takes
              effect at the end of the current billing period. No refunds are issued for partial
              months, but you retain access until the end of the period you paid for.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Free CLI Tool</h2>
            <p>
              The GateTest CLI tool is free and open source. No payments are involved, and no refund
              policy applies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Disputes</h2>
            <p>
              If you have a billing concern, please contact us at{" "}
              <a href="mailto:hello@gatetest.io" className="text-accent-light hover:underline">
                hello@gatetest.io
              </a>{" "}
              before filing a dispute with your bank. We resolve most issues within 24 hours and want
              to work with you directly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Contact</h2>
            <p>
              For any billing or refund questions:{" "}
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
