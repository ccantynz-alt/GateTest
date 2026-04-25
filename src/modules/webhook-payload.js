/**
 * Webhook Payload Validator — catches unvalidated incoming webhook payloads.
 *
 * Webhook handlers that accept `req.body` without parsing/validating the
 * shape are vulnerable to:
 *   - Type confusion (body.amount is a string not a number → billing drift).
 *   - Missing fields causing silent undefined → downstream NaN / null writes.
 *   - Prototype pollution if the body is used in object spread.
 *   - Injection if body fields flow to database queries.
 *
 * Detection:
 *   1. Find webhook route handlers (POST routes at /webhook*, /events*, /hook*,
 *      or any route file in a webhooks/ directory).
 *   2. Check if the handler validates req.body before use.
 *   3. Flag handlers that access req.body.* properties directly without a
 *      prior schema.parse() / schema.safeParse() / Joi.validate() / ajv.validate()
 *      call.
 *
 * Validation signals recognised:
 *   - Zod: .parse(req.body) / .safeParse(req.body) / .parseAsync(req.body)
 *   - Joi: schema.validate(req.body) / Joi.object().validate(req.body)
 *   - Yup: schema.validate(req.body) / schema.validateSync(req.body)
 *   - ajv: ajv.validate(schema, req.body) / validate(req.body)
 *   - Manual: typeof req.body.X === / req.body.X !== undefined
 *   - Stripe/GitHub sig: stripe.webhooks.constructEvent / crypto.createHmac
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const BaseModule    = require('./base-module');
const { makeAutoFix } = require('../core/ai-fix-engine');

// ─── patterns ─────────────────────────────────────────────────────────────

const WEBHOOK_ROUTE_RE = /(?:app|router|fastify|server)\s*\.\s*post\s*\(\s*['"`]([^'"`,]*(?:webhook|event|hook|notify|callback|push|pull|receive)[^'"`,]*)['"`]/gi;

const BODY_ACCESS_RE   = /req\s*\.\s*body\s*\.\s*[a-zA-Z_$]/;

const VALIDATION_SIGNALS = [
  // Zod
  /\.(?:parse|safeParse|parseAsync)\s*\(\s*(?:req|request|body)/,
  // Joi
  /\.validate\s*\(\s*(?:req|request)\s*\.\s*body/,
  // Yup
  /\.validateSync\s*\(\s*(?:req|request)\s*\.\s*body/,
  // ajv
  /validate\s*\(\s*(?:schema|[a-zA-Z]+Schema)\s*,\s*(?:req|request)\s*\.\s*body/,
  // Manual type checks
  /typeof\s+(?:req|request)\s*\.\s*body/,
  // Stripe signature verification (proves the payload is authentic)
  /stripe\s*\.\s*webhooks\s*\.\s*constructEvent/,
  /webhook(?:s)?\s*\.\s*constructEvent/,
  // GitHub / generic HMAC signature
  /crypto\s*\.\s*createHmac/,
  /x-hub-signature|x-stripe-signature|x-github-event/i,
  // Svix / Clerk webhook verification
  /svix|wh\.verify|webhook\.verify/i,
];

// ─── module ────────────────────────────────────────────────────────────────

class WebhookPayloadValidator extends BaseModule {
  constructor() {
    super('webhookPayload', 'Webhook Payload Validator — catches webhook handlers that use req.body without validation');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const extensions  = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
    const files       = this._collectFiles(projectRoot, extensions);

    let webhookHandlers = 0;
    let unvalidated     = 0;

    for (const file of files) {
      const rel = path.relative(projectRoot, file);
      if (rel.includes('node_modules') || rel.includes('.next') || rel.includes('.test.') || rel.includes('.spec.')) continue;

      let content;
      try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }

      const isWebhookFile = (
        rel.toLowerCase().includes('webhook') ||
        rel.toLowerCase().includes('/events/') ||
        rel.toLowerCase().includes('/hook')
      );

      // Extract handler bodies for webhook routes
      const handlerBodies = isWebhookFile
        ? [{ body: content, route: rel, line: 1 }]
        : this._extractWebhookHandlers(content);

      for (const { body, route, line } of handlerBodies) {
        webhookHandlers++;

        // Check if body is accessed
        if (!BODY_ACCESS_RE.test(body)) continue;

        // Check for validation signal
        const validated = VALIDATION_SIGNALS.some(re => re.test(body));
        if (validated) continue;

        unvalidated++;
        result.addCheck(`webhook-payload:unvalidated:${rel}:${route || 'handler'}`, false, {
          severity: 'error',
          message: `Webhook handler at \`${rel}:${line}\` accesses \`req.body.*\` without schema validation`,
          file: rel,
          line,
          fix: `Add Zod validation: \`const payload = PayloadSchema.safeParse(req.body); if (!payload.success) return res.status(400).json({ error: 'Invalid payload' });\``,
          autoFix: makeAutoFix(
            file,
            'webhook-payload:unvalidated',
            `Webhook handler accesses req.body without schema validation`,
            line,
            `Add Zod schema validation: const schema = z.object({...}); const payload = schema.safeParse(req.body); if (!payload.success) return 400`
          ),
        });
      }
    }

    if (webhookHandlers === 0) {
      result.addCheck('webhook-payload:no-webhooks', true, {
        severity: 'info',
        message: 'No webhook handlers detected',
      });
      return;
    }

    if (unvalidated === 0) {
      result.addCheck('webhook-payload:all-validated', true, {
        severity: 'info',
        message: `All ${webhookHandlers} webhook handler(s) validate their payload`,
      });
    }
  }

  _extractWebhookHandlers(content) {
    const handlers = [];
    WEBHOOK_ROUTE_RE.lastIndex = 0;
    let m;
    while ((m = WEBHOOK_ROUTE_RE.exec(content)) !== null) {
      const route   = m[1];
      const lineNo  = content.slice(0, m.index).split('\n').length;
      const body    = this._extractFunctionBody(content, m.index);
      handlers.push({ body, route, line: lineNo });
    }
    WEBHOOK_ROUTE_RE.lastIndex = 0;
    return handlers;
  }

  _extractFunctionBody(content, startIdx) {
    let depth = 0;
    let start = -1;
    for (let i = startIdx; i < Math.min(startIdx + 3000, content.length); i++) {
      if (content[i] === '{') {
        if (start === -1) start = i;
        depth++;
      } else if (content[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) return content.slice(start, i + 1);
      }
    }
    return content.slice(startIdx, startIdx + 500);
  }
}

module.exports = WebhookPayloadValidator;
