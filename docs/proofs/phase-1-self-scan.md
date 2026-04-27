# Phase 1 — Real-repo proof: GateTest self-scan

**Status:** real scan against a real repo — the GateTest source itself.
**Date:** 2026-04-26
**Repo:** `ccantynz-alt/gatetest` (this repository)
**Suite:** `quick` (39 modules)
**Command:** `node bin/gatetest.js --suite quick`

This is the first of three real-repo proofs the Phase 1 build plan
requires. GateTest is being scanned by GateTest. If the system has
honest output, it should find honest issues in our own code — and it
does.

## Summary

| Metric | Value |
| --- | --- |
| Modules | 30 / 39 passed |
| Checks | 345 / 773 passed |
| Errors | **37** |
| Warnings | 328 |
| Wall time | ~10.0 seconds |
| Final gate | **BLOCKED** (errors block) |

The fact that the gate blocks on **our own repo** is a feature, not a
bug. Phase 4 (the honesty sweep) will run after Phase 3 to clean up
the items the Phase 1-3 build introduces. Until then, we expose every
finding instead of hiding them.

## Categories of error-severity findings (sample)

These are the actual modules that fired errors against this repo:

| Module | Error count | Example |
| --- | --- | --- |
| `syntax` | 1 | TypeScript-strictness regression somewhere in `website/` |
| `lint` | 1 | ESLint violation |
| `secrets` | 1 | Apparent secret-shape in `website/app/for/nodejs/page.tsx` |
| `codeQuality` | 11 | `console.log` calls in `src/runtime/monitor.js` and `src/runtime/alerts.js`; oversize `integrations/infra/scanner.js` (>file-length budget); unused import in `website/app/for/typescript/page.tsx` |
| `promptSafety` | 1 | Browser-bundled API key in `website/app/for/nextjs/page.tsx:240` |
| `hardcodedUrl` | 3 | `localhost` literals in `src/modules/deploy-contract.js` and `website/app/for/nodejs/page.tsx:111` |
| `envVars` | 15 | Env vars referenced in code but missing from `.env.example` (`ADMIN_TOKEN`, `GATETEST_ADMIN_URL`, `GATETEST_ALERT_WEBHOOK`, `VERCEL_TOKEN`, `CF_ZONE_ID`, `CF_API_TOKEN`, `GATETEST_FIX_MAX_ATTEMPTS`, etc.) |
| `moneyFloat` | 3 | `parseFloat` on money-named variable in `website/app/api/watches/tick/route.ts:52` and `website/app/for/typescript/page.tsx:214` |
| `cookieSecurity` | 1 | Weak placeholder secret in `website/app/for/nodejs/page.tsx:105` |

These are **real findings** the scanner produced on this commit. Every
one of them maps to a specific file:line. None are stubbed, faked, or
fabricated.

## What this proves about Phase 1

| Sub-task | What this scan demonstrates |
| --- | --- |
| 1.1 Iterative fix loop | Algorithm + per-attempt logging + tests are shipped (`tests/fix-attempt-loop.test.js`, 11 tests). Not exercised here — needs Anthropic API key to actually call Claude. |
| 1.2a Syntax gate | Algorithm + tests shipped (`tests/cross-fix-syntax-gate.test.js`, 22 tests). Not exercised here — gate runs only on Claude fix output. |
| 1.2b Scanner gate | Algorithm + tests shipped (`tests/cross-fix-scanner-gate.test.js`, 22 tests). Not exercised here — gate runs only when caller passes `originalFileContents` + `originalFindings`. |
| 1.3 Test generation | Algorithm + tests shipped (`tests/test-generator.test.js`, 33 tests). Not exercised here — needs Anthropic API key. |
| 1.4 PR composer | Algorithm + tests shipped (`tests/pr-composer.test.js`, 25 tests). Not exercised here — produces output only when PR creation runs. |

## What this proof does NOT cover (and what's needed to cover it)

The full Phase 1 cycle — scan → iterative-fix → syntax-gate →
scanner-gate → test-gen → PR-compose → open PR — requires:

1. **`ANTHROPIC_API_KEY`** to call Claude for fixes and test generation
2. **`GATETEST_GITHUB_TOKEN` (or `GLUECRON_API_TOKEN`)** to write to a
   real branch and open a real PR
3. **Network access** to a public repo we can experiment on safely

Without those credentials, this session can validate everything **up
to** the iterative fix call (the algorithms, the gates, the composer
— all dependency-injected and unit-tested). It cannot validate the
cycle's I/O endpoints.

## The other 2 proofs

The Phase 1 build plan requires proofs against 3 real repos. Two
candidate targets for the next API-key-equipped session:

1. A **Next.js project** — exercises web-headers, accessibility,
   typescriptStrictness, dead-code, async-iteration modules
2. A **Python tool** — exercises the universal-checker python lane,
   datetime-bug detection, env-vars cross-language reads

Both will follow the same proof-document shape: command, summary
stats, finding counts per module, link to the resulting PR (with diff
link), the PR body (rendered by the Phase 1.4 composer), and the
attempt-history table for each fix.

## How to reproduce

```bash
# In the gatetest repo root
node bin/gatetest.js --suite quick
```

Output is non-deterministic only in wall time; finding counts and
module pass/fail status are deterministic against the same commit.
