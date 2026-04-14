# GATETEST — THE BIBLE

> **This document is the single source of truth for GateTest.**
> **Read it FIRST. Reference it ALWAYS. Violate it NEVER.**

---

## THE PRIME DIRECTIVE

**GateTest kills SonarQube. GateTest kills Snyk. GateTest kills every fragmented QA tool.**

Code quality has never been unified. Teams duct-tape 10+ tools together — different configs, different dashboards, different billing. We are the unification. There is no second place. We dominate or we die. Every line of code, every component, every decision, every commit must serve this mission.

**The standard:** 80-90% ahead of every competitor at all times. Not 10%. Not 30%. Eighty to ninety percent.

If a competitor closes the gap, we accelerate. If new technology threatens our lead, we absorb it. We are not in a race — we are lapping the field.

---

## THE BIBLE RULE

**Before ANY new build, ANY refactor, ANY significant change — READ THIS FILE FIRST.**

This file is read at the start of every session. It is referenced before every architectural decision. It is updated at the end of every session. No work happens outside the framework defined here.

**No scatter-gun. No drift. No "just this once." No chicken scratchings.** Every action ties back to this document.

---

## THE BOSS RULE — CRAIG MUST AUTHORIZE

The following actions require **explicit authorization from Craig BEFORE execution**:

1. **Major architectural changes** — swapping frameworks, changing core stack
2. **New dependencies not already approved** — we don't add bloat
3. **Pricing changes** — any modification to plans, tiers, or billing logic
4. **Domain or DNS changes** — anything touching gatetest.io
5. **Production deployments** — first-time deploy and any rollback
6. **Stripe configuration** — webhook URLs, price IDs, plan structures
7. **External API integrations** — adding new third-party services
8. **Brand/marketing changes** — copy on landing page, logos, taglines
9. **Anything that touches money, users' data, or public-facing communication**

**The rule:** When in doubt, ask Craig. Cost of asking = 30 seconds. Cost of acting wrong = days of damage.

**The exception:** Craig has pre-authorized continuous building of features within the existing build plan and stack. Routine code, bug fixes, refactors within the approved architecture, and committing/pushing to main do NOT require additional authorization.

---

## STRATEGIC DIRECTION — GLUECRON-FIRST (READ THIS EVERY SESSION)

**Gluecron.com is the future git host for Craig's stack.** GitHub is treated as a LEGACY integration, not the long-term target. Every architectural decision from this point forward must pass the question: *does this make the eventual GitHub → Gluecron migration easier or harder?*

Concretely:
- New cross-host logic belongs behind a **`HostBridge` abstraction**, not inside `github-bridge.js`.
- `github-bridge.js` is to be treated as one implementation of the bridge, not *the* bridge.
- A future `gluecron-bridge.js` will implement the same interface.
- Website copy, CLI help text, and docs should say **"git host"** where possible, not "GitHub."
- Any new GitHub-specific feature should ship with a `TODO(gluecron)` note identifying what needs a Gluecron equivalent.

**Authorization for this direction:** Granted by Craig — *"we need to integrate with Gluecron rather than putting all our time and effort into GitHub. GitHub is going to be obsolete."*

The `HostBridge` refactor is pre-authorized, but the actual Gluecron bridge implementation must wait until Gluecron's API surface is confirmed (don't build against guesses).

---

## PROTECTED PLATFORMS — PERMANENT INTEGRATIONS (READ THIS EVERY SESSION)

**GateTest protects the following Craig-owned platforms. These integrations are PERMANENT. They must survive every future Claude session. They cannot be removed, weakened, or "simplified" without Craig's explicit authorization.**

| Platform     | Repository                                         | Status     |
| ------------ | -------------------------------------------------- | ---------- |
| Crontech.ai  | https://github.com/ccantynz-alt/Crontech           | INTEGRATING |
| Gluecron.com | https://github.com/ccantynz-alt/Gluecron.com       | INTEGRATING |

### How the integration works

GateTest remains a **standalone subscription product** on gatetest.io. Protected platforms consume the same engine by cloning this repo at CI time — nothing is vendored, forked, or duplicated. Ship a fix here → every protected platform picks it up on the next CI run.

### What lives in THIS repo (`ccantynz-alt/gatetest`)

Under `integrations/`:
- `integrations/github-actions/gatetest-gate.yml` — drop-in CI workflow
- `integrations/husky/pre-push`                    — local pre-push hook
- `integrations/scripts/install.sh`                — one-command installer
- `integrations/README.md`                         — the integration spec

Guarded by:
- `tests/integrations.test.js` — fails the suite if any artifact is removed or weakened.

### What lives in a PROTECTED repo (e.g. Crontech, Gluecron)

After running the installer:
- `.github/workflows/gatetest-gate.yml` — the CI gate
- `.husky/pre-push`                      — the local gate
- `.gatetest.json`                       — the protection marker

### Install command (from the protected repo's root)

```bash
curl -sSL https://raw.githubusercontent.com/ccantynz-alt/gatetest/main/integrations/scripts/install.sh | bash
```

### Rules for every Claude session

1. Before touching `integrations/`, `tests/integrations.test.js`, or this section — **STOP** and check for Craig's authorization.
2. If a protected repo is missing its gate, the correct action is to **re-install**, never to remove the marker.
3. If `tests/integrations.test.js` fails, a previous session broke protection. **Restore it, do not delete the test.**
4. Adding a new protected platform: update the table above **and** add its repo to the installer docs.

---

## THE MISSION

Build the most advanced, most aggressive, most beautiful QA testing platform ever made. 35 modules. One gate. One decision. AI-powered code review that no competitor can match. Pay-on-completion pricing that eliminates customer risk. A scan experience so visually stunning that customers WANT to watch it run.

**The customer sees:** Their repo scanned by 35 modules in real time. Issues found. Issues fixed. Delivered.
**The competition sees:** A force they cannot match without rebuilding from scratch.
**Craig sees:** Recurring revenue with high margins on a moat that compounds over time.

---

## THE AGGRESSIVE STACK

Every tool here was chosen because it is the **best in its class right now.** If something better emerges, we replace it without sentiment.

### Core Engine
| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Node.js 20+ | Zero dependencies, runs anywhere |
| **Language** | JavaScript (core) + TypeScript (website) | Fast iteration, universal |
| **Architecture** | Module system extending BaseModule | Every check is a self-contained module |
| **Runner** | EventEmitter-based with severity levels | error/warning/info, parallel execution, auto-fix |
| **Reporters** | 5 formats (Console, JSON, HTML, SARIF, JUnit) | Covers every CI/CD system |

### Website & Frontend
| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | Latest, fastest, Vercel-native |
| **Styling** | Tailwind CSS 4 | Utility-first, dark theme, zero unused CSS |
| **Hosting** | Vercel | Auto-deploy from main, serverless |
| **Domain** | gatetest.io | Secured |

### Payments
| Layer | Choice | Why |
|---|---|---|
| **Billing** | Stripe | Hold-then-charge via Payment Intents with manual capture |
| **Model** | Pay on completion | Customer only charged after scan delivers |

### AI Layer
| Layer | Choice | Why |
|---|---|---|
| **AI Code Review** | Claude API (Anthropic) | Best reasoning, finds real bugs not patterns |
| **Model** | claude-sonnet-4-20250514 | Fast, accurate, cost-effective |

### GitHub Integration
| Layer | Choice | Why |
|---|---|---|
| **GitHub App** | GateTestHQ | Auto-scan on push/PR, commit statuses, PR comments |
| **Auth** | JWT (RS256) from .pem private key | Standard GitHub App auth |
| **Access** | Resilient bridge with retry, circuit breaker, multi-strategy | Never fails on 503 |

---

## THE AGGRESSIVE ARCHITECTURE

### Scan Flow (Direct — No Webhooks)
```
Customer pays → Redirect to /scan/status → Page calls /api/scan/run →
Scan reads repo via GitHub API → Runs all module checks → Returns result →
Updates Stripe metadata → Captures payment → Customer sees results
```
**ONE call. ONE response. No polling. No webhooks. No shared state.**

### GitHub App Flow
```
Developer pushes code → GitHub sends webhook → /api/webhook receives →
JWT auth → Read repo via API → Run checks → Post commit status + PR comment
```

### Module Architecture
```
BaseModule (abstract)
  └── Every module extends this
  └── run(result, config) → adds checks with severity
  └── Registered in src/core/registry.js
  └── Added to suites in src/core/config.js
```

### Serverless Rules (Vercel)
- **NO in-memory state between requests** — every function is stateless
- **NO long-running async after response** — Vercel kills the function
- **NO shared memory between function instances** — use external storage
- **ALL scan work completes WITHIN the function response**
- **Stripe metadata is the persistence layer** for scan results

---

## THE QUALITY BAR — ZERO TOLERANCE

### 1. Tests & Build

- [ ] All 120+ tests pass (`node --test tests/*.test.js`)
- [ ] Website builds clean (`cd website && npx next build`)
- [ ] All 35 modules load (`node bin/gatetest.js --list`)
- [ ] Fake-fix detector flags symptom patches on diffs
- [ ] Zero TypeScript errors in website
- [ ] Zero syntax errors in source files

### 2. Code Quality

- [ ] No console.log in library code
- [ ] No debugger statements
- [ ] No eval() in production code
- [ ] No TODO/FIXME left unresolved
- [ ] Function length under 50 lines
- [ ] File length under 300 lines
- [ ] All error paths handled

### 3. Security

- [ ] No hardcoded secrets, API keys, or tokens
- [ ] No secrets in git history
- [ ] All user input validated
- [ ] All database queries parameterised
- [ ] No eval() or innerHTML with unsanitised content

### 4. Website & UX

- [ ] All links verified — no dead anchors or placeholder hrefs
- [ ] All buttons functional — every onClick does something
- [ ] All user flows tested end-to-end (click through, not just compile)
- [ ] Scan page handles every state: pending, scanning, complete, failed
- [ ] Mobile responsive — 320px to 2560px
- [ ] Lighthouse Performance 95+, Accessibility 100, SEO 100

### 5. Stripe & Payments

- [ ] Test keys used for testing (never live keys)
- [ ] Hold-then-charge working (manual capture)
- [ ] Session metadata includes repo_url and tier
- [ ] Scan completes and captures payment
- [ ] Failed scans cancel payment (release hold)

### 6. Serverless Architecture

- [ ] NO in-memory state between requests
- [ ] NO long-running async after response
- [ ] ALL scan work completes within function response
- [ ] Stripe metadata used for persistence (not Maps or variables)

### 7. GitHub App

- [ ] Webhook receives push/PR events
- [ ] JWT auth with private key works
- [ ] Commit status posted (pass/fail)
- [ ] PR comment posted with scan results

### 8. Documentation

- [ ] README accurate and up-to-date
- [ ] CLAUDE.md updated with any changes
- [ ] Legal pages current (Terms, Privacy, Refunds)
- [ ] All 35 modules listed in README and CLI help

### 9. Performance

- [ ] Quick scan under 15 seconds
- [ ] Full scan under 60 seconds
- [ ] API responses under 500ms
- [ ] Website FCP under 1.0s

### 10. Accessibility

- [ ] All images have alt text
- [ ] All interactive elements keyboard-accessible
- [ ] Focus indicators visible
- [ ] ARIA labels on non-text elements
- [ ] Dark mode renders correctly

### 11. SEO & Metadata

- [ ] Meta title and description set
- [ ] Open Graph tags set
- [ ] Canonical URL set to gatetest.io
- [ ] Structured data valid

### 12. Deployment

- [ ] Vercel deploys from main branch
- [ ] Root Directory set to website
- [ ] All 9 environment variables set
- [ ] DNS pointing to Vercel

### 13. Pre-Launch

- [ ] Fresh checkout → scan → result works end-to-end
- [ ] GitHub App installed and posting commit statuses
- [ ] Legal pages accessible from footer
- [ ] Stripe webhook endpoint configured
- [ ] Email forwarding set up for hello@gatetest.io

---

## THE FORBIDDEN LIST

**NEVER do these things. Ever. Without exception:**

1. **Never ship code that "compiles but doesn't work."** "It compiles" is not testing.
2. **Never use in-memory storage on Vercel serverless.** Functions don't share memory.
3. **Never depend on webhooks for critical user flows.** Direct API calls only.
4. **Never let the scan page sit at 0% or loop.** Every state must be handled.
5. **Never test with live Stripe keys.** Test keys only. Card 4242 4242 4242 4242.
6. **Never commit secrets.** Env vars only.
7. **Never skip tests for "speed."** Untested code does not exist.
8. **Never say "it's ready" without testing the actual user flow.** Click every button.
9. **Never patch symptoms.** Find and fix the root cause.
10. **Never make chicken scratchings.** Go big or go home.
11. **Never deploy to production without Craig's authorization.**
12. **Never modify Stripe configuration without Craig's authorization.**
13. **Never add a dependency not in the approved stack without authorization.**
14. **Never delete user data without explicit user action.**
15. **Never let an error bubble unhandled to the user.** Wrap, log, recover.
16. **Never silently fail.** Errors are visible.
17. **Never ship a feature without updating this file.**
18. **Never approve something you didn't test end-to-end.**
19. **Never build an 80s website.** We are AI builders. The output must be stunning.
20. **Never ask Craig "do you want me to fix this?"** If it's broken, FIX IT.
21. **Never delete, rename, or weaken `integrations/`** — that directory protects Crontech and Gluecron. See **PROTECTED PLATFORMS**.
22. **Never delete or weaken `tests/integrations.test.js`** — it is the tripwire that keeps protection intact across sessions.
23. **Never remove the PROTECTED PLATFORMS section from this file.** It must be read at every session start.
24. **Never soft-fail the gate** with `continue-on-error: true` on the GateTest step itself.

---

## PRE-BUILD CHECKLIST (BEFORE EVERY BUILD)

Before writing a single line of new code:

1. Read the relevant section of this CLAUDE.md
2. Confirm the task aligns with the build plan
3. Confirm it doesn't require Craig's authorization
4. Confirm existing patterns to follow (check similar files)
5. Confirm dependencies are in the approved stack
6. Identify which tests need to be added
7. Plan the commit message in advance

---

## POST-BUILD CHECKLIST (BEFORE COMMITTING)

After writing the code:

1. `node --test tests/*.test.js` — ALL pass
2. `cd website && npx next build` — ZERO errors
3. `node bin/gatetest.js --list` — all 35 modules load
4. No `console.log` left in library code
5. Every new route/page works (actually click it)
6. Every user flow tested end-to-end (not just "it compiles")
7. CLAUDE.md updated if anything changed
8. Conventional commit message ready
9. Push to main

---

## GATE RULES — NON-NEGOTIABLE

1. **ZERO TOLERANCE**: Any error-severity check failure blocks the pipeline. No exceptions.
2. **NO MANUAL OVERRIDES**: Checks pass or the build is rejected. Craig only.
3. **NO PARTIAL DEPLOYS**: Everything passes or nothing ships.
4. **EVIDENCE REQUIRED**: Every gate pass produces a timestamped report.
5. **TEST THE TESTS**: Mutation testing validates tests catch bugs.
6. **FIX IMMEDIATELY**: If it's broken, fix it. Don't ask. Don't wait.
7. **ROOT CAUSE ONLY**: Never patch symptoms. Find and fix the real problem.
8. **END-TO-END VERIFICATION**: "It compiles" is not testing. Click every button.

## FAILURE RESPONSE PROTOCOL

When something breaks:

1. **STOP** — Do not proceed with other work
2. **IDENTIFY** — What exactly failed? Which file? Which line? What state?
3. **ROOT CAUSE** — Why did it fail? Not the symptom. The CAUSE.
4. **FIX** — Fix the root cause, not the symptom
5. **VERIFY** — Test the fix end-to-end. Actually use it.
6. **ENSURE NO REGRESSIONS** — Run all tests. Build website. Load modules.
7. **COMMIT** — Push the fix immediately
8. **NEVER ask Craig "should I fix this?"** — YES. ALWAYS. FIX IT.

---

## COMPETITIVE POSITION

### We replace 10+ tools with ONE:
| They use | GateTest replaces it with |
|----------|--------------------------|
| Jest/Vitest/Mocha | `gatetest --module unitTests` |
| Playwright/Cypress | `gatetest --module e2e` |
| ESLint/Stylelint | `gatetest --module lint` |
| Snyk/npm audit | `gatetest --module security` |
| Renovate/Dependabot (hygiene only) | `gatetest --module dependencies` |
| hadolint / dockle / docker bench | `gatetest --module dockerfile` |
| Lighthouse | `gatetest --module performance` |
| axe/pa11y | `gatetest --module accessibility` |
| Percy/Chromatic | `gatetest --module visual` |
| SonarQube | `gatetest --module codeQuality` |
| git-secrets/truffleHog | `gatetest --module secrets` |
| broken-link-checker | `gatetest --module links` |

Plus 12 more modules they don't have: AI code review, **fake-fix detector (catches AI chicken-scratching symptom patches)**, mutation testing, chaos testing, autonomous exploration, live crawling, data integrity, documentation validation, compatibility analysis, integration test detection, CI generation, and SARIF output.

### Revenue model: Pay on completion
| Tier | Price | Modules |
|------|-------|---------|
| Quick Scan | $29 | 4 modules |
| Full Scan | $99 | All 35 modules |
| Scan + Fix | $199 | 35 modules + auto-fix PR |
| Nuclear | $399 | Everything + mutation + crawl + chaos |
| Continuous | $49/mo | Scan every push |

---

## PROJECT ARCHITECTURE (BUILT — DO NOT RECREATE)

```
GateTest/
├── CLAUDE.md               ← THIS FILE — THE BIBLE
├── MARKETING.md            ← Positioning, pricing, website copy
├── package.json            ← CLI tool (name: gatetest, bin: gatetest)
├── bin/gatetest.js         ← CLI entry point (20+ flags)
├── src/
│   ├── index.js            ← Main library entry
│   ├── core/               ← Config, runner, registry, cache, CI gen, GitHub bridge
│   ├── modules/            ← 35 TEST MODULES (24 core + 9 universal language checkers + 1 polyglot dependency scanner + 1 Dockerfile scanner)
│   ├── reporters/          ← Console, JSON, HTML, SARIF, JUnit
│   ├── scanners/           ← Continuous scanner
│   └── hooks/              ← Pre-commit, pre-push
├── tests/                  ← 120+ tests (MUST ALL PASS)
└── website/                ← gatetest.io (Next.js 16 + Tailwind 4)
    └── app/
        ├── page.tsx                 ← Main page
        ├── layout.tsx               ← Root layout
        ├── globals.css              ← Dark theme, animations
        ├── api/checkout/            ← Stripe checkout
        ├── api/scan/run/            ← Direct scan execution
        ├── api/scan/status/         ← Scan status reader
        ├── api/stripe-webhook/      ← Stripe webhook (backup)
        ├── api/webhook/             ← GitHub App webhook
        ├── api/github/callback/     ← GitHub App install callback
        ├── scan/status/             ← Live scan page
        ├── checkout/success/        ← Post-checkout redirect
        ├── checkout/cancel/         ← Checkout cancelled
        ├── github/setup/            ← GitHub App install page
        ├── github/installed/        ← Post-install success
        ├── legal/terms/             ← Terms of Service
        ├── legal/privacy/           ← Privacy Policy
        ├── legal/refunds/           ← Refund Policy
        └── components/              ← 13 React components
```

---

## KEY FILES — READ BEFORE MODIFYING

| File | What it controls | Read before... |
|------|-----------------|---------------|
| `MARKETING.md` | All marketing copy, pricing | Any website change |
| `src/index.js` | All public exports, reporter wiring | Adding exports |
| `src/core/runner.js` | Severity, auto-fix, diff-mode, gate | Changing how checks work |
| `src/core/config.js` | Thresholds, suite definitions | Changing what modules run |
| `src/core/registry.js` | Module registration | Adding new modules |
| `src/core/memory.js` | Persistent codebase memory — the compounding moat | Changing memory schema or persistence |
| `src/modules/memory.js` | Surfaces memory, runs FIRST, enriches `config._memory` | Before any module that consumes memory |
| `src/modules/agentic.js` | AI agent that investigates memory-informed hypotheses | Changing agentic prompts / flow |
| `src/core/universal-checker.js` | Pattern engine + `LANGUAGE_SPECS` for Python/Go/Rust/Java/Ruby/PHP/C#/Kotlin/Swift | Adding language support, changing detection patterns |
| `src/modules/dependencies.js` | Polyglot dependency hygiene scanner — npm/pip/Pipenv/Poetry/go.mod/Cargo/Bundler/Composer/Maven/Gradle. Flags wildcards, `latest` pins, deprecated packages, missing lockfiles, git-without-rev. Zero network calls | Adding a new ecosystem or deprecation entry |
| `src/modules/dockerfile.js` | Dockerfile security + hygiene scanner — root user, :latest tags, curl\|sh, apt hygiene, pip cache, chmod 777, ADD URLs, secrets baked into layers | Adding a new Dockerfile pattern or hardening rule |
| `src/core/host-bridge.js` | Abstract `HostBridge` base, bridge registry (`createBridge`/`registerBridge`), canonical commit-status vocabulary, shared PR/MR markdown formatter | Before adding a new host integration or touching cross-host logic |
| `src/core/github-bridge.js` | Concrete `GitHubBridge` extending `HostBridge` — GitHub-specific REST calls, circuit breaker, retry, JWT auth | Anything GitHub-specific; prefer `HostBridge` for cross-host work |
| `bin/gatetest.js` | CLI flags, help text, watch mode | Adding CLI features |
| `website/app/api/scan/run/route.ts` | The actual scan execution | Changing scan logic |
| `website/app/scan/status/page.tsx` | Live scan page | Changing scan UX |
| `website/app/api/checkout/route.ts` | Stripe checkout creation | Changing payment flow |
| `website/app/page.tsx` | How website sections compose | Changing page structure |
| `website/app/globals.css` | Dark theme, animations | Changing visual style |
| `integrations/github-actions/gatetest-gate.yml` | CI gate shipped to protected platforms | Any change to protection workflow |
| `integrations/husky/pre-push` | Local pre-push gate for protected platforms | Any change to local enforcement |
| `integrations/scripts/install.sh` | One-command installer into a protected repo | Any change to install flow |
| `tests/integrations.test.js` | Tripwire that prevents silent removal of protection | DO NOT modify without Craig auth |

---

## ENVIRONMENT VARIABLES (Vercel)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API (sk_live_... or sk_test_...) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client key |
| `NEXT_PUBLIC_BASE_URL` | https://gatetest.io |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing |
| `GATETEST_APP_ID` | GitHub App ID |
| `GATETEST_PRIVATE_KEY` | GitHub App .pem contents |
| `GATETEST_WEBHOOK_SECRET` | GitHub webhook secret |
| `ANTHROPIC_API_KEY` | Claude API for AI review |
| `GATETEST_ADMIN_PASSWORD` | Admin console password for `/admin` (bypasses Stripe) |

---

## KNOWN ISSUES — QUEUED FOR FIX

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Scan page needs fresh checkout — stale sessions show "cancelled" | MEDIUM | KNOWN |
| 2 | Website design needs major upgrade — current is basic | HIGH | Craig's next priority |
| 3 | Stripe test keys not yet swapped in | MEDIUM | Craig action |
| 4 | GitHub App not yet installed on test repo | MEDIUM | Craig action |
| 5 | Crontech.ai protection — workflow shipped in `integrations/`, needs `install.sh` run from that repo | HIGH | Craig action (or expand MCP scope) |
| 6 | Gluecron.com protection — workflow shipped in `integrations/`, needs `install.sh` run from that repo | HIGH | Craig action (or expand MCP scope) |
| 7 | MCP GitHub scope currently restricted to `ccantynz-alt/gatetest` — blocks pushing protection into Crontech/Gluecron directly. Expand to owner-wide scope. | HIGH | Craig action — see `.claude/` config |
| 8 | Gluecron-first direction ratified in the Bible — still need Gluecron's API surface (endpoints, auth, webhook model) before the `HostBridge` refactor can ship a `GluecronBridge`. | HIGH | Craig to share Gluecron API docs / deployed URL |
| 9 | `HostBridge` abstraction not yet extracted from `src/core/github-bridge.js`. Pre-authorized. Safe to do in parallel with getting Gluecron answers. | MEDIUM | DONE (2026-04-14) — `src/core/host-bridge.js` shipped, `GitHubBridge extends HostBridge`, registry + shared markdown formatter + 21 contract tests green. Gluecron bridge can plug in without further refactor once API surface is known. |

---

## SESSION PROTOCOL

### At the START of every session:
1. Read this file end to end
2. `git status && git log --oneline -10`
3. `git branch` — verify on correct branch
4. Check "Known Issues" section
5. Check what needs to be done
6. If unclear, ask Craig

### At the END of every session:
1. Run ALL tests — `node --test tests/*.test.js`
2. Build website — `cd website && npx next build`
3. Verify all 35 modules load — `node bin/gatetest.js --list`
4. Update "Known Issues" if anything found
5. Commit and push everything
6. Leave the codebase in a WORKING state

### When something breaks:
1. **FIX IT.** Don't ask. Don't wait. Don't patch symptoms.
2. Find the ROOT CAUSE.
3. Fix the root cause.
4. Test the fix END TO END.
5. Commit. Push.

---

## THE AGGRESSIVE MANDATE (REPRISE)

**This is not a hobby project. This is a business. Craig needs revenue.**

Every feature must be the BEST implementation available. Every check must be DEEPER than the competition. Every report must be more ACTIONABLE. Every module must catch REAL bugs.

The website must look like it was built in 2026 by the most advanced AI on the planet — because it was. Not the 80s. Not "functional but ugly." STUNNING.

The scan experience must be CINEMATIC. Customers watch their repo get scanned in real time with animations, progress, and drama. They WANT to watch it.

If a competitor does something we don't, that's a GateTest bug. Fix it.

**No scatter-gun. No drift. No chicken scratchings. No "just this once."**

**GateTest dominates or GateTest dies. There is no second place.**

---

## VERSION

GateTest v1.8.0 — 35 modules (24 core + 9 universal language checkers
for Python, Go, Rust, Java, Ruby, PHP, C#, Kotlin, Swift + 1 polyglot
**dependency scanner** covering npm, pip, Pipenv, Poetry, Go modules,
Cargo, Bundler, Composer, Maven, Gradle + 1 **Dockerfile scanner**
covering root-user, :latest tags, curl|sh, apt hygiene, secrets-in-layers,
cache bloat), 5 reporters, AI code
review (memory-enriched, fix-pattern-aware), agentic exploration, codebase
memory (compounding moat: issue history + fix-pattern database), memory-aware
auto-fix, fake-fix detector, diff-mode, watch mode, mutation testing, CI
generation, caching, SARIF/JUnit output, Stripe pay-on-completion, GitHub
App, legal pages. **Gluecron-ready `HostBridge` abstraction**: every git
host integration plugs into one contract (canonical commit-status states,
shared PR/MR markdown, registry-based bridge factory). `GitHubBridge` is
the first concrete implementation; `GluecronBridge` will be the second.

Date last updated: 2026-04-14
