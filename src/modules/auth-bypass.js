/**
 * Auth Bypass Detector — finds routes that are missing authentication.
 *
 * Scans Express / Next.js App Router / Fastify route handlers for HTTP
 * endpoints that never call an auth middleware or check a session/token.
 *
 * Detection strategy:
 *   1. Collect all route-defining files.
 *   2. For each handler function body, check for at least one auth signal.
 *   3. Flag handlers with no auth signal at all (unless the file or route
 *      is explicitly marked public).
 *
 * Auth signals recognised:
 *   - Middleware names: isAuthenticated, requireAuth, withAuth, authenticate,
 *     verifyToken, checkAuth, authMiddleware, protect, ensureLoggedIn,
 *     isLoggedIn, requireLogin, verifySession, validateToken, jwtAuth,
 *     isAdmin, requireRole, hasPermission
 *   - Session / JWT reads: req.session, req.user, req.auth,
 *     getServerSession, getSession, auth(), currentUser(), verifyJwt
 *   - Clerk / NextAuth / Supabase: clerkMiddleware, withClerkMiddleware,
 *     getAuth, useAuth, createServerComponentClient, createRouteHandlerClient
 *
 * Public-route suppression: comment `// auth-public` or `// no-auth` on
 * the handler line suppresses the warning. Files named `public/`, `health`,
 * `webhook`, or `callback` are skipped entirely.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const BaseModule    = require('./base-module');
const { makeAutoFix } = require('../core/ai-fix-engine');

// ─── auth signal patterns ──────────────────────────────────────────────────

const AUTH_MIDDLEWARE = [
  'isAuthenticated', 'requireAuth', 'withAuth', 'authenticate',
  'verifyToken', 'checkAuth', 'authMiddleware', 'protect', 'ensureLoggedIn',
  'isLoggedIn', 'requireLogin', 'verifySession', 'validateToken', 'jwtAuth',
  'isAdmin', 'requireRole', 'hasPermission', 'authorize', 'authorized',
  'mustBeLoggedIn', 'requireUser', 'withSession', 'sessionRequired',
  'clerkMiddleware', 'withClerkMiddleware', 'requireAuthentication',
];

const AUTH_READS = [
  'req\\.session', 'req\\.user', 'req\\.auth', 'request\\.user',
  'getServerSession', 'getSession\\(', 'currentUser\\(', 'verifyJwt',
  'getAuth\\(', 'auth\\(\\)', 'useAuth\\(', 'createServerComponentClient',
  'createRouteHandlerClient', 'createClient\\(', 'supabaseClient',
  'jwt\\.verify', 'jsonwebtoken', 'Bearer ', 'Authorization',
  'headers\\.authorization', 'headers\\.get\\([\'"]authorization',
  'context\\.user', 'ctx\\.user', 'ctx\\.state\\.user',
  // Evidence the handler ENFORCES something itself — a 401/403 response,
  // a cookie/session read, an HMAC/signature or API-key/secret comparison.
  // Absent from the original list, which is why five admin routes on this
  // repo that return 401 on a bad cookie were reported "unprotected".
  'status:\\s*40[13]\\b', "['\"]Unauthorized['\"]", "['\"]Forbidden['\"]",
  'cookies\\(\\)', 'cookieStore', '_COOKIE_NAME', 'SESSION_COOKIE',
  'getAdminUser', 'x-admin-token', 'timingSafeEqual', 'safeEqual\\(',
  'authenticateApiKey', 'apiKey', 'API_KEY', 'CRON_SECRET', 'SIGNING_SECRET',
  'WEBHOOK_SECRET', 'verifySignature', 'verifyHmac', 'x-hub-signature',
  'stripe-signature', 'x-signature', 'checkPwCookie', 'requireSession',
];

// Naming-convention signal: any identifier shaped like an auth guard
// (`isAdminRequest`, `requireOwner`, `verifyApiKey`, `ensureLoggedIn`,
// `hasAccessTo`, `passport.authenticate`). The fixed list above cannot keep
// up with how teams name their guards — GateTest's own admin API uses
// `isAdminRequest`, which `\bisAdmin\b` never matched, so the module reported
// 83 "unprotected" admin routes on this repo (2026-08-18 audit).
const AUTH_HEURISTIC_RE = /\b(?:is|has|require|requires|verify|check|assert|ensure|need|needs|with|must|guard|enforce|validate|authorize|authorise|protect)(?:[A-Z][A-Za-z0-9]*?)?(?:Auth|Admin|Access|Session|Permission|Perm|User|Owner|Role|Login|Logged|Token|Scope|Api[Kk]ey|Secret|Signature|Signed|Cron|Tick|Bearer|Credential|Identity|Principal|Member|Tenant|Account)\w*\b|\bpassport\.authenticate\b|\b(?:auth|authn|authz|authGuard|jwtGuard|apiKeyGuard|adminOnly|adminGuard|requireAdmin|isAuthorisedTick|isAuthorizedTick)\b/;

const AUTH_SIGNAL_RE = new RegExp(
  [
    ...AUTH_MIDDLEWARE.map(m => `\\b${m}\\b`),
    ...AUTH_READS,
    AUTH_HEURISTIC_RE.source,
  ].join('|')
);

// ─── route detection patterns ──────────────────────────────────────────────

// A ROUTE registration is `<obj>.<verb>('<path>', <handler...>)`: the path
// starts with `/` (or `*`) AND is followed by a comma — there is always at
// least a handler argument. `app.get('trust proxy fn')` is Express's
// SETTINGS GETTER, not a route; it produced "unprotected routes" in express
// core itself (2026-08-18 audit). One regex covers Express / Hono / Koa /
// Fastify receivers so the same route is not reported 2–3× by overlapping
// per-framework patterns.
const EXPRESS_ROUTE_RE = /(?:app|router|hono|fastify|server|api|route[rs]?)\s*\.\s*(get|post|put|patch|delete|all|route)\s*\(\s*['"`]([/*][^'"`,\n]*)['"`]\s*,/g;

// Next.js App Router: exported async function GET/POST/PUT/PATCH/DELETE
const NEXTJS_EXPORT_RE = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|ALL)\s*\(/gm;

// Kept as named aliases for readers of the code paths below; all four are
// the same registration grammar.
const FASTIFY_ROUTE_RE = EXPRESS_ROUTE_RE;
const HONO_ROUTE_RE = EXPRESS_ROUTE_RE;
const KOA_ROUTE_RE = EXPRESS_ROUTE_RE;

// ─── helpers ───────────────────────────────────────────────────────────────

const PUBLIC_ROUTE_KEYWORDS = [
  '/health', '/healthz', '/ping', '/status', '/metrics',
  '/webhook', '/callback', '/oauth', '/auth/callback',
  '/public/', '/static/', '/assets/', '/favicon',
  '/login', '/signup', '/register', '/logout',
  '/verify-email', '/reset-password', '/forgot-password',
  // Public-by-design website surfaces: badges, sitemaps, robots, LLM manifests,
  // OG images, platform status, checkout creation (Stripe hosts the payment).
  '/badge', '/sitemap', '/robots', 'llms.txt', '.txt', '/og', '/opengraph',
  '/platform-status', '/checkout', '/preview', '/playground',
];

// Paths whose data is sensitive whatever the HTTP method.
const SENSITIVE_PATH_RE = /\b(admin|internal|private|account|settings|billing|user|users|me|profile|secret|token|key|keys|db|database|config|debug|cron|tick|worker|fix|server-fix|nuclear|delete|export)\b/i;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'ALL', 'ROUTE']);

function isPublicRoute(routePath) {
  return PUBLIC_ROUTE_KEYWORDS.some(kw => routePath.toLowerCase().includes(kw));
}

function isPublicFile(relPath) {
  const lower = relPath.toLowerCase();
  return (
    lower.includes('public/') ||
    lower.includes('/health') ||
    lower.includes('/webhook') ||
    lower.includes('/callback') ||
    lower.includes('/auth/') ||
    lower.includes('middleware') ||
    lower.includes('login') ||
    lower.includes('logout') ||
    lower.includes('signup') ||
    lower.includes('register') ||
    lower.includes('test') ||
    lower.includes('spec') ||
    lower.includes('.test.') ||
    lower.includes('.spec.')
  );
}

/**
 * Return the WHOLE registration call expression starting at the match —
 * `app.get('/x', isLoggedIn, handler)` — by balancing parentheses (strings
 * skipped). The previous implementation walked to the first `{`, so a route
 * whose middleware and handler were bare identifiers (no brace on that
 * statement) was judged by whatever the NEXT statement's body contained, and
 * every `isLoggedIn`-guarded route in OWASP NodeGoat came out "unprotected".
 * Falls back to the handler's brace body, then to a 300-char window.
 */
function extractHandlerBody(content, matchIndex) {
  const open = content.indexOf('(', matchIndex);
  // `export function GET(req)` is a DECLARATION — its parens are the
  // parameter list, so balance braces (the body) instead of parens.
  const isDeclaration = open !== -1 && /function\s+[A-Za-z0-9_$]*\s*$/.test(content.slice(matchIndex, open));
  if (!isDeclaration && open !== -1 && open - matchIndex < 120) {
    let depth = 0;
    let quote = null;
    for (let i = open; i < content.length; i++) {
      const ch = content[i];
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return content.slice(matchIndex, i + 1);
      }
    }
  }
  let depth = 0;
  let start = -1;
  for (let i = matchIndex; i < content.length; i++) {
    if (content[i] === '{') {
      if (start === -1) start = i;
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return content.slice(start, i + 1);
      }
    }
  }
  return content.slice(matchIndex, matchIndex + 300);
}

/**
 * Router-level protection: `app.use(requireAuth)` / `router.use('/admin',
 * adminOnly)` before a route protects every route registered after it.
 * Returns the content offset after which routes count as guarded, or -1.
 */
function routerLevelAuthOffset(content) {
  const re = /\.use\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (AUTH_SIGNAL_RE.test(m[1])) return m.index;
  }
  return -1;
}

// ─── module ────────────────────────────────────────────────────────────────

class AuthBypassDetector extends BaseModule {
  constructor() {
    super('authBypass', 'Auth Bypass Detector — routes missing authentication');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const extensions  = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
    const files = this._collectFiles(projectRoot, extensions);

    let routeFiles  = 0;
    let unprotected = 0;

    for (const file of files) {
      // Forward slashes always — findings must not differ by host OS.
      const rel = path.relative(projectRoot, file).split(path.sep).join('/');
      if (isPublicFile(rel)) continue;

      let content;
      try { content = fs.readFileSync(file, 'utf-8'); } catch { continue; }

      // Skip files with no route definitions
      const hasRoutes = (
        EXPRESS_ROUTE_RE.test(content) ||
        NEXTJS_EXPORT_RE.test(content) ||
        FASTIFY_ROUTE_RE.test(content) ||
        HONO_ROUTE_RE.test(content) ||
        KOA_ROUTE_RE.test(content)
      );

      // Reset lastIndex after test()
      EXPRESS_ROUTE_RE.lastIndex  = 0;
      NEXTJS_EXPORT_RE.lastIndex  = 0;
      FASTIFY_ROUTE_RE.lastIndex  = 0;
      HONO_ROUTE_RE.lastIndex     = 0;
      KOA_ROUTE_RE.lastIndex      = 0;

      if (!hasRoutes) continue;
      routeFiles++;

      const lines = content.split('\n');
      const issues = this._findUnauthenticatedRoutes(file, rel, content, lines);

      if (issues.length === 0) continue;
      unprotected += issues.length;

      // Group all unprotected routes in this file into ONE finding to avoid
      // 252-finding spam when a whole router file lacks auth middleware.
      const routeList = issues
        .slice(0, 10)
        .map((i) => `\`${i.method.toUpperCase()} ${i.route}\` (line ${i.line})`)
        .join(', ');
      const extra = issues.length > 10 ? ` + ${issues.length - 10} more` : '';
      // Severity is decided by RISK, not by "no keyword matched": an
      // unauthenticated write, or a read of a sensitive path, blocks; an
      // anonymous GET of a non-sensitive path is a warning — most public
      // APIs serve exactly that on purpose, and blocking a build for it is
      // Forbidden #25 (we are the painkiller, not the bottleneck).
      const risky = issues.some((i) => MUTATING.has(i.method.toUpperCase()) || SENSITIVE_PATH_RE.test(i.route));
      result.addCheck(`auth-bypass:${rel}`, false, {
        severity: risky ? 'error' : 'warning',
        message: `${issues.length} unprotected route${issues.length !== 1 ? 's' : ''} in \`${rel}\`: ${routeList}${extra}`,
        file: rel,
        line: issues[0].line,
        details: issues.map((i) => ({ method: i.method.toUpperCase(), route: i.route, line: i.line })),
        fix: `Add authentication middleware at the router level (e.g. \`router.use(requireAuth)\`) or add \`getServerSession()\` / \`req.user\` checks to each handler. Mark intentionally public routes with \`// auth-public\`.`,
        autoFix: makeAutoFix(
          file,
          'auth-bypass',
          `${issues.length} routes in ${rel} have no authentication check`,
          issues[0].line,
          `Add requireAuth middleware or session check to routes in ${rel}`
        ),
      });
    }

    if (routeFiles === 0) {
      result.addCheck('auth-bypass:no-routes', true, {
        severity: 'info',
        message: 'No route files found — auth bypass check skipped',
      });
      return;
    }

    if (unprotected === 0) {
      result.addCheck('auth-bypass:all-protected', true, {
        severity: 'info',
        message: `All ${routeFiles} route file(s) have authentication`,
      });
    }
  }

  _findUnauthenticatedRoutes(file, rel, content, lines) {
    const issues = [];

    // Check Next.js App Router exports first (method-level granularity)
    if (file.includes('/api/') || file.endsWith('route.ts') || file.endsWith('route.js')) {
      let m;
      NEXTJS_EXPORT_RE.lastIndex = 0;
      while ((m = NEXTJS_EXPORT_RE.exec(content)) !== null) {
        const method = m[1];
        const matchIdx = m.index;
        const lineNo   = content.slice(0, matchIdx).split('\n').length;
        const lineText = lines[lineNo - 1] || '';

        if (lineText.includes('// auth-public') || lineText.includes('// no-auth')) continue;

        // Check previous 5 lines for suppression
        const context5 = lines.slice(Math.max(0, lineNo - 6), lineNo).join('\n');
        if (context5.includes('// auth-public') || context5.includes('// no-auth')) continue;

        const body = extractHandlerBody(content, matchIdx);
        if (AUTH_SIGNAL_RE.test(body)) continue;

        // Derive route from file path. The app dir may be nested
        // (`website/app/api/...`), so strip everything up to and including
        // the LAST `app/` (or `pages/`) segment, not just a leading one.
        const routePath = rel
          .replace(/\\/g, '/')
          .replace(/^(?:.*\/)?(?:app|pages)\//, '/')
          .replace(/^app$/, '/')
          .replace(/\/route\.(ts|js|tsx|jsx)$/, '')
          .replace(/\/\(.*?\)/g, '') // remove Next.js route groups
          || '/';

        if (isPublicRoute(routePath)) continue;

        issues.push({ method, route: routePath, line: lineNo });
      }
      NEXTJS_EXPORT_RE.lastIndex = 0;
      return issues;
    }

    // Express / Fastify / Hono / Koa — one registration grammar, one pass
    // (the per-framework regexes used to overlap and list each route 2–3×).
    const routePatterns = [{ re: EXPRESS_ROUTE_RE, framework: 'express' }];
    const guardedFrom = routerLevelAuthOffset(content);
    const seen = new Set();

    for (const { re } of routePatterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const [, method, routePath] = m;
        if (isPublicRoute(routePath)) continue;

        const matchIdx = m.index;
        // Registered after a router-level auth middleware → protected.
        if (guardedFrom !== -1 && matchIdx > guardedFrom) continue;
        const key = `${method}:${routePath}:${matchIdx}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lineNo   = content.slice(0, matchIdx).split('\n').length;
        const lineText = lines[lineNo - 1] || '';

        if (lineText.includes('// auth-public') || lineText.includes('// no-auth')) continue;

        // A route quoted inside a string literal or a comment is not a route.
        //
        // This module had NO string guard at all — KI #77 listed it as the
        // highest-severity class with no guards — and its route regexes run
        // against whole-file content, so
        //     example: "app.get('/r', (req, res) => handler(req))",
        // in a documentation object read as a real unauthenticated endpoint and
        // reported at ERROR severity. Blocking a build over a quoted example is
        // Forbidden #25, and auth-bypass is the worst place for it: the finding
        // says "you shipped an endpoint with no auth", which nobody ignores.
        // Caught by tests/heavy/inert-fixture-sweep.test.js.
        if (this._isCommentLine(lineText)) continue;
        const lineStart = content.lastIndexOf('\n', matchIdx - 1) + 1;
        if (this._isInsideStringLiteral(lineText, matchIdx - lineStart)) continue;

        const body = extractHandlerBody(content, matchIdx);
        if (AUTH_SIGNAL_RE.test(body)) continue;

        issues.push({ method, route: routePath, line: lineNo });
      }
      re.lastIndex = 0;
    }

    return issues;
  }
}

module.exports = AuthBypassDetector;
