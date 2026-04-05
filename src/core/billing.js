/**
 * GateTest Billing — Stripe Integration
 *
 * Handles:
 *   - Checkout session creation (subscribe to Pro/Team)
 *   - Webhook processing (payment success, subscription changes)
 *   - Customer portal for self-service billing management
 *   - Usage-based metering (scans per month)
 *   - Plan upgrades/downgrades
 *
 * Env vars:
 *   STRIPE_SECRET_KEY       — Stripe API secret key
 *   STRIPE_WEBHOOK_SECRET   — Webhook signing secret
 *   STRIPE_PRICE_PRO        — Price ID for Pro plan
 *   STRIPE_PRICE_TEAM       — Price ID for Team plan
 *   GATETEST_APP_URL        — Base URL for redirects (e.g. https://gatetest.io)
 *
 * This module uses Stripe's HTTPS API directly — zero dependencies.
 */

const https = require('https');
const crypto = require('crypto');

// ─── Plan Config ───────────────────────────────────────────

const PLANS = {
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRICE_PRO || null,
    scansPerMonth: 500,
    features: ['All modules', 'Session ledger', 'Live crawler', 'Continuous scan'],
  },
  team: {
    name: 'Team',
    priceId: process.env.STRIPE_PRICE_TEAM || null,
    scansPerMonth: 2000,
    features: ['Everything in Pro', 'Team management', 'API access', 'Priority support'],
  },
};

// ─── Stripe Billing Manager ────────────────────────────────

class BillingManager {
  constructor(options = {}) {
    this.secretKey = options.secretKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    this.appUrl = options.appUrl || process.env.GATETEST_APP_URL || 'https://gatetest.io';

    if (!this.secretKey) {
      this.enabled = false;
      return;
    }
    this.enabled = true;
  }

  /**
   * Create a Stripe Checkout session for subscribing to a plan.
   * Returns { url, sessionId } — redirect the user to url.
   */
  async createCheckoutSession(plan, customerEmail, metadata = {}) {
    if (!this.enabled) throw new Error('Billing not configured (STRIPE_SECRET_KEY missing)');

    const planConfig = PLANS[plan];
    if (!planConfig || !planConfig.priceId) {
      throw new Error(`Invalid plan "${plan}" or price not configured`);
    }

    const params = {
      mode: 'subscription',
      'line_items[0][price]': planConfig.priceId,
      'line_items[0][quantity]': '1',
      success_url: `${this.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.appUrl}/billing/cancel`,
      customer_email: customerEmail,
      'metadata[plan]': plan,
      'metadata[source]': 'gatetest-cli',
    };

    // Attach any extra metadata
    for (const [key, value] of Object.entries(metadata)) {
      params[`metadata[${key}]`] = String(value);
    }

    const session = await this._stripeRequest('POST', '/v1/checkout/sessions', params);

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  /**
   * Create a customer portal session for managing billing.
   * Returns { url } — redirect the user to url.
   */
  async createPortalSession(stripeCustomerId) {
    if (!this.enabled) throw new Error('Billing not configured');

    const session = await this._stripeRequest('POST', '/v1/billing_portal/sessions', {
      customer: stripeCustomerId,
      return_url: `${this.appUrl}/account`,
    });

    return { url: session.url };
  }

  /**
   * Get subscription details for a customer.
   */
  async getSubscription(subscriptionId) {
    if (!this.enabled) throw new Error('Billing not configured');
    return this._stripeRequest('GET', `/v1/subscriptions/${subscriptionId}`);
  }

  /**
   * Cancel a subscription (at period end).
   */
  async cancelSubscription(subscriptionId) {
    if (!this.enabled) throw new Error('Billing not configured');
    return this._stripeRequest('POST', `/v1/subscriptions/${subscriptionId}`, {
      cancel_at_period_end: 'true',
    });
  }

  /**
   * Report usage for metered billing (scans consumed).
   */
  async reportUsage(subscriptionItemId, quantity, timestamp) {
    if (!this.enabled) throw new Error('Billing not configured');
    return this._stripeRequest('POST', '/v1/subscription_items/' + subscriptionItemId + '/usage_records', {
      quantity: String(quantity),
      timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
      action: 'increment',
    });
  }

  /**
   * Get customer by email (for linking accounts).
   */
  async findCustomerByEmail(email) {
    if (!this.enabled) throw new Error('Billing not configured');
    const result = await this._stripeRequest('GET', `/v1/customers?email=${encodeURIComponent(email)}&limit=1`);
    return result.data?.[0] || null;
  }

  /**
   * Create a new Stripe customer.
   */
  async createCustomer(email, name, metadata = {}) {
    if (!this.enabled) throw new Error('Billing not configured');

    const params = { email, name };
    for (const [key, value] of Object.entries(metadata)) {
      params[`metadata[${key}]`] = String(value);
    }

    return this._stripeRequest('POST', '/v1/customers', params);
  }

  // ─── Webhook Processing ──────────────────────────────────

  /**
   * Verify and parse a Stripe webhook event.
   * Returns the event object or throws on invalid signature.
   */
  verifyWebhook(rawBody, signatureHeader) {
    if (!this.webhookSecret) {
      throw new Error('Webhook secret not configured (STRIPE_WEBHOOK_SECRET)');
    }

    const elements = signatureHeader.split(',');
    let timestamp = null;
    let signature = null;

    for (const el of elements) {
      const [key, value] = el.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') signature = value;
    }

    if (!timestamp || !signature) {
      throw new Error('Invalid Stripe signature header');
    }

    // Reject events older than 5 minutes (replay protection)
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
    if (age > 300) {
      throw new Error('Webhook timestamp too old (possible replay)');
    }

    const expectedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('Invalid webhook signature');
    }

    return JSON.parse(rawBody);
  }

  /**
   * Process a verified webhook event.
   * Returns { action, data } describing what happened.
   */
  processWebhookEvent(event) {
    const type = event.type;
    const obj = event.data?.object;

    switch (type) {
      case 'checkout.session.completed':
        return {
          action: 'subscription_created',
          data: {
            customerId: obj.customer,
            subscriptionId: obj.subscription,
            email: obj.customer_email || obj.customer_details?.email,
            plan: obj.metadata?.plan,
          },
        };

      case 'customer.subscription.updated':
        return {
          action: 'subscription_updated',
          data: {
            customerId: obj.customer,
            subscriptionId: obj.id,
            status: obj.status,
            cancelAtPeriodEnd: obj.cancel_at_period_end,
            currentPeriodEnd: obj.current_period_end,
          },
        };

      case 'customer.subscription.deleted':
        return {
          action: 'subscription_cancelled',
          data: {
            customerId: obj.customer,
            subscriptionId: obj.id,
          },
        };

      case 'invoice.payment_succeeded':
        return {
          action: 'payment_succeeded',
          data: {
            customerId: obj.customer,
            subscriptionId: obj.subscription,
            amountPaid: obj.amount_paid,
            currency: obj.currency,
          },
        };

      case 'invoice.payment_failed':
        return {
          action: 'payment_failed',
          data: {
            customerId: obj.customer,
            subscriptionId: obj.subscription,
            attemptCount: obj.attempt_count,
          },
        };

      default:
        return { action: 'unknown', data: { type, id: obj?.id } };
    }
  }

  // ─── Internal ────────────────────────────────────────────

  _stripeRequest(method, urlPath, params = null) {
    return new Promise((resolve, reject) => {
      let body = null;
      if (params && method === 'POST') {
        body = Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');
      }

      // For GET with query params already in urlPath, just use it
      const options = {
        hostname: 'api.stripe.com',
        path: urlPath,
        method,
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'User-Agent': 'GateTest/1.0.0',
        },
      };

      if (body) {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.headers['Content-Length'] = Buffer.byteLength(body);
      }

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = JSON.parse(raw);
            if (parsed.error) {
              reject(new Error(`Stripe error: ${parsed.error.message} (${parsed.error.type})`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Invalid Stripe response: ${raw.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Stripe request timeout'));
      });

      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = { BillingManager, PLANS };
