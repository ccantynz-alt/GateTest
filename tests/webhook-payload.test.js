'use strict';

// webhookPayload — behavioural tests with positive AND negative controls.
// KI #106 (the Fifty, move 11): the module knew `app|router|fastify|server`
// `.post('/…webhook…')` and `req.body.x`. A Hono / Koa / Elysia handler, a
// NestJS `@Post('webhook')`, or a Next App Router `await req.json()` was
// never a webhook to it; and `includes('/hook')` read every React hooks/
// file as one handler body.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WebhookPayloadValidator = require('../src/modules/webhook-payload');

function makeResult() {
  const checks = [];
  return { checks, addCheck(name, passed, details) { checks.push({ name, passed, ...(details || {}) }); } };
}

describe('WebhookPayloadValidator', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-wh-pay-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const w = (rel, c) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  const run = async () => { const r = makeResult(); await new WebhookPayloadValidator().run(r, { projectRoot: tmp, getModuleConfig() { return {}; }, get() { return null; } }); return r.checks; };
  const unvalidated = (c) => c.filter((x) => !x.passed && x.name.startsWith('webhook-payload:unvalidated:')).map((x) => x.name);

  it('POSITIVE (unchanged): an Express webhook reading req.body with no validation is an error', async () => {
    w('src/server.js', "app.post('/webhook', (req, res) => {\n  const type = req.body.type;\n  res.sendStatus(200);\n});\n");
    const c = await run();
    assert.equal(unvalidated(c).length, 1, JSON.stringify(c.map((x) => x.name)));
    assert.equal(c.find((x) => x.name === unvalidated(c)[0]).severity, 'error');
  });

  it('a Hono handler (`hono.post`) and an `api.post` handler are webhooks too (was: no-webhooks)', async () => {
    w('src/hono.ts', "hono.post('/webhooks/stripe', async (c) => {\n  const evt = await c.req.json();\n  return c.text('ok');\n});\n");
    w('src/api.ts', "api.post('/callback/payment', (req, res) => {\n  const status = req.body.status;\n  res.end();\n});\n");
    const c = await run();
    const u = unvalidated(c);
    assert.ok(u.some((n) => n.includes('src/hono.ts')), u.join());
    assert.ok(u.some((n) => n.includes('src/api.ts')), u.join());
    assert.ok(!c.some((x) => x.name === 'webhook-payload:no-webhooks'));
  });

  it('NestJS: `@Post(\'webhook\')` with an untyped body is unvalidated; with a `@Body() dto: Dto` it is validated by the pipe', async () => {
    w('src/events.controller.ts', "@Controller('stripe')\nexport class StripeController {\n  @Post('webhook')\n  async handle(@Req() req) {\n    const type = req.body.type;\n    return { ok: true };\n  }\n}\n");
    let c = await run();
    assert.equal(unvalidated(c).length, 1, JSON.stringify(c.map((x) => x.name)));
    w('src/events.controller.ts', "@Controller('stripe')\nexport class StripeController {\n  @Post('webhook')\n  async handle(@Body() dto: StripeEventDto) {\n    const type = req.body.type;\n    return { ok: true };\n  }\n}\n");
    c = await run();
    assert.equal(unvalidated(c).length, 0, JSON.stringify(c.map((x) => x.name)));
  });

  it('Next App Router: `app/api/webhooks/route.ts` reading `await req.json()` unvalidated fires; `.safeParse(await req.json())` is quiet', async () => {
    w('app/api/webhooks/route.ts', "export async function POST(req: Request) {\n  const body = await req.json();\n  return Response.json({ ok: body.id });\n}\n");
    let c = await run();
    assert.equal(unvalidated(c).length, 1, JSON.stringify(c.map((x) => x.name)));
    w('app/api/webhooks/route.ts', "export async function POST(req: Request) {\n  const parsed = EventSchema.safeParse(await req.json());\n  if (!parsed.success) return new Response('bad', { status: 400 });\n  return Response.json({ ok: parsed.data.id });\n}\n");
    c = await run();
    assert.equal(unvalidated(c).length, 0, JSON.stringify(c.map((x) => x.name)));
  });

  it('Fastify: a route with `schema: { body: … }` is validated by the framework', async () => {
    w('src/routes.ts', "fastify.post('/hooks/github', { schema: { body: PushSchema } }, async (request) => {\n  return request.body.ref;\n});\n");
    assert.equal(unvalidated(await run()).length, 0);
  });

  it('NEGATIVE: a React hooks/ file is not a webhook handler body', async () => {
    w('src/hooks/useAuth.ts', "export function useAuth(req) {\n  const user = req.body.user;\n  return user;\n}\n");
    const c = await run();
    assert.deepEqual(unvalidated(c), []);
    assert.ok(c.some((x) => x.name === 'webhook-payload:no-webhooks'));
  });

  it('NEGATIVE: an ordinary POST route that is not a webhook is not judged here; a signature-verified webhook is validated', async () => {
    w('src/users.js', "app.post('/users', (req, res) => { const name = req.body.name; res.json({ name }); });\n");
    w('src/stripe.js', "app.post('/webhook', (req, res) => {\n  const event = stripe.webhooks.constructEvent(req.body, sig, secret);\n  res.json({ received: true });\n});\n");
    const c = await run();
    assert.deepEqual(unvalidated(c), []);
    assert.ok(c.some((x) => x.name === 'webhook-payload:all-validated'));
  });
});
