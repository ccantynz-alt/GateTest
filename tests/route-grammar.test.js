// =============================================================================
// route-grammar — one answer to "is this file an HTTP handler?" (move 11)
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { hasRouteHandler, hasMutatingHandler, SESSION_MIDDLEWARE_RE } = require('../src/core/route-grammar');

describe('hasRouteHandler / hasMutatingHandler', () => {
  const handlers = [
    ["app.post('/users', (req, res) => {})", true],
    ["router.put(\"/users/:id\", handler)", true],
    ["fastify.post('/webhook', async (req, reply) => {})", true],
    ["hono.delete('/x', c => c.text(''))", true],
    ["koa.patch('/x', ctx => {})", true],
    ['export async function POST(req: Request) {}', true],
    ['export const PUT = async (req) => {}', true],
    ["@Post('/users')\n  create(@Body() dto) {}", true],
  ];
  for (const [src, expected] of handlers) {
    it(`mutating: ${src.split('\n')[0]}`, () => {
      assert.strictEqual(hasMutatingHandler(src), expected);
      assert.strictEqual(hasRouteHandler(src), true);
    });
  }
  it('a GET-only file is a handler but not a mutating one', () => {
    const src = "app.get('/health', (req, res) => res.send('ok'))";
    assert.strictEqual(hasRouteHandler(src), true);
    assert.strictEqual(hasMutatingHandler(src), false);
  });
  it('a utility that merely reads req.body is not a handler', () => {
    const src = 'function pick(req) { return req.body.name; }\nmodule.exports = { pick };';
    assert.strictEqual(hasRouteHandler(src), false);
    assert.strictEqual(hasMutatingHandler(src), false);
  });
  it('prose about routes is not a route', () => {
    assert.strictEqual(hasRouteHandler('// call app.post later, see docs'), false);
  });
});

describe('SESSION_MIDDLEWARE_RE — both module systems', () => {
  for (const src of [
    "const session = require('express-session');",
    "import session from 'express-session';",
    'import cookieSession from "cookie-session";',
    "import fastifySession from '@fastify/session';",
  ]) {
    it(`sees ${src}`, () => assert.strictEqual(SESSION_MIDDLEWARE_RE.test(src), true));
  }
  it('does not see an unrelated package', () => {
    assert.strictEqual(SESSION_MIDDLEWARE_RE.test("import x from 'express-sessionless';"), false);
  });
});
