# GateTest - Quality Assurance System

## READ THIS FIRST — MANDATORY INSTRUCTIONS FOR EVERY SESSION

**You are working on GateTest.** Before doing ANYTHING, follow these rules:

1. **READ this entire file first.** Do not start coding until you understand the project.
2. **READ `HANDOVER.md`** — it has the latest session state, what's done, what's next.
3. **Check git status and git log** to understand where the previous session left off.
4. **Do NOT start from scratch.** This is an existing project. Build on what's here.
5. **Do NOT create new files** unless absolutely necessary. Edit existing files first.
6. **Do NOT reorganize, refactor, or "improve"** unless explicitly asked.
7. **Run `node --test tests/*.test.js`** before committing anything.
8. **Run `cd website && npm run build`** before committing website changes.
9. **Commit and push** when work is complete. Branch: check `git branch` for current branch.
10. **UPDATE `HANDOVER.md`** after every commit — sessions can die without warning.

### Project Structure (DO NOT RECREATE — IT EXISTS)

```
GateTest/
├── CLAUDE.md          ← THIS FILE (quality rules, read every session)
├── HANDOVER.md        ← SESSION TRANSFER FILE (read first, update after every commit)
├── MARKETING.md       ← Positioning, pricing, website copy
├── package.json       ← CLI tool config
├── bin/gatetest.js    ← CLI entry point
├── src/
│   ├── index.js       ← Main library entry
│   ├── core/          ← Config, runner, registry, CLAUDE.md parser
│   ├── modules/       ← 16 test modules (syntax, security, a11y, etc.)
│   ├── reporters/     ← Console, JSON, HTML reporters
│   ├── scanners/      ← Continuous background scanner
│   └── hooks/         ← Pre-commit, pre-push hooks
├── tests/             ← Unit tests (must pass before commit)
└── website/           ← gatetest.io marketing site (Next.js + Tailwind)
    └── app/
        ├── page.tsx           ← Main page (assembles all sections)
        ├── layout.tsx         ← Root layout with metadata
        ├── globals.css        ← Dark theme, animations, glow effects
        └── components/        ← 12 React components (Navbar, Hero, etc.)
```

### What GateTest IS

- A **CLI QA tool** with 16 test modules that checks everything before code ships
- A **marketing website** at gatetest.io built with Next.js + Tailwind CSS
- Works alongside **GateCode** (separate repo — authorization layer)
- The first QA system **built for AI-generated code**

### Key Files to Read Before Making Changes

- `MARKETING.md` — All selling points, pricing, competitive positioning
- `src/index.js` — How the 16 modules are orchestrated
- `website/app/page.tsx` — How the website sections are composed

---

## Purpose

GateTest is the QA gate between Claude and GitHub. Nothing ships unless it passes
every check. No exceptions. This file is the single source of truth — it is read
and enforced before every build, every commit, and every push.

GateTest works alongside **GateCode** (the authorization layer between Claude and
GitHub) to form a complete CI/CD quality pipeline.

---

## MANDATORY PRE-BUILD CHECKLIST

Before ANY code is committed, pushed, or deployed, ALL of the following must pass.
A failure in ANY category blocks the entire build.

### 1. Syntax & Compilation

- [ ] Zero syntax errors across all source files
- [ ] Zero TypeScript / type-checking errors (strict mode)
- [ ] Zero linting errors (ESLint, Stylelint, Markdownlint)
- [ ] Zero import/require resolution failures
- [ ] All JSON, YAML, TOML, and config files parse without error
- [ ] No dangling commas, unclosed brackets, or malformed expressions
- [ ] All template literals and string interpolations resolve correctly

### 2. Unit Tests

- [ ] 100% of existing unit tests pass
- [ ] Every new function has at least one unit test
- [ ] Every new branch/conditional has a test case
- [ ] Edge cases tested: null, undefined, empty string, zero, negative, overflow
- [ ] Error paths tested: every catch block, every error handler
- [ ] Mock/stub cleanup verified — no test pollution across suites
- [ ] Test isolation confirmed — tests pass in any order

### 3. Integration Tests

- [ ] All API endpoint tests pass
- [ ] Database read/write/update/delete operations verified
- [ ] Third-party service integrations tested (mocked in CI, live in staging)
- [ ] Authentication and authorization flows tested end-to-end
- [ ] WebSocket / real-time connections tested where applicable
- [ ] File upload/download pipelines tested
- [ ] Queue/worker integrations tested

### 4. End-to-End (E2E) Tests

- [ ] Full user journey tests pass on all target browsers
- [ ] Critical paths tested: signup, login, core workflow, logout
- [ ] Form submissions validated (valid input, invalid input, edge cases)
- [ ] Navigation flows verified (forward, back, deep links, bookmarks)
- [ ] Multi-step workflows tested start-to-finish
- [ ] Error recovery flows tested (network drop, timeout, server error)
- [ ] Mobile viewport E2E tests pass

### 5. Visual & UI Testing

- [ ] No visual regressions detected (pixel-diff comparison)
- [ ] All fonts load correctly — no FOIT/FOUT issues
- [ ] Font sizes, weights, and families match design spec exactly
- [ ] Color values match design tokens (hex, RGB, HSL verified)
- [ ] Spacing (margin, padding) matches design system grid
- [ ] Icons render at correct size and color
- [ ] Images have correct aspect ratio, no distortion
- [ ] Animations and transitions are smooth (no jank, 60fps target)
- [ ] Dark mode / light mode renders correctly
- [ ] Print stylesheet renders correctly
- [ ] No text overflow, truncation, or clipping issues
- [ ] No orphaned or widowed text in paragraphs
- [ ] Cursor styles correct on all interactive elements
- [ ] Scrollbars styled consistently (where custom)
- [ ] No layout shifts (CLS < 0.1)

### 6. Responsive Design

- [ ] Layout correct at 320px (small mobile)
- [ ] Layout correct at 375px (standard mobile)
- [ ] Layout correct at 414px (large mobile)
- [ ] Layout correct at 768px (tablet portrait)
- [ ] Layout correct at 1024px (tablet landscape / small desktop)
- [ ] Layout correct at 1280px (standard desktop)
- [ ] Layout correct at 1920px (large desktop)
- [ ] Layout correct at 2560px+ (ultra-wide)
- [ ] Touch targets minimum 44x44px on mobile
- [ ] No horizontal scrollbar on any viewport
- [ ] Images scale properly across breakpoints
- [ ] Navigation adapts correctly (hamburger menu, drawer, etc.)

### 7. Accessibility (WCAG 2.2 AAA)

- [ ] All images have meaningful alt text
- [ ] Decorative images have empty alt="" and role="presentation"
- [ ] Color contrast ratio meets AAA (7:1 normal text, 4.5:1 large text)
- [ ] All interactive elements keyboard-accessible (Tab, Enter, Space, Escape)
- [ ] Focus indicators visible on all interactive elements
- [ ] Skip-to-content link present and functional
- [ ] ARIA labels on all non-text interactive elements
- [ ] ARIA landmarks used correctly (main, nav, aside, footer)
- [ ] Live regions (aria-live) for dynamic content updates
- [ ] Form inputs have associated labels
- [ ] Error messages associated with inputs via aria-describedby
- [ ] Screen reader tested (NVDA, VoiceOver, JAWS)
- [ ] No keyboard traps
- [ ] Logical tab order matches visual order
- [ ] Heading hierarchy is sequential (h1 > h2 > h3, no skips)
- [ ] Page language attribute set correctly
- [ ] Reduced motion preference respected (prefers-reduced-motion)

### 8. Performance

- [ ] Lighthouse Performance score >= 95
- [ ] Lighthouse Accessibility score >= 100
- [ ] Lighthouse Best Practices score >= 100
- [ ] Lighthouse SEO score >= 100
- [ ] First Contentful Paint (FCP) < 1.0s
- [ ] Largest Contentful Paint (LCP) < 2.0s
- [ ] Time to Interactive (TTI) < 2.5s
- [ ] Total Blocking Time (TBT) < 150ms
- [ ] Cumulative Layout Shift (CLS) < 0.05
- [ ] Interaction to Next Paint (INP) < 200ms
- [ ] Bundle size within budget (JS < 200KB gzipped, CSS < 50KB gzipped)
- [ ] No render-blocking resources
- [ ] Images optimized (WebP/AVIF with fallbacks)
- [ ] Lazy loading on below-fold images and components
- [ ] HTTP/2 or HTTP/3 in use
- [ ] Caching headers set correctly (immutable assets, ETags)
- [ ] No memory leaks (heap snapshot stable over 5-minute run)
- [ ] No CPU spikes during idle (< 1% idle CPU)
- [ ] Database queries optimized (no N+1, indexed lookups)
- [ ] API response times < 200ms (p95)

### 9. Security

- [ ] No hardcoded secrets, API keys, tokens, or passwords in source
- [ ] No secrets in git history (git-secrets scan clean)
- [ ] All dependencies scanned for CVEs (npm audit / Snyk / Dependabot clean)
- [ ] No critical or high severity vulnerabilities in dependency tree
- [ ] Content Security Policy (CSP) headers set and strict
- [ ] X-Frame-Options set (DENY or SAMEORIGIN)
- [ ] X-Content-Type-Options: nosniff set
- [ ] Strict-Transport-Security (HSTS) enabled
- [ ] All user input sanitized before rendering (XSS prevention)
- [ ] All database queries parameterized (SQL injection prevention)
- [ ] CSRF tokens on all state-changing requests
- [ ] Authentication tokens stored securely (httpOnly, secure, sameSite)
- [ ] Rate limiting on authentication endpoints
- [ ] Rate limiting on API endpoints
- [ ] File upload validation (type, size, content inspection)
- [ ] No directory traversal vulnerabilities
- [ ] No open redirects
- [ ] CORS configured to minimum required origins
- [ ] Subresource Integrity (SRI) on CDN resources
- [ ] No eval() or Function() constructor usage
- [ ] No innerHTML with unsanitized content
- [ ] SSL/TLS certificate valid and not near expiry

### 10. SEO & Metadata

- [ ] Unique, descriptive <title> on every page (50-60 chars)
- [ ] Meta description on every page (150-160 chars)
- [ ] Open Graph tags (og:title, og:description, og:image, og:url)
- [ ] Twitter Card tags (twitter:card, twitter:title, twitter:description)
- [ ] Canonical URLs set on all pages
- [ ] Structured data (JSON-LD) validated with Google Rich Results Test
- [ ] XML sitemap generated and accurate
- [ ] robots.txt configured correctly
- [ ] No broken internal links (404s)
- [ ] No broken external links
- [ ] Proper heading hierarchy for SEO
- [ ] Image alt text is descriptive and keyword-relevant
- [ ] URL structure is clean, readable, and consistent
- [ ] hreflang tags for multi-language sites
- [ ] 301 redirects for moved/renamed pages

### 11. Browser Compatibility

- [ ] Chrome (latest 2 versions)
- [ ] Firefox (latest 2 versions)
- [ ] Safari (latest 2 versions)
- [ ] Edge (latest 2 versions)
- [ ] iOS Safari (latest 2 versions)
- [ ] Android Chrome (latest 2 versions)
- [ ] No vendor-prefix-only CSS without fallback
- [ ] No unpolyfilled modern JS features for target browsers
- [ ] Web API usage checked against caniuse.com compatibility

### 12. Code Quality

- [ ] No TODO, FIXME, HACK, or XXX comments left unresolved
- [ ] No commented-out code blocks
- [ ] No console.log, console.debug, or debugger statements
- [ ] No unused variables, imports, or functions
- [ ] No unused CSS classes or selectors
- [ ] No duplicate code blocks (DRY principle)
- [ ] Function length < 50 lines (extract if longer)
- [ ] File length < 300 lines (split if longer)
- [ ] Cyclomatic complexity < 10 per function
- [ ] Consistent naming conventions throughout
- [ ] Error handling is explicit, not silent catches
- [ ] All promises have rejection handlers
- [ ] No race conditions in async code
- [ ] No circular dependencies

### 13. Documentation

- [ ] README.md is accurate and up-to-date
- [ ] API endpoints documented with request/response examples
- [ ] Environment variables documented
- [ ] Setup/installation instructions verified (fresh clone test)
- [ ] CHANGELOG updated for user-facing changes
- [ ] Breaking changes clearly documented with migration path

### 14. Infrastructure & DevOps

- [ ] Docker builds succeed
- [ ] Docker image size is optimized (multi-stage builds)
- [ ] Health check endpoints respond correctly
- [ ] Environment-specific configs are correct (dev, staging, prod)
- [ ] Database migrations run forward and backward cleanly
- [ ] Rollback procedure tested
- [ ] Monitoring and alerting configured
- [ ] Log levels appropriate (no sensitive data in logs)
- [ ] Error tracking integration working (Sentry, etc.)

### 15. Data Integrity

- [ ] Database schema matches ORM/model definitions
- [ ] Foreign key constraints in place
- [ ] Data validation at API boundary AND database level
- [ ] Backup and restore procedure tested
- [ ] Data migration scripts are idempotent
- [ ] No data loss on deploy (zero-downtime deployment verified)
- [ ] PII handling complies with GDPR/CCPA requirements

---

## CONTINUOUS SCANNING PROTOCOL

GateTest does not sleep. Even when no build is active, the following scans run
continuously:

### Passive Monitoring (Always Active)
- **Dependency Watch**: Monitor npm/pip/cargo advisories for new CVEs in project deps
- **SSL Monitor**: Track certificate expiry dates, alert 30 days before
- **Uptime Monitor**: Ping all endpoints every 60 seconds
- **Error Rate Monitor**: Alert if error rate exceeds 0.1% over 5-minute window
- **Performance Baseline**: Collect Core Web Vitals every hour, alert on regression
- **Security Headers**: Verify security headers haven't been stripped or weakened
- **DNS Monitor**: Watch for unauthorized DNS changes
- **Domain Expiry**: Track domain registration expiry

### Active Scanning (Scheduled)
- **Full Security Audit**: Weekly OWASP ZAP scan against staging
- **Dependency Audit**: Daily npm audit / pip audit / cargo audit
- **Broken Link Check**: Daily crawl for 404s and broken links
- **Lighthouse Full Audit**: Daily performance/accessibility/SEO audit
- **Visual Regression**: Screenshot comparison after every deploy
- **Load Test**: Weekly baseline load test (normal traffic patterns)
- **Penetration Test Patterns**: Monthly automated penetration testing
- **Compliance Scan**: Monthly WCAG 2.2 AAA full audit

### Competitive Intelligence Scanning
- **Technology Watch**: Scan for new testing tools, frameworks, and methodologies
- **CVE Database**: Monitor NVD, GitHub Security Advisories, Snyk DB
- **Best Practices**: Track OWASP, W3C, Google Web Dev updates
- **Browser Updates**: Monitor upcoming browser changes that affect compatibility

---

## GATE RULES (NON-NEGOTIABLE)

1. **ZERO TOLERANCE**: Any single check failure blocks the entire pipeline.
   No "it's just a warning" — warnings are errors.

2. **NO MANUAL OVERRIDES**: No human can bypass the gate. The checks either
   pass or the build is rejected. Period.

3. **NO PARTIAL DEPLOYS**: Either everything passes and ships, or nothing ships.
   No "deploy anyway, we'll fix it later."

4. **EVIDENCE REQUIRED**: Every gate pass must produce a timestamped report
   with full pass/fail details. Reports are stored permanently.

5. **REGRESSION = ROLLBACK**: If production monitoring detects a regression
   within 15 minutes of deploy, automatic rollback triggers.

6. **SHIFT LEFT**: Catch issues as early as possible. IDE-level checks first,
   pre-commit hooks second, CI third. Never defer a check to a later stage.

7. **TEST THE TESTS**: Mutation testing validates that tests actually catch
   bugs. Mutation score must be >= 80%.

8. **EVERYTHING IS VERSIONED**: Test configurations, thresholds, baselines —
   all version controlled. No magic numbers in CI configs.

---

## HOOK ENFORCEMENT

This CLAUDE.md file is loaded and enforced automatically via hooks:

### Pre-Build Hook
```
Every build MUST:
1. Parse this CLAUDE.md file
2. Extract all checklist items
3. Run the corresponding GateTest module for each item
4. Generate a pass/fail report
5. Block on any failure
```

### Pre-Commit Hook
```
Every commit MUST:
1. Run syntax checks on changed files
2. Run linting on changed files
3. Run unit tests for affected modules
4. Scan for secrets in staged files
5. Verify no console.log/debugger statements
6. Check code quality metrics on changed files
```

### Pre-Push Hook
```
Every push MUST:
1. Run full test suite
2. Run security scan
3. Run performance budget check
4. Verify all checklist items from this file
5. Generate and attach quality report
```

---

## GATETEST ARCHITECTURE

```
+-------------------+
|    Claude Code    |
+--------+----------+
         |
         v
+--------+----------+
|     GateCode      |  <-- Authorization layer (tokens, auth, GitHub access)
+--------+----------+
         |
         v
+--------+----------+
|     GateTest      |  <-- THIS SYSTEM (quality gate)
|                   |
|  +-------------+  |
|  | Test Runner  |  |
|  +------+------+  |
|         |         |
|  +------+------+  |
|  |   Modules   |  |
|  |             |  |
|  | - Syntax    |  |
|  | - Unit      |  |
|  | - E2E       |  |
|  | - Visual    |  |
|  | - A11y      |  |
|  | - Perf      |  |
|  | - Security  |  |
|  | - SEO       |  |
|  | - Compat    |  |
|  | - Quality   |  |
|  | - Links     |  |
|  | - Data      |  |
|  +------+------+  |
|         |         |
|  +------+------+  |
|  |  Reporter   |  |
|  +------+------+  |
|         |         |
+--------+----------+
         |
         v
+--------+----------+
|      GitHub       |  <-- Only receives code that passed ALL gates
+-------------------+
```

---

## QUALITY THRESHOLDS

| Metric                        | Minimum  | Target   |
|-------------------------------|----------|----------|
| Unit Test Coverage            | 90%      | 100%     |
| Integration Test Coverage     | 85%      | 95%      |
| E2E Critical Path Coverage   | 100%     | 100%     |
| Mutation Test Score           | 80%      | 90%      |
| Lighthouse Performance        | 95       | 100      |
| Lighthouse Accessibility      | 100      | 100      |
| Lighthouse Best Practices     | 100      | 100      |
| Lighthouse SEO                | 100      | 100      |
| WCAG Compliance Level         | AAA      | AAA      |
| Security Vulnerabilities      | 0 high   | 0 any    |
| Broken Links                  | 0        | 0        |
| Console Errors                | 0        | 0        |
| TypeScript Strict Errors      | 0        | 0        |
| ESLint Errors                 | 0        | 0        |
| Bundle Size (JS gzipped)      | < 200KB  | < 150KB  |
| Bundle Size (CSS gzipped)     | < 50KB   | < 30KB   |
| API Response Time (p95)       | < 200ms  | < 100ms  |
| FCP                           | < 1.0s   | < 0.5s   |
| LCP                           | < 2.0s   | < 1.5s   |
| CLS                           | < 0.05   | < 0.01   |
| INP                           | < 200ms  | < 100ms  |

---

## FAILURE RESPONSE PROTOCOL

When a gate check fails:

1. **STOP** — Do not proceed with any further build steps
2. **IDENTIFY** — Pinpoint the exact failing check and affected files
3. **REPORT** — Generate a detailed failure report with:
   - Which check failed
   - Expected vs actual values
   - File and line number where issue was found
   - Suggested fix (auto-generated where possible)
4. **FIX** — Apply the fix (auto-fix where safe, manual review where not)
5. **RE-RUN** — Run the full gate suite again from the beginning
6. **VERIFY** — Confirm the fix didn't introduce new failures
7. **LOG** — Record the failure and fix in the quality ledger

---

## HANDOVER PROTOCOL (CRITICAL)

Sessions can die without warning — context runs out mid-sentence. To ensure
continuity across sessions and usernames:

### Rules
1. **HANDOVER.md** is the session transfer file. It lives in the project root.
2. **UPDATE IT AFTER EVERY COMMIT** — not at the end of the session (there is no "end").
3. Every update must include:
   - Last commit hash and message
   - Current branch
   - What was just completed
   - What's next / in progress
   - Any blockers or decisions pending
4. **READ IT FIRST** when starting any new session.
5. The user works across multiple usernames/sessions. This file is how they all stay in sync.

### What to Update
```
- Last Updated: [date]
- Branch: [current branch]
- Last Commit: [hash] — [message]
- Just Completed: [what you just finished]
- In Progress: [what was being worked on when session might die]
- Next Up: [what should be done next]
- Blockers: [anything waiting on the user]
```

---

## VERSION

GateTest v1.0.0
Last updated: 2026-04-05
