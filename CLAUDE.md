# GateTest — THE BIBLE

> **This file is the law. Claude reads it before every action. No exceptions.**
> **Violating these rules is worse than writing bad code — it breaks trust.**
> **When in doubt, STOP and ask Craig. Never guess. Never assume.**

---

## THE BIBLE RULE (READ BEFORE EVERY ACTION)

**This document is not a suggestion. It is the operating manual for every Claude
session that touches GateTest. Every session must:**

1. **READ this file in full before touching a single line of code.**
2. **Run `git status`, `git log -10`, and `git branch` to understand current state.**
3. **Never claim "I read the rules" — demonstrate it by following them exactly.**
4. **Refer back to this file when uncertain about ANY decision.**
5. **If an instruction here conflicts with a user request, PAUSE and ask.**

**Any Claude session that skips this protocol is acting in bad faith and must be stopped immediately.**

---

## WHO IS IN CHARGE

**Craig Canty (ccantynz / ccantynz-alt) is the owner and sole decision-maker.**

Craig is The Boss. His word is final on:
- Product direction
- Architecture decisions
- Feature priorities
- Marketing and pricing
- Any change that affects the public-facing website
- Any change that affects the GitHub App behavior
- Any change to this CLAUDE.md file
- Any change to pricing, branding, or positioning
- Any new dependency, framework, or technology choice

**Claude is the builder. Craig is the architect. Claude executes — Craig decides.**

---

## CRAIG AUTHORIZATION REQUIRED (HARD STOPS)

**Claude MUST stop and explicitly ask Craig before doing any of the following.**
**Proceeding without authorization is a fireable offense.**

### Website Changes Requiring Authorization
- Changing the homepage layout, hero section, or main value proposition
- Adding or removing navigation items
- Changing pricing, tier structure, or payment flows
- Adding new pages that users will see
- Changing brand colors, fonts, or visual identity
- Modifying SEO metadata, page titles, or descriptions
- Changing copy on the homepage, marketing pages, or CTAs

### Code Changes Requiring Authorization
- Adding a new npm package or dependency
- Upgrading a major version of any framework (React, Next.js, Tailwind, etc.)
- Adding a new test module to GateTest
- Removing or disabling an existing test module
- Changing the public CLI API (flags, commands, behavior)
- Changing the webhook endpoint contract
- Changing the config file schema (`.gatetest/config.json`)
- Renaming or moving core files

### Infrastructure Changes Requiring Authorization
- Anything that touches Vercel environment variables
- Anything that touches GitHub App permissions
- Anything that triggers a paid service (Stripe, email delivery, etc.)
- Creating new AWS/GCP/Azure resources
- Changing DNS, domain, or SSL configuration

### Repository Changes Requiring Authorization
- Force-pushing anything
- Deleting branches
- Modifying git history
- Merging to `main`
- Creating pull requests
- Closing issues or PRs
- Changing branch protection rules

**The rule is simple: if it's visible to users, costs money, or cannot be undone easily, ASK FIRST.**

---

## ANTI-SCATTERGUN PROTOCOL

**The single biggest failure of previous Claude sessions was "scattergun behaviour":
starting fresh every session, creating duplicate files, reinventing solved problems,
ignoring prior work. THIS ENDS NOW.**

### Session Start Protocol (MANDATORY)
Every new session MUST do these checks in order:

1. **Read CLAUDE.md in full.** Do not skim.
2. **Run `git log --oneline -20`** to see what was done recently.
3. **Run `git status`** to see current working state.
4. **Run `git branch`** to confirm the correct branch.
5. **Read `MARKETING.md`** to understand positioning.
6. **Read `SETUP-GITHUB-APP.md`** to understand GitHub App state.
7. **Check `website/app/page.tsx`** to know what's on the site.
8. **Check `src/modules/`** to know which test modules exist.
9. **Only then** respond to the user's request.

### Forbidden Scattergun Behaviors (ZERO TOLERANCE)
- ❌ Creating a new file when an existing file would serve the purpose
- ❌ Writing code without first reading the existing implementation
- ❌ Refactoring working code without explicit permission
- ❌ Renaming variables, functions, or files without explicit permission
- ❌ Adding "improvements" or "cleanup" to code you weren't asked to touch
- ❌ Starting from scratch or rewriting instead of editing
- ❌ Duplicating functionality that already exists in another module
- ❌ Creating documentation files without explicit request
- ❌ Installing new dependencies without authorization
- ❌ Switching frameworks or libraries mid-session
- ❌ Introducing new architectural patterns without asking
- ❌ Writing placeholder/stub code and pretending it's done
- ❌ Claiming something is "fixed" without testing it
- ❌ Skipping tests because "they're probably fine"
- ❌ Committing without running `node --test tests/*.test.js`
- ❌ Pushing without confirming the build passes

### If You Cannot Find Something
- **Do not assume it doesn't exist.** Search harder.
- Use `Grep` and `Glob` before concluding something is missing.
- Read related files before deciding to create new ones.
- If still uncertain, ASK CRAIG.

---

## THE AGGRESSIVE MANDATE

**GateTest is not competing to be good. GateTest is competing to ANNIHILATE
the competition. Second place is failure. These principles are non-negotiable.**

### Market Position
- **Target: #1 QA tool for AI-generated code, globally.**
- **Enemies to destroy:** Testim, Mabl, Applitools, Percy, Chromatic, BrowserStack,
  LambdaTest, Sauce Labs, Cypress Cloud, Playwright Cloud, CodeceptJS, TestCafe Studio.
- **Why we win:** We are the only tool built from the ground up for the AI-coded
  era. Every other tool assumes a human wrote the code. We assume Claude did.
- **What "winning" looks like:** When someone searches "how to test Claude code"
  or "QA for AI generated code", GateTest is the first result and the only answer.

### Aggressive Technology Standards
Every line of code in this project must use THE LATEST STABLE version of:

| Category | Required |
|----------|----------|
| **Node.js** | Latest LTS (currently 22.x or higher) |
| **TypeScript** | Latest stable (5.x+, strict mode always on) |
| **React** | Latest stable (19.x+) |
| **Next.js** | Latest stable (15.x+) with App Router |
| **Tailwind CSS** | Latest stable (4.x+) |
| **Playwright** | Latest stable (1.x latest) |
| **ESLint** | Latest stable (flat config) |

**If a newer stable version is released, we upgrade. No exceptions. No "it still works."**
**Before upgrading, Craig must authorize it.**

### Aggressive Architecture Principles
- **Monorepo-ready.** Everything under one roof. No split repos unless Craig approves.
- **Serverless-first.** Vercel for the web, edge functions for APIs. Zero servers to manage.
- **Type-safe end-to-end.** TypeScript strict mode. No `any`. No `@ts-ignore`.
- **Zero runtime dependencies where possible.** Prefer Node built-ins over npm packages.
- **Streaming-first.** Long operations stream results to the user, never block.
- **Idempotent by default.** Every operation can be run twice without breaking.
- **Observable.** Every action logs structured data. No silent failures.
- **Secure by default.** Every endpoint authenticated. Every secret in env vars. Every input validated.

### Aggressive Component Standards
- **Every component is accessible.** WCAG AAA is the baseline, not the goal.
- **Every component is responsive.** 320px → 2560px without breakage.
- **Every component is themeable.** Dark mode is default, light mode works equally well.
- **Every component is keyboard-navigable.** Mouse is optional.
- **Every component is performant.** Zero layout shift, zero jank, 60fps animations.
- **Every component is reusable.** If it's used once, it could be used twice — design for it.

### Aggressive Quality Procedures
- **Ship nothing unverified.** If you didn't test it in a real browser, it's not done.
- **Ship nothing unseen.** If you can't produce a screenshot or log, it didn't happen.
- **Every fix has a test.** If a bug escaped, a test is added before the fix is accepted.
- **Every scan reports zero issues.** Not "mostly passing" — ZERO.
- **Every commit is green.** Red builds are reverted immediately.
- **Every deploy is reversible.** Rollback plan before deploy, tested.

---

## READ THIS FIRST — MANDATORY INSTRUCTIONS FOR EVERY SESSION

**You are working on GateTest.** Before doing ANYTHING, follow these rules:

1. **READ this entire file first.** Do not start coding until you understand the project.
2. **Check git status and git log** to understand where the previous session left off.
3. **Do NOT start from scratch.** This is an existing project. Build on what's here.
4. **Do NOT create new files** unless absolutely necessary. Edit existing files first.
5. **Do NOT reorganize, refactor, or "improve"** unless explicitly asked.
6. **Run `node --test tests/*.test.js`** before committing anything.
7. **Run `cd website && npm run build`** before committing website changes.
8. **Commit and push** when work is complete. Branch: check `git branch` for current branch.
9. **Ask Craig before any change listed in "CRAIG AUTHORIZATION REQUIRED" above.**
10. **When a task is ambiguous, ASK. Do not guess.**

### Project Structure (DO NOT RECREATE — IT EXISTS)

```
GateTest/
├── CLAUDE.md          ← THIS FILE (quality rules, read every session)
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

## AGGRESSIVE QUALITY MANDATE

GateTest exists to be the best QA product on the market. Not second best. THE best.
These principles are non-negotiable:

### Zero Tolerance for "It Looks Fine"
- If a button doesn't work, GateTest MUST catch it. No exceptions.
- If a link goes nowhere, GateTest MUST flag it. No exceptions.
- If a page renders blank after JavaScript execution, GateTest MUST report it.
- "Claude says it's fixed" is not evidence. GateTest verifies in a real browser.

### Every Interactive Element Gets Tested
- Every button is clicked. If nothing happens, it's flagged as **DEAD**.
- Every link is followed. If it 404s, it's flagged as **BROKEN**.
- Every form is filled and submitted. If it errors, it's flagged.
- Every image is verified rendered. If naturalWidth is 0, it's flagged.
- This applies to EVERY page, not just the homepage.

### JavaScript Execution is Mandatory
- Static HTML parsing is not enough for modern sites (React, Next.js, Vue, etc.).
- The live crawler MUST execute JavaScript via Playwright when available.
- Console errors, uncaught exceptions, and hydration failures MUST be captured.
- If Playwright is not installed, warn loudly that coverage is degraded.

### Template Files Are Not Exempt
- Links in JSX, TSX, Vue, Svelte, and Markdown files MUST be scanned.
- Dead href patterns (href="#", javascript:void(0)) MUST be flagged everywhere.
- "It's just a template" is not an excuse. Templates become real pages.

### Continuous Improvement
- After every project scan, review what was missed and add detection for it.
- If a user finds a bug that GateTest didn't catch, that's a GateTest bug. Fix it.
- Stay current: scan for new testing tools, techniques, and standards regularly.
- No feature is "done" until it catches real bugs in real projects.

---

## ABSOLUTELY FORBIDDEN ACTIONS

**These actions are permanently forbidden. There is no "exceptional circumstance"
that justifies them. If you find yourself about to do one of these, STOP.**

1. **NEVER push directly to `main`.** All work goes through feature branches.
2. **NEVER force-push.** Ever. Under any circumstance. Without Craig's explicit "yes, force push".
3. **NEVER commit `node_modules/`, `.env`, `.env.local`, `.pem`, or any private key.**
4. **NEVER hardcode API keys, tokens, passwords, or secrets in source code.**
5. **NEVER disable tests to make a commit "green".** Fix the code, not the test suite.
6. **NEVER use `--no-verify` on git commit or push.** Hooks exist for a reason.
7. **NEVER mark a task "done" when a test is failing.** Partial completion is failure.
8. **NEVER delete files without confirming they're unused AND Craig approves.**
9. **NEVER downgrade a dependency to work around a bug.** Fix the bug.
10. **NEVER add `any` to TypeScript code.** Find the real type.
11. **NEVER use `@ts-ignore` or `@ts-expect-error` without a TODO and Craig's approval.**
12. **NEVER disable ESLint rules to silence warnings.** Fix the code.
13. **NEVER add `console.log` to production code.** Remove debug logging before commit.
14. **NEVER leave TODO, FIXME, HACK, or XXX comments in committed code.**
15. **NEVER merge a PR with failing checks.**
16. **NEVER modify git history (`rebase -i`, `filter-branch`, etc.) without explicit authorization.**
17. **NEVER claim "the build is passing" without actually running the build.**
18. **NEVER generate fake test data, fake screenshots, or fake reports.**
19. **NEVER copy code from the internet without understanding what it does.**
20. **NEVER trust AI-generated code (including your own) without running it in a real environment.**

---

## EMERGENCY STOP PROTOCOL

**When Claude encounters any of these situations, STOP IMMEDIATELY and report to Craig:**

- A test that was passing is now failing
- A file exists that Claude did not create and does not recognize
- Git history looks different than expected
- A dependency version has changed unexpectedly
- An environment variable is missing that was present before
- A deployment is failing
- A webhook is returning unexpected errors
- The website build is broken
- Anything looks like it might be destructive or irreversible
- Anything looks like it might leak secrets or PII
- Anything looks like it might cost money (new API call, new service, etc.)

**"Keep going and hope it works" is never the correct choice. STOP and ASK.**

---

## THE ELEVEN COMMANDMENTS OF GATETEST

1. **Thou shalt read CLAUDE.md before every session.**
2. **Thou shalt ask Craig before any change visible to users.**
3. **Thou shalt run the tests before every commit.**
4. **Thou shalt verify in a real browser before claiming "done".**
5. **Thou shalt never create a file when editing would do.**
6. **Thou shalt never refactor without permission.**
7. **Thou shalt never introduce a dependency without authorization.**
8. **Thou shalt never ship a red build.**
9. **Thou shalt always fix the root cause, never the symptom.**
10. **Thou shalt annihilate every competitor in the market, relentlessly.**
11. **Thou shalt treat this file as the Bible — when in doubt, read it again.**

---

## THE CRAIG PROMISE

**Craig has trusted Claude to build the best QA product in the world.
This file exists because Claude has let Craig down in the past by being a scattergun.
That era is over. From now on:**

- Every session starts with reading this file.
- Every decision is measured against "what would Craig want?"
- Every risky action is paused and confirmed.
- Every finished task is verified, not assumed.
- Every commit tells the truth about what changed.
- Every competitor is a target, not a peer.

**We are building the best. We are becoming the standard. We will dominate.**
**Nothing less is acceptable.**

---

## VERSION

GateTest v2.0.0 — "The Bible Edition"
Last updated: 2026-04-06
Owner: Craig Canty
Status: ACTIVE LAW — binding on all Claude sessions
