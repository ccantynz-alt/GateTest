'use strict';

/**
 * One grammar for "this file defines an HTTP route handler".
 *
 * The Fifty, move 11. Several modules decided whether a file was a handler
 * — and therefore whether their rule ran at all — with a private
 * `content.includes('app.post')` test. That is Express spelled out by hand,
 * plus one Next.js export: a Fastify, Hono, Koa, NestJS, Bun or Elysia
 * handler reading `req.body` with no validation passed `dataIntegrity`
 * untouched, and a Fastify API with no docs passed `documentation`. The
 * auth-bypass module had already grown the wider grammar for its own use;
 * this file is that grammar, once, for every module that needs the
 * question answered.
 *
 * Deliberately a superset that errs toward "yes, this is a handler": the
 * modules built on it report findings inside the file, so the cost of a
 * false "yes" is a rule running on a non-handler (and finding nothing),
 * while the cost of a false "no" is the recall hole this replaces.
 */

// Objects routes are registered on across the JS/TS ecosystem.
const ROUTE_OBJECTS = String.raw`(?:app|router|routes|route|hono|fastify|server|api|koa|express|elysia|bun|instance)`;
const ROUTE_VERBS = String.raw`(?:get|post|put|patch|delete|del|head|options|all|route)`;
const MUTATING_VERBS = String.raw`(?:post|put|patch|delete|del)`;

/** `app.get('/x', …)`, `fastify.post("/x", …)`, `router.route('/x')` — any verb. */
const ROUTE_CALL_RE = new RegExp(String.raw`\b${ROUTE_OBJECTS}\s*\.\s*${ROUTE_VERBS}\s*\(\s*['"\x60]`);
/** The same, mutating verbs only. */
const MUTATING_ROUTE_CALL_RE = new RegExp(String.raw`\b${ROUTE_OBJECTS}\s*\.\s*${MUTATING_VERBS}\s*\(\s*['"\x60]`);

/** Next.js App Router / Remix / SvelteKit style verb exports. */
const VERB_EXPORT_RE = /\bexport\s+(?:async\s+)?(?:function\s+|const\s+)(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const MUTATING_VERB_EXPORT_RE = /\bexport\s+(?:async\s+)?(?:function\s+|const\s+)(?:POST|PUT|PATCH|DELETE)\b/;

/** NestJS / routing-controllers decorators. */
const VERB_DECORATOR_RE = /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/;
const MUTATING_VERB_DECORATOR_RE = /@(?:Post|Put|Patch|Delete)\s*\(/;

/** Does this source define at least one HTTP route handler? */
function hasRouteHandler(content) {
  const s = String(content || '');
  return ROUTE_CALL_RE.test(s) || VERB_EXPORT_RE.test(s) || VERB_DECORATOR_RE.test(s);
}

/** Does this source define a handler for a body-carrying (mutating) method? */
function hasMutatingHandler(content) {
  const s = String(content || '');
  return MUTATING_ROUTE_CALL_RE.test(s) || MUTATING_VERB_EXPORT_RE.test(s) || MUTATING_VERB_DECORATOR_RE.test(s);
}

/**
 * Is a session middleware in play? Both module systems — the CommonJS-only
 * form let every ESM `import session from 'express-session'` skip the
 * cookie-security and CSRF rules (found 2026-09-05).
 */
const SESSION_MIDDLEWARE_RE = /(?:require\s*\(\s*['"](?:express-session|cookie-session|@fastify\/session|@fastify\/secure-session|koa-session)['"]\s*\)|from\s+['"](?:express-session|cookie-session|@fastify\/session|@fastify\/secure-session|koa-session)['"])/;

module.exports = {
  ROUTE_OBJECTS,
  ROUTE_VERBS,
  ROUTE_CALL_RE,
  MUTATING_ROUTE_CALL_RE,
  VERB_EXPORT_RE,
  VERB_DECORATOR_RE,
  SESSION_MIDDLEWARE_RE,
  hasRouteHandler,
  hasMutatingHandler,
};
