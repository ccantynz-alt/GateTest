/**
 * Recall on the buyer-benchmark vulnerability classes (2026-08-18 audit
 * advancement #6). Six classes were recall misses on OWASP NodeGoat:
 * NoSQLi, template XSS, cookie flags, IDOR, CSRF, helmet. Each suite here
 * carries a POSITIVE control shaped like NodeGoat's actual plant and a
 * NEGATIVE control shaped like the protected/legitimate variant — a rule
 * that can't tell those apart is noise, not recall.
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) {
      this.checks.push({ name, passed, ...details });
    },
  };
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function failedNames(result, re) {
  return result.checks
    .filter((c) => !c.passed && re.test(c.name.replace(/\\/g, '/')))
    .map((c) => c.name.replace(/\\/g, '/'));
}

// ── NoSQLi + template XSS (security module patterns) ───────────────────────

describe('recall — NoSQL injection and template auto-escaping', () => {
  const SecurityModule = require('../src/modules/security');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-recall-sec-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new SecurityModule().run(result, { projectRoot: root });
    return result;
  }

  it('POSITIVE: $where with template-literal and concat input (NodeGoat A1)', async () => {
    write(tmp, 'app/dao.js', [
      'const q1 = { $where: `this.userId == ${parsedUserId} && this.stocks > ${parsedThreshold}` };',
      'const q2 = { $where: "this.userId == " + userId };',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(failedNames(r, /NoSQL injection.*dao\.js:1/).length >= 1, 'interpolated $where must flag');
    assert.ok(failedNames(r, /NoSQL injection.*dao\.js:2/).length >= 1, 'concatenated $where must flag');
  });

  it('NEGATIVE: a static $where string is not injection', async () => {
    write(tmp, 'app/dao.js', 'const q = { $where: "this.stocks > 5" };\n');
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /NoSQL injection/).length, 0);
  });

  it('NEGATIVE: a $where inside a block comment is not reported; the live one after it is (NodeGoat allocations-dao.js:73 / :78, 2026-09-05)', async () => {
    write(tmp, 'app/dao.js', [
      '/*',
      '  return {$where: `this.userId == ${parsedUserId} && this.stocks > ${parsedThreshold}`};',
      '*/',
      'return { $where: `this.userId == ${parsedUserId} && this.stocks > \'${threshold}\'` };',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.deepStrictEqual(
      failedNames(r, /NoSQL injection/).map((n) => n.replace(/^.*dao\.js:/, '')),
      ['4'],
    );
  });

  it('POSITIVE: autoescape disabled flags; NEGATIVE: enabled does not', async () => {
    write(tmp, 'server.js', 'swig.setDefaults({ autoescape: false });\n');
    write(tmp, 'other.js', 'swig.setDefaults({ autoescape: true });\n');
    const r = await run(tmp);
    assert.ok(failedNames(r, /auto-escaping disabled.*server\.js/).length >= 1);
    assert.strictEqual(failedNames(r, /auto-escaping disabled.*other\.js/).length, 0);
  });
});

// ── helmet + CSRF posture (security module, project level) ─────────────────

describe('recall — helmet and CSRF middleware posture', () => {
  const SecurityModule = require('../src/modules/security');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-recall-post-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new SecurityModule().run(result, { projectRoot: root });
    return result;
  }

  const EXPRESS_SESSION_APP = [
    'const express = require("express");',
    'const session = require("express-session");',
    'const app = express();',
    'app.use(session({ secret: "s" }));',
    'app.post("/allocations", (req, res) => res.send("ok"));',
  ];

  it('POSITIVE: commented-out helmet + csrf (NodeGoat A5/A8) both flag', async () => {
    write(tmp, 'server.js', [
      '// const helmet = require("helmet");',
      '// const csrf = require("csurf");',
      ...EXPRESS_SESSION_APP,
      '/*',
      'app.use(helmet());',
      'app.use(csrf());',
      '*/',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.ok(failedNames(r, /security:no-helmet/).length === 1, 'commented helmet must count as absent');
    assert.ok(failedNames(r, /security:no-csrf-protection/).length === 1, 'commented csrf must count as absent');
  });

  it('NEGATIVE: active helmet + csurf silence both', async () => {
    write(tmp, 'server.js', [
      'const helmet = require("helmet");',
      'const csrf = require("csurf");',
      ...EXPRESS_SESSION_APP,
      'app.use(helmet());',
      'app.use(csrf());',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /no-helmet|no-csrf/).length, 0);
  });

  it('NEGATIVE: a non-express project gets neither posture finding', async () => {
    write(tmp, 'cli.js', 'const { program } = require("commander");\nprogram.parse();\n');
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /no-helmet|no-csrf/).length, 0);
  });

  it('NEGATIVE: token-auth API without session middleware needs no CSRF', async () => {
    write(tmp, 'server.js', [
      'const express = require("express");',
      'const helmet = require("helmet");',
      'const app = express();',
      'app.use(helmet());',
      'app.post("/api/things", (req, res) => res.send("ok"));',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /no-csrf/).length, 0, 'no cookie session → CSRF does not apply');
  });

  it('NEGATIVE: a csrf keyword inside a TEST FIXTURE does not count as protection', async () => {
    write(tmp, 'server.js', ['// const csrf = require("csurf");', ...EXPRESS_SESSION_APP, ''].join('\n'));
    write(tmp, 'test/security/zap-test.js', 'const payload = "user=x%26_csrf%3Dabc";\nmodule.exports = payload;\n');
    const r = await run(tmp);
    assert.ok(failedNames(r, /no-csrf-protection/).length === 1,
      'URL-encoded _csrf in a test payload must not suppress the finding');
  });
});

// ── cookie flags: secure never set (cookie-security module) ────────────────

describe('recall — session cookie secure flag absent', () => {
  const CookieSecurityModule = require('../src/modules/cookie-security');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-recall-cook-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new CookieSecurityModule().run(result, { projectRoot: root });
    return result;
  }

  it('POSITIVE: `// secure: true` commented out inside the cookie block (NodeGoat A5)', async () => {
    write(tmp, 'server.js', [
      'const session = require("express-session");',
      'app.use(session({',
      '    secret: "s",',
      '    cookie: {',
      '        httpOnly: true',
      '        // secure: true',
      '    }',
      '}));',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /js-session-secure-absent/).length, 1);
  });

  it('NEGATIVE: secure: true configured → silent', async () => {
    write(tmp, 'server.js', [
      'const session = require("express-session");',
      'app.use(session({ secret: "s", cookie: { httpOnly: true, secure: true } }));',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /js-session-secure-absent/).length, 0);
  });

  it('NEGATIVE: explicit secure:false is the line rule’s job, not double-reported', async () => {
    write(tmp, 'server.js', [
      'const session = require("express-session");',
      'app.use(session({ secret: "s", cookie: { secure: false } }));',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /js-session-secure-absent/).length, 0);
    assert.ok(failedNames(r, /js-secure-false/).length >= 1, 'explicit false still errors via the line rule');
  });

  it('NEGATIVE: a session() call from a non-session library is ignored', async () => {
    write(tmp, 'app.js', 'const s = session({ mode: "workshop" });\n');
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /js-session-secure-absent/).length, 0);
  });
});

// ── IDOR: session identity shadowed by client input (auth-bypass) ──────────

describe('recall — IDOR identity shadowing', () => {
  const AuthBypassModule = require('../src/modules/auth-bypass');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-recall-idor-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function run(root) {
    const result = makeResult();
    await new AuthBypassModule().run(result, { projectRoot: root });
    return result;
  }

  it('POSITIVE: NodeGoat shape — multi-line params destructure overrides session userId', async () => {
    write(tmp, 'app/routes/allocations.js', [
      'exports.displayAllocations = (req, res) => {',
      '    const { userId } = req.session;',
      '    const {',
      '        threshold,',
      '        userId',
      '    } = req.params;',
      '    dao.getByUserId(userId, threshold);',
      '};',
      '',
    ].join('\n'));
    const r = await run(tmp);
    const hits = failedNames(r, /idor-shadow:app\/routes\/allocations\.js/);
    assert.strictEqual(hits.length, 1, `expected exactly one IDOR finding, got: ${hits.join(', ')}`);
  });

  it('POSITIVE: single-line assignment form flags too', async () => {
    write(tmp, 'app/r.js', [
      'let accountId = req.session.accountId;',
      'accountId = req.params.accountId;',
      'db.find(accountId);',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /idor-shadow/).length, 1);
  });

  it('NEGATIVE: different names (session id used for authz, param for lookup) is fine', async () => {
    write(tmp, 'app/r.js', [
      'const { userId } = req.session;',
      'const { articleId } = req.params;',
      'db.findArticle(articleId, { owner: userId });',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /idor-shadow/).length, 0);
  });

  it('NEGATIVE: client read BEFORE the session read is not a shadow', async () => {
    write(tmp, 'app/r.js', [
      'const { userId } = req.params;',
      'const { userId: sessionUserId } = req.session;',
      'if (userId !== sessionUserId) return res.status(403).end();',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /idor-shadow/).length, 0);
  });

  it('NEGATIVE: `// idor-ok` suppresses a reviewed exception', async () => {
    write(tmp, 'app/r.js', [
      'const { userId } = req.session;',
      '// idor-ok — admin route, role checked by middleware above',
      'const { userId: target } = req.params;',
      'let userId2 = req.session.userId;',
      '// idor-ok',
      'userId2 = req.params.userId2;',
      '',
    ].join('\n'));
    write(tmp, 'app/r2.js', [
      'const { userId } = req.session;',
      '// idor-ok reviewed 2026-08-25',
      'const { userId } = req.params;',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /idor-shadow:app\/r2\.js/).length, 0);
  });
});

// Move 11 (2026-09-05): the CSRF rule's precondition — "a cookie-session app"
// — only recognised CommonJS `require('express-session')`. An ESM app with
// state-changing routes and no CSRF middleware was never reported.
describe('recall — CSRF precondition sees ESM session imports', () => {
  const SecurityModule = require('../src/modules/security');
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-csrf-esm-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  async function run(root) {
    const mod = new SecurityModule();
    const result = makeResult();
    await mod.run(result, { projectRoot: root });
    return result;
  }
  it('POSITIVE: ESM express-session app with a POST route and no csrf flags', async () => {
    write(tmp, 'server.mjs', [
      "import express from 'express';",
      "import session from 'express-session';",
      'const app = express();',
      'app.use(session({ secret: "s" }));',
      'app.post("/allocations", (req, res) => res.send("ok"));',
      '',
    ].join('\n'));
    const r = await run(tmp);
    assert.strictEqual(failedNames(r, /security:no-csrf-protection/).length, 1);
  });
});
