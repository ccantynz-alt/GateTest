'use strict';

// AUTH-BYPASS PRECISION — the false-positive classes measured 2026-08-18
// (≈0 precision on real code: express core, OWASP NodeGoat, this repo) each
// get a NEGATIVE control (must be silent) next to a POSITIVE control (must
// still fire), so precision cannot be bought by muting the rule.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AuthBypass = require('../src/modules/auth-bypass');

function makeResult() {
  const checks = [];
  return {
    checks,
    addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
    get errors() { return checks.filter((c) => !c.passed && (c.meta.severity || 'error') === 'error'); },
    /** every finding regardless of severity — anonymous GETs of non-sensitive paths are warnings by design */
    get findings() { return checks.filter((c) => !c.passed); },
  };
}
async function scan(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-authbypass-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    const result = makeResult();
    await new AuthBypass().run(result, { projectRoot: root });
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('authBypass — positive controls (must still fire)', () => {
  it('flags an Express route with no middleware and no auth read in the handler', async () => {
    const r = await scan({ 'src/routes.js': `
const router = require('express').Router();
router.post('/orders', (req, res) => { res.json(db.orders.create(req.body)); });
module.exports = router;
` });
    assert.equal(r.errors.length, 1, JSON.stringify(r.checks));
    assert.match(r.errors[0].meta.message, /POST \/orders/);
  });

  it('flags a Next.js route handler with no session check', async () => {
    const r = await scan({ 'app/api/users/route.ts': `
export async function DELETE(req) { await db.user.deleteMany(); return Response.json({ ok: true }); }
` });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].meta.message, /DELETE \/api\/users/);
  });
});

describe('authBypass — severity follows risk', () => {
  it('an unauthenticated WRITE blocks; an anonymous GET of a non-sensitive path warns; a GET of an admin path blocks', async () => {
    const r = await scan({
      'src/a.js': `router.post('/comments', (req, res) => res.json(save(req.body)));`,
      'src/b.js': `router.get('/pokemon', (req, res) => res.json(list()));`,
      'src/c.js': `router.get('/admin/report', (req, res) => res.json(report()));`,
    });
    const sev = (file) => r.findings.find((f) => f.meta.message.includes(file)).meta.severity;
    assert.equal(sev('src/a.js'), 'error');
    assert.equal(sev('src/b.js'), 'warning');
    assert.equal(sev('src/c.js'), 'error');
  });
});

describe('authBypass — negative controls (measured false positives, must be silent)', () => {
  it("Express SETTINGS getter `app.get('trust proxy fn')` is not a route (express core)", async () => {
    const r = await scan({ 'lib/application.js': `
app.get = function get(setting) { return this.set(setting); };
var fn = app.get('trust proxy fn');
var etag = app.get('etag fn');
app.get('/health', (req, res) => res.end('ok'));
` });
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors.map((e) => e.meta.message)));
  });

  it('a route guarded by a middleware ARGUMENT (`isLoggedIn`) is protected even without a brace on that line (NodeGoat)', async () => {
    const r = await scan({ 'app/routes/index.js': `
module.exports = function(app) {
  app.get("/dashboard", isLoggedIn, dashboardHandler.displayDashboard);
  app.get("/profile", isLoggedIn, profileHandler.displayProfile);
  app.post("/profile", isLoggedIn, profileHandler.handleProfileUpdate);
  app.get("/nothing", function (req, res) { res.render("x", { csrftoken: "" }); });
};
` });
    // exactly ONE finding for the genuinely unguarded /nothing route (a
    // warning: anonymous GET of a non-sensitive path)
    assert.equal(r.findings.length, 1, JSON.stringify(r.findings.map((e) => e.meta.message)));
    assert.match(r.findings[0].meta.message, /1 unprotected route/);
    assert.match(r.findings[0].meta.message, /GET \/nothing/);
    assert.doesNotMatch(r.findings[0].meta.message, /dashboard|profile/);
    assert.equal(r.findings[0].meta.severity, 'warning');
  });

  it('a naming-convention guard the fixed list does not know (`isAdminRequest`, `verifyApiKey`) counts as auth', async () => {
    const r = await scan({
      'website/app/api/admin/users/route.ts': `
import { isAdminRequest } from "@/app/lib/admin-auth";
export async function GET(req) { if (!isAdminRequest(req)) return new Response("nope", { status: 401 }); return Response.json([]); }
`,
      'src/api.js': `
router.delete('/keys/:id', verifyApiKey, (req, res) => res.json(revoke(req.params.id)));
`,
    });
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors.map((e) => e.meta.message)));
  });

  it('routes registered after a router-level `.use(requireAuth)` are protected', async () => {
    const r = await scan({ 'src/admin.js': `
const router = express.Router();
router.use(requireAuth);
router.get('/reports', (req, res) => res.json(reports()));
router.post('/reports', (req, res) => res.json(create(req.body)));
` });
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors.map((e) => e.meta.message)));
  });

  it('a route is listed once, not once per framework regex, and nested app dirs give a clean path', async () => {
    const r = await scan({
      'src/x.js': `router.get('/things', (req, res) => res.json([]));`,
      'website/app/api/things/route.ts': `export async function GET() { return Response.json([]); }`,
    });
    const msgs = r.findings.map((e) => e.meta.message);
    const expressMsg = msgs.find((m) => m.includes('src/x.js'));
    assert.ok(expressMsg && /1 unprotected route in/.test(expressMsg), expressMsg);
    assert.equal((expressMsg.match(/GET \/things/g) || []).length, 1, 'listed exactly once');
    const nextMsg = msgs.find((m) => m.includes('website/app/api/things/route.ts'));
    assert.ok(nextMsg && /GET \/api\/things/.test(nextMsg), `expected clean /api/things path, got: ${nextMsg}`);
    assert.doesNotMatch(nextMsg, /website\/app\/api\/things`/);
  });
});
