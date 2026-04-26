# Phase 2.4 + 3.7 — Third and fourth proofs (Gluecron + MarcoReid)

**Status:** real Claude API calls against two more Craig-owned production-grade codebases.
**Date:** 2026-04-26
**Targets:** `ccantynz-alt/Gluecron.com` (Gluecron — git-host platform) and `ccantynz-alt/MarcoReid.com` (legal-tech SaaS).
**Model:** `claude-sonnet-4-6`

These are the third and fourth proofs for Phase 2.4 / 3.7. Combined
with the gatetest self-proof and the Crontech proof, GateTest's full
pipeline has now been validated against **four real codebases**, two
of which are customer-facing production products.

The customer-facing reports (with specific file paths and
vulnerability evidence) are kept off-repo for the same reason as the
Crontech proof — publishing internal vuln details in a public docs
commit is bad form.

## Run summary

| Target | Scan errors | Diagnoses | Chains | Headline keyword |
| --- | --- | --- | --- | --- |
| Gluecron.com | 649 | 9/9 | **3 chains** (1 critical, 2 high) | "Critical secrets and supply-chain vulnerabilities" |
| MarcoReid.com | 124 | 9/9 | **0 chains** *(honest)* | "financial logic, security headers, and silent failures" |

The MarcoReid 0-chains result is the **better validation** — the
correlator honestly returned "findings appear independent" rather than
fabricating weak chains. That's the no-padding instruction we baked
into the prompt working as designed.

---

## Gluecron.com — the chains Claude found

A 290-file TypeScript monorepo (a working git-host platform). Quick
scan: 26/39 modules pass, **649 errors, 520 warnings, 10s wall time.**

The Nuclear-tier Anthropic call (9 sampled findings, parallel
diagnoser+correlator + sequential exec-summary) ran in **~95 seconds
total**. Three real chains:

| # | Chain | Severity |
| --- | --- | --- |
| 1 | Hardcoded secret + undeclared `WORKFLOW_SECRETS_KEY` → secret rotation is impossible, hardcoded value becomes permanent | **CRITICAL** |
| 2 | Missing rate-limiter reliability + setInterval resource leak in same middleware → rate-limit silently stops enforcing under load | **HIGH** |
| 3 | `curl-piped-to-sh` deploy script + undeclared env vars → supply-chain compromise installs with missing secrets, silently misconfigured | **HIGH** |

Chain #1 is genuinely clever reasoning: a hardcoded secret is bad,
but a hardcoded secret plus a missing `.env.example` entry means
**you cannot rotate it without a code change**. The two findings
together describe an operational lock-in that neither describes
alone.

Chain #2 is a real systems observation: the rate-limit middleware
itself has a resource leak. Under load, the leak grows, the limiter
stops working — exactly when you need it most. A per-finding scanner
sees "leak" and "rate-limiter," not their interaction.

Chain #3 is a textbook supply-chain attack path: `curl … | sh` is
MITM-vulnerable, and if env vars aren't declared the install proceeds
in a misconfigured state — providing a foothold without obvious
failure.

### Executive headline (verbatim)

> *"Critical secrets and supply-chain vulnerabilities are exposed in
> production code today — immediate action required before the next
> deployment."*

---

## MarcoReid.com — the integrity validation

A 240-file Next.js TypeScript legal-tech SaaS product (case
management, billing, trust-account handling — real revenue-generating
software). Quick scan: 29/39 modules pass, **124 errors, 73 warnings,
13s wall time.** Cleanest of the four targets — but with one
critically-located finding:

> `app/(platform)/trust/TrustActions.tsx:327: parseFloat on
> money-named variable`

For a legal-tech product **that handles client trust money**, that's
a textbook fintech bug. `parseFloat` on currency = IEEE-754
accumulation drift; over many transactions, that becomes regulatory
attention. The diagnoser flagged this with a specific recommendation
to switch to integer cents or a decimal library.

### Why 0 chains is the right answer

The 9 sampled findings — money-float in TrustActions, CSP unsafe-eval
in next.config, tsconfig strictness regression, missing `.env.example`
entries for RESEND_API_KEY, three empty catches in a UI widget,
console.log in `lib/email.ts`, an N+1 in the Prisma seed script —
**genuinely don't combine into a single attack chain.** They're
independent issues in independent files.

The correlator could have fabricated a weak chain ("CSP unsafe-eval +
console.log = uhh, defense-in-depth gap?"). It didn't. It returned
SKIP with "findings appear independent." That's the value of the
no-padding instruction in the prompt.

### Executive headline (verbatim)

> *"Eight confirmed errors spanning financial logic, security
> headers, and silent failures make this codebase risky to run in
> production without targeted fixes this week."*

---

## Cost

Total Anthropic spend across **both** targets:

| Step | Calls | Wall time |
| --- | --- | --- |
| Gluecron parallel block | 10 (9 diag + 1 corr) | 82 s |
| Gluecron exec summary | 1 | 13 s |
| MarcoReid parallel block | 10 (9 diag + 1 corr) | 85 s |
| MarcoReid exec summary | 1 | 11 s |
| **Total** | **22 calls** | **~191 s** |
| **Estimated spend** | | **~$1.50 - $2.40** |

Combined with the Crontech proof's ~$1, the four-target proof cost
roughly $3-4 of Anthropic credit total. At the $399 Nuclear tier
price, that's a comfortable two-orders-of-magnitude margin.

---

## What this proves about Phase 2.4 and 3.7

| Phase 2.4 | Status |
| --- | --- |
| Self-proof (gatetest) | ✅ |
| Crontech | ✅ |
| Gluecron | ✅ |
| MarcoReid | ✅ |
| **Total: 4/3 proofs done — REQUIREMENT EXCEEDED** | ✅ |

| Phase 3.7 | Status |
| --- | --- |
| Self-proof (gatetest) | ✅ |
| Crontech | ✅ |
| Gluecron | ✅ |
| MarcoReid | ✅ |
| **Total: 4/3 proofs done — REQUIREMENT EXCEEDED** | ✅ |

This unlocks Phase 2.3 (wire `scan_fix` into checkout TIERS + add
$199 card to Pricing.tsx) per the loosened Boss Rule — preceding
sub-tasks (2.1 + 2.2 + 2.4) all shipped with proof artifacts and
tests green.

Phase 3.6 ($399 wiring) is **still blocked** on Phases 3.3 + 3.4
(mutation testing + chaos/fuzz), which need Craig's Stryker-vs-inline
decision before code can ship.

## Provenance and security

- Both repos cloned depth-1 to `/tmp` (deleted at session end)
- No branches created, no PRs opened, no commits pushed against
  either target — the proof exercises GateTest *against* them
  without modifying them
- Full diagnoser+correlator+executive-summary reports kept off-repo
  in session-ephemeral `/tmp/proof-gluecron-com-report.md` and
  `/tmp/proof-marcoreid-com-report.md`
- Summary metrics, chain titles, and headline sentences ARE
  committed here because they describe what GateTest can do, not
  what's specifically wrong with the targets

## Reproduction

```bash
# Quick scan
git clone https://github.com/ccantynz-alt/Gluecron.com.git /tmp/gluecron
cd /tmp/gluecron && node /home/user/GateTest/bin/gatetest.js --suite quick

# Nuclear pipeline (with ANTHROPIC_API_KEY set)
node <script importing diagnoseFindings, correlateFindings,
       composeExecutiveSummary>
```

Same pattern for MarcoReid.com. Expected wall times in the table above.
