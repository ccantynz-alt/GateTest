/**
 * Stripe Webhook Handler — Acknowledges Stripe in <5s, runs scan async.
 *
 * ARCHITECTURE (decoupled — fixes the 60s-timeout double-charge bug):
 * - Webhook receives checkout.session.completed
 * - Verifies signature
 * - Stamps the payment intent with a scan_job_id (Stripe metadata acts as
 *   the idempotency lock)
 * - Schedules the scan via `after()` so the response returns immediately
 * - Returns 200 to Stripe within milliseconds
 * - Background job captures or cancels the payment intent when the scan
 *   finishes. The capture/cancel step is idempotent — if Stripe retries
 *   the webhook (e.g. cold start dropped our response), the second run
 *   sees the stamped scan_job_id and bails out, so the customer is never
 *   double-charged.
 *
 * Prior behavior: scan ran inline, Vercel killed the function at 60s, Stripe
 * retried, second invocation double-captured.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "crypto";
import https from "https";
import { runScanJob } from "../../lib/scan-executor";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

function verifyStripeSignature(payload: string, sigHeader: string): boolean {
  if (!STRIPE_WEBHOOK_SECRET) return true;

  const parts = sigHeader.split(",").reduce(
    (acc, part) => {
      const [key, val] = part.split("=");
      if (key === "t") acc.timestamp = val;
      if (key === "v1") acc.signatures.push(val);
      return acc;
    },
    { timestamp: "", signatures: [] as string[] }
  );

  const signedPayload = `${parts.timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  return parts.signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

function stripeApi(
  method: string,
  path: string,
  body?: string
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.stripe.com",
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };
    if (body) {
      options.headers = {
        ...options.headers,
        "Content-Length": String(Buffer.byteLength(body)),
      };
    }
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Stripe request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Derive a stable idempotency key from the checkout session id. Same session
 * id → same job id, regardless of how many times Stripe retries the webhook.
 */
function deriveJobId(sessionId: string): string {
  return crypto
    .createHash("sha256")
    .update(`gatetest-scan:${sessionId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  if (!verifyStripeSignature(body, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = (event.data?.object || {}) as Record<string, unknown>;
  const sessionId = typeof session.id === "string" ? session.id : "";
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : "";
  const sessionMetadata =
    (session.metadata as Record<string, string> | undefined) || {};

  let tier = sessionMetadata.tier || "";
  let repoUrl = sessionMetadata.repo_url || "";

  // Fallback to payment intent metadata if the checkout session didn't have it.
  if ((!tier || !repoUrl) && paymentIntentId && STRIPE_SECRET_KEY) {
    try {
      const pi = await stripeApi(
        "GET",
        `/v1/payment_intents/${paymentIntentId}`
      );
      const piMeta = (pi.metadata || {}) as Record<string, string>;
      tier = tier || piMeta.tier || "";
      repoUrl = repoUrl || piMeta.repo_url || "";
    } catch (err) {
      console.error("[GateTest] PI metadata lookup failed:", err);
    }
  }

  if (!tier || !repoUrl || !paymentIntentId || !sessionId) {
    // Ack anyway so Stripe doesn't retry — missing metadata is not a
    // transient failure we can recover from.
    console.error("[GateTest] Missing scan metadata on webhook", {
      sessionId,
      paymentIntentId,
      tier,
      repoUrl,
    });
    return NextResponse.json({ received: true, note: "missing_metadata" });
  }

  const jobId = deriveJobId(sessionId);

  // Schedule the scan to run AFTER the response is sent. Vercel keeps the
  // invocation alive via waitUntil for up to the function's maxDuration, but
  // Stripe already has its 200 response so it won't retry.
  after(async () => {
    try {
      const outcome = await runScanJob({
        jobId,
        paymentIntentId,
        repoUrl,
        tier,
      });
      if (outcome.skipped) {
        console.log(
          `[GateTest] Scan job ${jobId} skipped: ${outcome.reason}`
        );
      } else {
        console.log(
          `[GateTest] Scan job ${jobId} finished: ${outcome.result?.status}`
        );
      }
    } catch (err) {
      // Green ecosystem mandate: never leave a capture hanging. If the
      // whole scan job throws, cancel the payment intent so the customer
      // is not charged for a scan they never got.
      console.error("[GateTest] Scan job crashed:", err);
      try {
        await stripeApi(
          "POST",
          `/v1/payment_intents/${paymentIntentId}/cancel`
        );
      } catch (cancelErr) {
        console.error("[GateTest] Fallback cancel failed:", cancelErr);
      }
    }
  });

  return NextResponse.json({ received: true, jobId });
}
