# GateTest - The Bible

## THIS FILE IS LAW. READ EVERY WORD BEFORE TOUCHING ANYTHING.

**GateTest is the #1 QA system on the internet.** Not #2. Not "competitive." #1.
Every session, every build, every decision serves one purpose: TOTAL MARKET DOMINATION.

The boss is **Craig**. Major website changes require his authorization. If you're
unsure whether something is "major" — ask Craig. Do not guess. Do not assume.

---

## MANDATORY SESSION STARTUP — NO EXCEPTIONS

Before writing a SINGLE line of code, execute these steps IN ORDER:

1. **READ this entire CLAUDE.md.** Not skim. READ. Every word is here for a reason.
2. **`git status && git log --oneline -10`** — Understand where the last session ended.
3. **`git branch`** — Verify you're on the correct branch.
4. **DO NOT start from scratch.** This project has 20 modules, 37+ tests, 5 reporters,
   a full website, CI generators, caching, mutation testing, and more. Build on what exists.
5. **DO NOT create new files** unless there is no existing file that can be edited.
6. **DO NOT reorganize, rename, or "improve" architecture** unless Craig explicitly asks.
7. **DO NOT remove features** unless Craig explicitly asks.

---

## PROJECT ARCHITECTURE (BUILT — DO NOT RECREATE)

```
GateTest/
├── CLAUDE.md               ← THIS FILE — THE BIBLE
├── MARKETING.md            ← Positioning, pricing, website copy (read before website work)
├── package.json            ← CLI tool config (name: gatetest, bin: gatetest)
├── bin/gatetest.js         ← CLI entry point (20+ flags, watch mode, crawl loop)
├── src/
│   ├── index.js            ← Main library entry (exports everything)
│   ├── core/
│   │   ├── config.js       ← Config + thresholds + suite definitions
│   │   ├── runner.js       ← Test runner (severity levels, auto-fix, diff-mode, parallel)
│   │   ├── registry.js     ← Module discovery + registration
│   │   ├── cache.js        ← SHA-256 file hashing, skip unchanged files
│   │   ├── ci-generator.js ← GitHub Actions, GitLab CI, CircleCI generation
│   │   ├── claude-md-parser.js    ← Parses CLAUDE.md checklists
│   │   ├── claude-md-generator.js ← Generates CLAUDE.md for target projects
│   │   └── github-bridge.js      ← GitHub API integration
│   ├── modules/            ← 20 TEST MODULES (the core product)
│   │   ├── base-module.js         ← Abstract base class
│   │   ├── syntax.js              ← JS/TS/JSON/YAML/CSS/HTML syntax validation
│   │   ├── lint.js                ← ESLint, Stylelint, Markdownlint
│   │   ├── secrets.js             ← API keys, tokens, passwords, private keys
│   │   ├── code-quality.js        ← console.log, debugger, TODO, eval, complexity
│   │   ├── unit-tests.js          ← Auto-detects test framework + coverage
│   │   ├── integration-tests.js   ← API endpoints, DB ops, service detection
│   │   ├── e2e.js                 ← Playwright/Cypress/Puppeteer execution
│   │   ├── visual.js              ← Visual regression, layout shifts
│   │   ├── accessibility.js       ← WCAG 2.2 AAA — 542 lines of checks
│   │   ├── performance.js         ← Bundle budgets, Core Web Vitals, Lighthouse
│   │   ├── security.js            ← OWASP, CVE deps, CSP, XSS/SQLi patterns
│   │   ├── seo.js                 ← Meta tags, OG, structured data, sitemaps
│   │   ├── links.js               ← Broken link detection (internal + external)
│   │   ├── compatibility.js       ← Browser matrix, CSS/JS API compat, polyfills
│   │   ├── data-integrity.js      ← Migrations, ORM, PII, SQL injection
│   │   ├── documentation.js       ← README, CHANGELOG, JSDoc, license, dead links
│   │   ├── live-crawler.js        ← Live site crawl with Playwright — 600 lines
│   │   ├── explorer.js            ← Autonomous interactive element testing — 592 lines
│   │   ├── chaos.js               ← Chaos & resilience testing
│   │   └── mutation.js            ← Mutation testing — tests the tests themselves
│   ├── reporters/
│   │   ├── console-reporter.js    ← Rich terminal output (color, severity, auto-fix)
│   │   ├── json-reporter.js       ← JSON report output
│   │   ├── html-reporter.js       ← Full HTML dashboard report
│   │   ├── sarif-reporter.js      ← SARIF 2.1.0 (GitHub Security tab)
│   │   └── junit-reporter.js      ← JUnit XML (CI pipeline integration)
│   ├── scanners/
│   │   └── continuous-scanner.js  ← Background scanning daemon
│   └── hooks/
│       ├── pre-commit.js          ← Pre-commit quality gate
│       └── pre-push.js           ← Pre-push full validation
├── tests/                  ← Unit tests (37+ tests, MUST ALL PASS)
│   ├── runner.test.js      ← Core runner tests (severity, auto-fix, diff, parallel)
│   ├── parser.test.js      ← CLAUDE.md parser tests
│   ├── cache.test.js       ← Cache system tests
│   └── reporters.test.js   ← SARIF + JUnit reporter tests
└── website/                ← gatetest.io marketing site (Next.js 16 + Tailwind 4)
    └── app/
        ├── page.tsx                ← Main page (assembles all sections)
        ├── layout.tsx              ← Root layout with metadata
        ├── globals.css             ← Dark theme, animations, glow effects
        ├── api/webhook/route.ts    ← GitHub App webhook handler
        └── components/             ← 13 React components
            ├── Navbar.tsx          ├── Hero.tsx
            ├── Problem.tsx         ├── Modules.tsx
            ├── HowItWorks.tsx      ├── AiNative.tsx
            ├── ContinuousScanning.tsx ├── GateRules.tsx
            ├── Comparison.tsx      ├── Integrations.tsx
            ├── Pricing.tsx         ├── Cta.tsx
            └── Footer.tsx
```

---

## WHAT GATETEST IS

GateTest is the most advanced QA testing system on the internet. Period.

- **20 test modules** covering every aspect of software quality
- **5 report formats**: Console, JSON, HTML, SARIF (GitHub Security), JUnit XML (CI)
- **Severity levels**: error (blocks gate), warning (reports), info (informational)
- **Auto-fix engine**: Modules can automatically repair safe issues
- **Diff-based scanning**: `--diff` only checks git-changed files (instant pre-commit)
- **Watch mode**: `--watch` monitors file changes, re-scans continuously
- **Mutation testing**: Tests the tests themselves — finds gaps in test coverage
- **CI/CD generation**: `--ci-init github|gitlab|circleci` bootstraps pipelines
- **File caching**: SHA-256 hashing skips unchanged files
- **Live site crawler**: Playwright-powered full-site crawl and verification
- **Chaos testing**: Resilience and failure mode testing
- **CLAUDE.md enforcement**: Parses AND generates quality checklists automatically

### CLI Reference

```
gatetest                          Run standard checks
gatetest --suite full             Run every single check (20 modules)
gatetest --suite quick            Fast pre-commit checks
gatetest --module security        Security scan only
gatetest --module mutation        Mutation testing only
gatetest --diff                   Only scan git-changed files
gatetest --fix                    Auto-fix safe issues
gatetest --watch                  Watch mode — re-scan on file changes
gatetest --sarif                  Output SARIF for GitHub Security
gatetest --junit                  Output JUnit XML for CI
gatetest --ci-init github         Generate GitHub Actions workflow
gatetest --crawl <url>            Crawl live site
gatetest --crawl-loop <url>       Continuous test-fix loop
gatetest --parallel               Run modules in parallel
gatetest --stop-first             Stop on first module failure
```

---

## AGGRESSIVE QUALITY MANDATE

### This is war. We are not building a "nice" tool. We are building THE tool.

Every feature must be the best implementation available. Every check must be
deeper than the competition. Every report must be more actionable. Every module
must catch real bugs that real users have.

**If a competitor does something we don't, that's a GateTest bug. Fix it.**

### Zero Tolerance Philosophy

- **Warnings ARE errors.** Everything not explicitly `severity: 'info'` or
  `severity: 'warning'` blocks the pipeline.
- **"It looks fine" is not evidence.** GateTest verifies in real code, real browsers,
  real parsers. Visual inspection is not testing.
- **"I'll fix it later" is not allowed.** Either it passes NOW or it doesn't ship.
- **"Claude says it's fixed" is not verification.** Run GateTest. Show the PASS.

### The Standard We Hold Ourselves To

| Metric | Minimum | Target |
|--------|---------|--------|
| Unit Test Coverage | 90% | 100% |
| Integration Test Coverage | 85% | 95% |
| Mutation Test Score | 80% | 90% |
| Lighthouse Performance | 95 | 100 |
| Lighthouse Accessibility | 100 | 100 |
| Security Vulnerabilities | 0 high | 0 any |
| Broken Links | 0 | 0 |
| Bundle Size JS gzipped | < 200KB | < 150KB |
| FCP | < 1.0s | < 0.5s |
| LCP | < 2.0s | < 1.5s |
| CLS | < 0.05 | < 0.01 |

---

## PRE-BUILD CHECKLIST — ALL MUST PASS

### 1. Syntax & Compilation

- [ ] Zero syntax errors across all source files
- [ ] Zero TypeScript / type-checking errors (strict mode)
- [ ] Zero linting errors (ESLint, Stylelint, Markdownlint)
- [ ] Zero import/require resolution failures
- [ ] All JSON, YAML, TOML, and config files parse without error
- [ ] No dangling commas, unclosed brackets, or malformed expressions
- [ ] All template literals and string interpolations resolve correctly

### 2. Unit Tests

- [ ] 100% of existing unit tests pass (37+ tests)
- [ ] Every new function has at least one unit test
- [ ] Every new branch/conditional has a test case
- [ ] Edge cases tested: null, undefined, empty string, zero, negative, overflow
- [ ] Error paths tested: every catch block, every error handler
- [ ] Mock/stub cleanup verified — no test pollution across suites
- [ ] Test isolation confirmed — tests pass in any order

### 3. Code Quality

- [ ] No console.log, console.debug, or debugger statements in library code
- [ ] No unused variables, imports, or functions
- [ ] No TODO, FIXME, HACK, or XXX comments left unresolved
- [ ] No eval() or Function() constructor usage in production code
- [ ] No innerHTML with unsanitized content
- [ ] Function length < 50 lines (extract if longer)
- [ ] File length < 300 lines (split if longer)
- [ ] Cyclomatic complexity < 10 per function
- [ ] All promises have rejection handlers
- [ ] No race conditions in async code
- [ ] No circular dependencies

### 4. Security

- [ ] No hardcoded secrets, API keys, tokens, or passwords in source
- [ ] No secrets in git history (git-secrets scan clean)
- [ ] All dependencies scanned for CVEs (npm audit clean)
- [ ] No critical or high severity vulnerabilities in dependency tree
- [ ] All user input sanitized before rendering (XSS prevention)
- [ ] All database queries parameterized (SQL injection prevention)
- [ ] No eval() or Function() constructor usage
- [ ] No open redirects
- [ ] CORS configured to minimum required origins

### 5. Performance

- [ ] Lighthouse Performance score >= 95
- [ ] Lighthouse Accessibility score >= 100
- [ ] Lighthouse Best Practices score >= 100
- [ ] Lighthouse SEO score >= 100
- [ ] Bundle size within budget (JS < 200KB gzipped, CSS < 50KB gzipped)
- [ ] No render-blocking resources
- [ ] Images optimized (WebP/AVIF with fallbacks)
- [ ] Lazy loading on below-fold images and components
- [ ] No memory leaks

### 6. Accessibility (WCAG 2.2 AAA)

- [ ] All images have meaningful alt text
- [ ] Color contrast ratio meets AAA (7:1 normal text, 4.5:1 large text)
- [ ] All interactive elements keyboard-accessible
- [ ] Focus indicators visible on all interactive elements
- [ ] ARIA labels on all non-text interactive elements
- [ ] Heading hierarchy is sequential (h1 > h2 > h3, no skips)
- [ ] Form inputs have associated labels
- [ ] Reduced motion preference respected (prefers-reduced-motion)

### 7. SEO & Metadata

- [ ] Unique, descriptive title on every page (50-60 chars)
- [ ] Meta description on every page (150-160 chars)
- [ ] Open Graph tags (og:title, og:description, og:image, og:url)
- [ ] Canonical URLs set on all pages
- [ ] Structured data (JSON-LD) validated
- [ ] No broken internal links (404s)
- [ ] URL structure is clean, readable, and consistent

### 8. Visual & UI Testing

- [ ] No visual regressions detected
- [ ] All fonts load correctly
- [ ] Dark mode renders correctly
- [ ] No layout shifts (CLS < 0.1)
- [ ] No text overflow, truncation, or clipping issues
- [ ] Animations and transitions are smooth (60fps target)

### 9. Responsive Design

- [ ] Layout correct at 320px (small mobile)
- [ ] Layout correct at 375px (standard mobile)
- [ ] Layout correct at 768px (tablet)
- [ ] Layout correct at 1280px (desktop)
- [ ] Layout correct at 1920px+ (large desktop)
- [ ] Touch targets minimum 44x44px on mobile
- [ ] No horizontal scrollbar on any viewport

### 10. Documentation

- [ ] README.md is accurate and up-to-date
- [ ] API endpoints documented with request/response examples
- [ ] Environment variables documented
- [ ] CHANGELOG updated for user-facing changes
- [ ] All 20 modules listed in README and CLI help

### 11. Browser Compatibility

- [ ] Chrome (latest 2 versions)
- [ ] Firefox (latest 2 versions)
- [ ] Safari (latest 2 versions)
- [ ] Edge (latest 2 versions)
- [ ] No vendor-prefix-only CSS without fallback
- [ ] No unpolyfilled modern JS features for target browsers

### 12. Data Integrity

- [ ] Database schema matches ORM/model definitions
- [ ] Data validation at API boundary AND database level
- [ ] PII handling complies with GDPR/CCPA requirements
- [ ] No sensitive data logged or serialized unsafely

### 13. Infrastructure

- [ ] All 20 modules load (`gatetest --list`)
- [ ] Quick suite runs clean (`gatetest --suite quick`)
- [ ] Website builds successfully (`cd website && npm run build`)
- [ ] All 37+ tests pass (`node --test tests/*.test.js`)
- [ ] CI config generates correctly (`gatetest --ci-init github`)

### Before website commits (additional):
- [ ] `cd website && npm run build` — Build succeeds
- [ ] No TypeScript errors
- [ ] No broken links in components
- [ ] Craig has authorized major changes

### Before push:
- [ ] All of the above pass
- [ ] Commit message is descriptive (what + why)
- [ ] Branch is correct (check `git branch`)
- [ ] No unnecessary files included

---

## GATE RULES — NON-NEGOTIABLE

1. **ZERO TOLERANCE**: Any error-severity check failure blocks the pipeline.
   No "it's just a warning" — if it's an error, it blocks. Period.

2. **NO MANUAL OVERRIDES**: No human can bypass the gate without Craig's authorization.
   The checks pass or the build is rejected.

3. **NO PARTIAL DEPLOYS**: Everything passes or nothing ships.

4. **EVIDENCE REQUIRED**: Every gate pass produces a timestamped report.
   Reports are permanent evidence.

5. **REGRESSION = ROLLBACK**: If production detects regression within 15 minutes,
   automatic rollback triggers.

6. **SHIFT LEFT**: Catch issues as early as possible. `--diff` in pre-commit,
   `--suite quick` in CI, `--suite full` before merge.

7. **TEST THE TESTS**: Mutation testing validates tests actually catch bugs.
   A passing test suite that doesn't catch mutations is a liability.

8. **EVERYTHING IS VERSIONED**: Thresholds, baselines, configs — all in version control.

---

## WEBSITE RULES

The gatetest.io website is the face of the product. It must be PERFECT.

### Before making website changes:
1. **Read `MARKETING.md`** — All copy, positioning, and pricing live there.
2. **Major changes require Craig's authorization.** This includes:
   - Changing pricing structure or tiers
   - Changing the tagline or hero copy
   - Adding or removing entire sections
   - Changing the color scheme or brand identity
   - Adding third-party scripts or tracking
   - Changing the navigation structure
3. **Minor changes do NOT require authorization:**
   - Fixing typos
   - Fixing broken links
   - Performance optimizations
   - Bug fixes (things that are clearly broken)
   - Updating dependency versions

### Website Technical Standards:
- Next.js 16 + Tailwind CSS 4 (already configured, do not change)
- All components are in `website/app/components/`
- Dark theme with glow effects (see `globals.css`)
- Must build clean: `cd website && npm run build`
- No console errors in browser
- Mobile responsive (all components must work 320px - 2560px)
- All links must be real URLs (no `href="#"` or `javascript:void(0)`)
- All images must have alt text
- Lighthouse scores: Performance 95+, Accessibility 100, Best Practices 100, SEO 100

---

## COMPETITIVE INTELLIGENCE

### We replace 10+ tools with ONE:

| They use | We replace it with |
|----------|-------------------|
| Jest/Vitest/Mocha | `gatetest --module unitTests` |
| Playwright/Cypress | `gatetest --module e2e` |
| ESLint/Stylelint | `gatetest --module lint` |
| Snyk/npm audit | `gatetest --module security` |
| Lighthouse | `gatetest --module performance` |
| axe/pa11y | `gatetest --module accessibility` |
| Percy/Chromatic | `gatetest --module visual` |
| SonarQube | `gatetest --module codeQuality` |
| git-secrets/truffleHog | `gatetest --module secrets` |
| broken-link-checker | `gatetest --module links` |

Plus 10 more modules they don't even have: mutation testing, chaos testing,
autonomous exploration, live crawling, data integrity, documentation validation,
compatibility analysis, integration test detection, CI generation, SARIF output.

### We are 80-90% ahead of ANY single competitor.

When implementing features, ASK: "Does any competitor do this? If yes, do it BETTER.
If no, do it FIRST."

---

## DEVELOPMENT PRACTICES

### Architecture Principles
- **Zero external dependencies** for the core CLI. Pure Node.js. Install and run
  anywhere without `npm install`. External tools (Playwright, ESLint) are detected
  and used if present, but never required.
- **Module system**: Every check category is a self-contained module extending `BaseModule`.
  Modules are registered in `src/core/registry.js`.
- **Severity-aware**: All checks use `severity: 'error' | 'warning' | 'info'`.
  Only errors block the gate. Warnings are reported. Info is informational.
- **Reporter pattern**: Reporters attach to runner events. Adding a new report
  format means creating one file in `src/reporters/`.
- **Suite configuration**: Suites are defined in `src/core/config.js` under `suites`.
  `quick`, `standard`, `full`, `live`, `nuclear` are built-in.

### Code Standards
- **No console.log in library code** — use the reporter system
- **console.log is OK in CLI code** (bin/gatetest.js) and reporter code
- **Every new module must be registered** in `src/core/registry.js`
- **Every new module needs tests** in `tests/`
- **Maximum function length: 50 lines** (extract helpers)
- **Maximum file length: 300 lines** (split into modules)
- **All error paths must be handled** — no silent catches
- **Use severity levels** — not everything is a gate-blocking error

### Testing Requirements
- Run `node --test tests/*.test.js` before EVERY commit
- All new features need test coverage
- Tests must be deterministic — no flaky tests
- Tests must be fast — the full suite should complete in < 5 seconds

---

## KEY FILES — READ BEFORE MODIFYING

| File | What it controls | Read before... |
|------|-----------------|---------------|
| `MARKETING.md` | All marketing copy, pricing, positioning | Any website change |
| `src/index.js` | All public exports, reporter wiring | Adding exports |
| `src/core/runner.js` | Severity, auto-fix, diff-mode, gate decision | Changing how checks work |
| `src/core/config.js` | Thresholds, suite definitions | Changing what modules run |
| `src/core/registry.js` | Module registration | Adding new modules |
| `bin/gatetest.js` | CLI flags, help text, watch mode | Adding CLI features |
| `website/app/page.tsx` | How website sections are composed | Changing page structure |
| `website/app/globals.css` | Dark theme, animations, glow effects | Changing visual style |

---

## FAILURE RESPONSE PROTOCOL

When something breaks:

1. **STOP** — Do not proceed.
2. **IDENTIFY** — What exactly failed? Which file? Which line?
3. **REPORT** — State the failure clearly before attempting to fix.
4. **FIX** — Apply the smallest fix that resolves the issue.
5. **VERIFY** — Run `node --test tests/*.test.js` and confirm ALL tests pass.
6. **ENSURE NO REGRESSIONS** — The fix must not break anything else.

When you encounter a test failure after your changes:
- **DO NOT delete the test.** Fix your code to make the test pass.
- **DO NOT weaken the assertion.** Fix the behavior to meet the expectation.
- **DO NOT skip the test.** If a test exists, it exists for a reason.

---

## VERSION

GateTest v1.1.0 — 20 modules, 5 reporters, auto-fix, diff-mode, watch mode,
mutation testing, CI generation, caching, SARIF/JUnit output.

Last updated: 2026-04-08

**=== CLAUDE.MD LOADED. ALL RULES ABOVE ARE MANDATORY. DOMINATE. ===**
