# GateTest

Advanced AI-powered QA gate system. Nothing ships unless it's pristine.

GateTest sits between Claude and GitHub as the quality enforcement layer.
It works alongside **GateCode** (authorization) to ensure that only fully
tested, secure, accessible, performant code reaches production.

## What It Checks

GateTest runs **16 test modules** covering every aspect of code quality:

| Module | What It Does |
|--------|-------------|
| **syntax** | Validates JS/TS/JSON syntax, zero compilation errors |
| **lint** | ESLint, Stylelint, Markdownlint — zero warnings policy |
| **secrets** | Detects hardcoded API keys, tokens, passwords, private keys |
| **codeQuality** | Catches console.log, debugger, TODO/FIXME, eval, complexity |
| **unitTests** | Runs unit tests, enforces coverage thresholds |
| **integrationTests** | Runs integration test suites |
| **e2e** | End-to-end tests via Playwright/Cypress/Puppeteer |
| **visual** | Visual regression, font loading, layout shifts, design tokens |
| **accessibility** | WCAG 2.2 AAA compliance — alt text, ARIA, focus, contrast |
| **performance** | Bundle size budgets, Core Web Vitals, Lighthouse scores |
| **security** | OWASP patterns, dependency CVEs, CSP, XSS/SQLi prevention |
| **seo** | Meta tags, Open Graph, structured data, sitemaps, robots.txt |
| **links** | Broken link detection (internal + external) |
| **compatibility** | Browser support validation, modern API polyfill checks |
| **dataIntegrity** | Database schema, migrations, PII handling |
| **documentation** | README, CHANGELOG, env documentation completeness |

## Quick Start

```bash
# Initialize GateTest in your project
node bin/gatetest.js --init

# Run quick checks (syntax, lint, secrets, code quality)
node bin/gatetest.js --suite quick

# Run standard checks (+ unit & integration tests)
node bin/gatetest.js --suite standard

# Run EVERY check — the full gate
node bin/gatetest.js --suite full

# Run a specific module
node bin/gatetest.js --module security
node bin/gatetest.js --module accessibility
node bin/gatetest.js --module performance

# Validate CLAUDE.md
node bin/gatetest.js --validate

# List all available modules
node bin/gatetest.js --list
```

## Architecture

```
Claude Code --> GateCode (Auth) --> GateTest (QA) --> GitHub
```

GateTest enforces the checklist defined in `CLAUDE.md`. Every build reads
that file and must pass every single check before code can ship.

## Gate Rules

1. **Zero Tolerance** — Any single check failure blocks the entire pipeline
2. **No Manual Overrides** — No human can bypass the gate
3. **No Partial Deploys** — Everything passes or nothing ships
4. **Evidence Required** — Every gate pass produces a timestamped report
5. **Regression = Rollback** — Auto-rollback on post-deploy regression

## Continuous Scanning

GateTest doesn't sleep. Even when no build is active, background scanners
monitor for dependency vulnerabilities, SSL expiry, uptime, performance
regressions, and new security advisories.

## License

MIT
