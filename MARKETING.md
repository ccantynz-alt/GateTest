# GateTest Marketing & Positioning

This document captures the core messaging, competitive positioning, and sales
strategy for GateTest. This is the source of truth for all marketing materials,
the gatetest.io website, and investor communications.

---

## Tagline

**"AI writes fast. GateTest keeps it honest."**

## One-liner

GateTest is the advanced QA gate between AI and GitHub. Nothing ships unless it's pristine.

## Elevator pitch

Every company building with AI is duct-taping 8-10 separate testing tools together —
Playwright for E2E, Jest for unit tests, Snyk for security, Lighthouse for performance,
axe for accessibility, Percy for visual regression, ESLint for linting, git-secrets for
credentials. Different configs, different dashboards, different billing.

GateTest replaces that entire stack with one system, one config file, one report, and
one gate decision: PASS or BLOCKED.

It's the first QA system built specifically for AI-generated code — catching the exact
patterns AI gets wrong before they touch production.

---

## Competitive Positioning

### The market today (fragmented, single-purpose tools)

| Tool | What it does | Categories covered |
|------|-------------|-------------------|
| Playwright | Browser E2E testing only | ~1 |
| Cypress | Browser E2E testing only | ~1 |
| Jest | Unit tests only | ~1 |
| ESLint | Linting only | ~1 |
| Lighthouse | Performance + SEO + A11y | ~4 |
| Snyk | Security/dependency scanning | ~1 |
| Percy | Visual regression only | ~1 |
| axe | Accessibility only | ~1 |
| SonarQube | Code quality + some security | ~3 |

### GateTest (unified, 16 modules, one gate)

| Module | Coverage |
|--------|----------|
| syntax | JS/TS/JSON compilation, zero errors |
| lint | ESLint, Stylelint, Markdownlint |
| secrets | API keys, tokens, passwords, private keys |
| codeQuality | console.log, debugger, TODO, eval, complexity |
| unitTests | Auto-detects Jest/Vitest/Mocha, coverage thresholds |
| integrationTests | API & service integration tests |
| e2e | Playwright/Cypress/Puppeteer integration |
| visual | Layout shifts, fonts, z-index, design tokens, viewports |
| accessibility | WCAG 2.2 AAA — alt text, ARIA, focus, contrast |
| performance | Bundle budgets, Core Web Vitals, Lighthouse scores |
| security | OWASP patterns, dependency CVEs, CSP, XSS/SQLi |
| seo | Meta tags, Open Graph, sitemaps, structured data |
| links | Broken internal + external link detection |
| compatibility | Browser matrix validation, modern API polyfill checks |
| dataIntegrity | Database schema, migrations, PII handling |
| documentation | README, CHANGELOG, env docs completeness |

### Key differentiators

1. **16x the surface area** — No single competitor covers more than 4 categories.
   GateTest covers 16. One tool replaces the entire testing toolchain.

2. **AI-native QA** — The first quality gate built for the AI coding era. Catches
   the specific patterns AI gets wrong:
   - Hallucinated imports
   - console.log/debugger statements left behind
   - Hardcoded API keys in generated code
   - Missing error handling
   - Incomplete accessibility
   - Memory leaks (forgotten cleanup, dangling event listeners)
   - Broken internal links from AI refactoring

3. **Zero-tolerance enforcement** — Not warnings. Not suggestions. Pipeline blocking.
   One failure in any of the 16 modules = entire build blocked. No overrides.

4. **One system, one report, one decision** — No more juggling 10 dashboards.
   PASS or BLOCKED. That's it.

5. **Continuous scanning** — GateTest doesn't sleep. Background scanners monitor
   dependencies, CVEs, uptime, performance baselines, and security headers 24/7.

6. **CLAUDE.md as single source of truth** — All quality thresholds, checklists,
   and gate rules live in one human-readable file that's enforced automatically.

7. **80-90% ahead of any single competitor** — Because we cover 16x the scope.

---

## Target audience

### Primary: AI-assisted development teams
- Teams using Claude, Copilot, Cursor, or any AI coding assistant
- AI generates code fast but introduces quality gaps
- GateTest is the safety net between AI output and production

### Secondary: Quality-conscious engineering teams
- Teams tired of managing 8-10 separate testing tools
- Teams that need compliance evidence (SOC2, HIPAA, PCI-DSS)
- Teams shipping to regulated industries

### Tertiary: Solo developers and indie hackers
- Ship confidently without a QA team
- Free CLI tier = zero cost to get started

---

## Revenue model

### Phase 1: Free CLI (adoption engine) — NOW
- Open source CLI runs on user's machine
- Zero cost to us, zero cost to users
- Builds community and brand recognition

### Phase 2: Revenue before infrastructure — NEXT
- **Premium compliance modules**: HIPAA, SOC2, PCI-DSS packs ($49-199/month)
- **Consulting/setup**: Configure GateTest for enterprise CI/CD ($500+)
- **Priority support**: Direct support channel ($29/month)
- Near-zero overhead — revenue with almost no costs

### Phase 3: Cloud platform (gatetest.io) — WHEN REVENUE JUSTIFIES IT
- Managed continuous scanning (no self-hosting)
- Historical dashboards with trend analytics
- Team features: shared baselines, approval workflows, audit trails
- Cross-project benchmarking
- AI-powered fix suggestions
- GitHub App: auto-comments on PRs with gate status
- Slack/Teams alert integration
- Pricing: $49/month per team — 2 customers = profitable

### Key principle
**Never spend money before it's earned.** CLI is free and costs nothing.
Premium modules generate revenue first. Cloud platform comes only when
the money is flowing.

---

## Why people pay when free alternatives exist

People don't pay for code. They pay for:

1. **Not running it themselves** — Self-hosting costs engineering time.
   A startup with 5 devs would rather pay $50/month than spend 2 days
   on infrastructure. That dev time costs them $2,000+.

2. **The dashboard, not the CLI** — Trends over time. "Your bundle size
   grew 15% this month." "Accessibility score dropped after Tuesday."
   "3 new CVEs hit your deps overnight." Intelligence > raw output.

3. **Team features** — Shared baselines, PR integrations, approval
   workflows, audit trails, role-based access. Solo = free CLI.
   Team of 20 = paid platform.

4. **Compliance evidence** — SOC2 auditors don't accept "we run a script."
   They want timestamped reports, retention policies, audit logs.

5. **Continuous scanning** — Someone has to run the 24/7 scanner. Most
   teams don't want to manage that. "We'll run it for you" = money.

### Proof this model works
- GitHub charges $21/user/month — Git is free
- Slack makes billions — IRC/Discord are free
- Datadog is worth $30B — Grafana is free
- Vercel charges — self-hosting Next.js is free
- Snyk charges — npm audit is free

---

## Website copy (gatetest.io)

### Hero section
**Headline**: "AI writes fast. GateTest keeps it honest."
**Subhead**: The advanced QA gate that sits between AI and GitHub. 16 test modules.
One gate. Nothing ships unless it's pristine.
**CTA**: "Get Started Free" / "View on GitHub"

### How it works section
1. **CLAUDE.md** — Define your quality standards in one file
2. **GateTest runs** — 16 modules check everything: security, accessibility,
   performance, SEO, visual regression, code quality, and more
3. **Gate decides** — PASS or BLOCKED. No grey area. No "ship it anyway."

### The problem section
"Your team uses 8-10 separate tools for testing. Different configs. Different
dashboards. Different billing. Things slip through the cracks. GateTest
replaces them all with one unified quality gate."

### Built for AI section
"AI coding assistants write code 10x faster — but they also introduce
hallucinated imports, forgotten cleanup, hardcoded secrets, and incomplete
accessibility. GateTest catches every one of these before it reaches GitHub."

### Comparison section
(Use the competitive positioning table from above)

### Pricing section
- **Free**: CLI, all 16 modules, unlimited local runs
- **Pro** ($49/month): Cloud dashboard, historical reports, team features
- **Enterprise** (custom): Compliance modules, SSO, audit logs, SLA

---

## Brand voice

- Confident but not arrogant
- Technical but accessible
- Zero-bullshit — say what it does, not what it "empowers" or "leverages"
- Short sentences. Direct. Like this.

---

## Domain

**gatetest.io** — secured.

---

## Version

Marketing doc v1.0.0
Last updated: 2026-04-05
