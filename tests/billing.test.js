const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { BillingManager, PLANS } = require('../src/core/billing');

describe('PLANS', () => {
  it('should define pro and team plans', () => {
    assert.ok(PLANS.pro);
    assert.ok(PLANS.team);
    assert.strictEqual(PLANS.pro.scansPerMonth, 500);
    assert.strictEqual(PLANS.team.scansPerMonth, 2000);
  });

  it('should list features for each plan', () => {
    assert.ok(PLANS.pro.features.length > 0);
    assert.ok(PLANS.team.features.length > 0);
    assert.ok(PLANS.team.features.includes('Everything in Pro'));
  });
});

describe('BillingManager', () => {
  it('should be disabled without secret key', () => {
    const billing = new BillingManager({ secretKey: null });
    assert.strictEqual(billing.enabled, false);
  });

  it('should be enabled with secret key', () => {
    const billing = new BillingManager({ secretKey: 'sk_test_fake123' });
    assert.strictEqual(billing.enabled, true);
  });

  it('should throw on checkout without billing enabled', async () => {
    const billing = new BillingManager({ secretKey: null });
    await assert.rejects(
      () => billing.createCheckoutSession('pro', 'test@test.com'),
      /Billing not configured/
    );
  });

  it('should throw on invalid plan', async () => {
    const billing = new BillingManager({ secretKey: 'sk_test_fake' });
    await assert.rejects(
      () => billing.createCheckoutSession('invalid_plan', 'test@test.com'),
      /Invalid plan/
    );
  });

  it('should throw on portal without billing enabled', async () => {
    const billing = new BillingManager({ secretKey: null });
    await assert.rejects(
      () => billing.createPortalSession('cus_123'),
      /Billing not configured/
    );
  });

  it('should throw on subscription ops without billing', async () => {
    const billing = new BillingManager({ secretKey: null });
    await assert.rejects(() => billing.getSubscription('sub_123'), /Billing not configured/);
    await assert.rejects(() => billing.cancelSubscription('sub_123'), /Billing not configured/);
    await assert.rejects(() => billing.reportUsage('si_123', 5), /Billing not configured/);
    await assert.rejects(() => billing.findCustomerByEmail('a@b.com'), /Billing not configured/);
    await assert.rejects(() => billing.createCustomer('a@b.com', 'Test'), /Billing not configured/);
  });

  describe('webhook verification', () => {
    const secret = 'whsec_test_secret_123';

    it('should throw without webhook secret', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x', webhookSecret: null });
      assert.throws(
        () => billing.verifyWebhook('{}', 't=123,v1=abc'),
        /Webhook secret not configured/
      );
    });

    it('should reject invalid signature', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x', webhookSecret: secret });
      const timestamp = Math.floor(Date.now() / 1000);
      assert.throws(
        () => billing.verifyWebhook('{"id":"evt_1"}', `t=${timestamp},v1=invalidsig`),
        /Invalid webhook signature/
      );
    });

    it('should reject old timestamps (replay protection)', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x', webhookSecret: secret });
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago
      const body = '{"id":"evt_1"}';
      const sig = crypto.createHmac('sha256', secret).update(`${oldTimestamp}.${body}`).digest('hex');

      assert.throws(
        () => billing.verifyWebhook(body, `t=${oldTimestamp},v1=${sig}`),
        /timestamp too old/
      );
    });

    it('should accept valid signature', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x', webhookSecret: secret });
      const timestamp = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
      const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

      const event = billing.verifyWebhook(body, `t=${timestamp},v1=${sig}`);
      assert.strictEqual(event.id, 'evt_1');
    });

    it('should reject missing signature parts', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x', webhookSecret: secret });
      assert.throws(
        () => billing.verifyWebhook('{}', 'garbage'),
        /Invalid Stripe signature/
      );
    });
  });

  describe('webhook event processing', () => {
    it('should handle checkout.session.completed', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_123',
            subscription: 'sub_456',
            customer_email: 'test@test.com',
            metadata: { plan: 'pro' },
          },
        },
      });

      assert.strictEqual(result.action, 'subscription_created');
      assert.strictEqual(result.data.customerId, 'cus_123');
      assert.strictEqual(result.data.email, 'test@test.com');
      assert.strictEqual(result.data.plan, 'pro');
    });

    it('should handle subscription updated', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_456',
            customer: 'cus_123',
            status: 'active',
            cancel_at_period_end: false,
            current_period_end: 1700000000,
          },
        },
      });

      assert.strictEqual(result.action, 'subscription_updated');
      assert.strictEqual(result.data.status, 'active');
      assert.strictEqual(result.data.cancelAtPeriodEnd, false);
    });

    it('should handle subscription deleted', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_456', customer: 'cus_123' } },
      });

      assert.strictEqual(result.action, 'subscription_cancelled');
      assert.strictEqual(result.data.subscriptionId, 'sub_456');
    });

    it('should handle payment succeeded', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            customer: 'cus_123',
            subscription: 'sub_456',
            amount_paid: 2900,
            currency: 'usd',
          },
        },
      });

      assert.strictEqual(result.action, 'payment_succeeded');
      assert.strictEqual(result.data.amountPaid, 2900);
      assert.strictEqual(result.data.currency, 'usd');
    });

    it('should handle payment failed', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_123',
            subscription: 'sub_456',
            attempt_count: 2,
          },
        },
      });

      assert.strictEqual(result.action, 'payment_failed');
      assert.strictEqual(result.data.attemptCount, 2);
    });

    it('should handle unknown events gracefully', () => {
      const billing = new BillingManager({ secretKey: 'sk_test_x' });
      const result = billing.processWebhookEvent({
        type: 'some.unknown.event',
        data: { object: { id: 'obj_789' } },
      });

      assert.strictEqual(result.action, 'unknown');
      assert.strictEqual(result.data.type, 'some.unknown.event');
    });
  });
});
