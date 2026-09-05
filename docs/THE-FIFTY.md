# The GateTest Fifty — the current work queue

Fifty moves to take GateTest from a scanner that could not fail a customer's
build to the gate developers brag about, ordered by what decides adoption:
precision first. Opened 2026-09-04; this file is the repo-side record and is
updated whenever a move lands. Items marked **Craig** touch pricing, brand,
public communication, dependencies or money and need authorisation first.

Status legend: **done** (merged or in the open PR, with evidence) · **partial**
· **open** · **Craig**.

## Where we are (measured, 2026-09-05)

| Metric | Now | Was |
|---|---|---|
| Real repos in the corpus at their ceilings | 20 / 20 — all eight languages, four monorepos | 6, all blocked |
| Blocking on express · django · rails | 0 · 64 · 46 | 2 · 89 · 56 (first contact) |
| PR diff scan | 8s | 17s, and it scanned everything |
| Full self-scan | 65s (mutation deferred to nightly) | never finished |
| Tests passing | 8,600+ | 7,790 |

The corpus, the ceilings and the runner: `reliability-corpus/real-world.json`,
`scripts/real-world-precision.js`; rendered at `/precision`.

## A. Precision (01–12)

| # | Move | Status | Evidence |
|---|---|---|---|
| 01 | Split zod's 50 into scope vs rule precision | done | 50 → 20; harness scope + guarded-catch classifier (PR #419) |
| 02 | Wire every module to one file walk | done | 36 walks → `_collectFiles`, file sets proven identical; KI #104 (PR #423) |
| 03 | No rule ships without a control pair | done — policy | `docs/DOCTRINE.md` §3; every 2026-09-05 fix shipped both |
| 04 | Grow the real-world corpus to 20 repos | done | Rust (axum 28→6), PHP (laravel 28→4), C# (CleanArchitecture 39→13), Kotlin (ktor 21→7), Swift (vapor 6→1); then the monorepos — nest 39→9, trpc 33→8, apollo-server 4→0, prisma 90→16 — all 2026-09-05, PR #426 |
| 05 | Add Django, Rails, Spring, a Go service | done | seven rule defects, each a real line (PR #422); the remaining five languages followed under 04 |
| 06 | Ratchet the ceilings on a schedule | open | monthly review; ceilings only go down |
| 07 | Per-rule false-positive rate from the flywheel | open | telemetry records dismissals; needs the leaderboard |
| 08 | Retire any rule above 20% FP that can't be fixed | open | depends on 07 |
| 09 | Recalibrate confidence against the corpus | open | 0.7 was chosen, not derived |
| 10 | Hunt the substring-vs-segment shape everywhere | done | guard extended to src/core, bin, website analysers; five recall holes closed (PR #423) |
| 11 | Audit every early return that assumes a framework | partial 9/15 | `src/core/route-grammar.js` (4, PR #423); webHeaders, integrationTests, webhookPayload, cacheHeaders, monorepoConstraints + one `src/core/workspaces.js` (5, PR #426); the other 8 are KI #106 |
| 12 | Publish the precision numbers, including the bad ones | done | `/precision`, generated, sync-tested (PR #422) |

## B. Honesty (13–22)

| # | Move | Status | Evidence |
|---|---|---|---|
| 13 | Full scan under 60 seconds | done | 65s with mutation deferred; PR diff 8s |
| 14 | Audit every fail-open path | done | nine "reports success while doing nothing" shapes fixed (PR #419) |
| 15 | Make `typescript` resolvable in production | **Craig** | devDependency on the paid fix path |
| 16 | Ban the bare `catch {}` around a retry | done | errorSwallow classifies every empty catch |
| 17 | Every report says what it did *not* check | done | PR comment: partial scan, coverage, not-checked modules (PR #423) |
| 18 | Never derive a metric from a timeout | done — policy | mutation: timeouts are inconclusive |
| 19 | Deterministic scans: same SHA, same findings | done | `scripts/determinism-check.js` + CI job; failure path tested (PR #423) |
| 20 | Never write to the user's tree without saying so | partial | restore is signal-safe; mutate-a-copy still open |
| 21 | Signed, reproducible scan reports | done | provenance + HMAC; `gatetest verify-report` (PR #423) |
| 22 | Public status page | **Craig** | — |

## C. The gate itself (23–30)

| # | Move | Status | Evidence |
|---|---|---|---|
| 23 | Make the baseline a first-class onboarding step | done | blocked full scan with no baseline leads its recap with `gatetest --baseline` (`src/core/plain-summary.js`, controls: diff-scoped and already-baselined runs stay quiet); README Action quickstart and `integrations/README.md` say what the first run does |
| 24 | PR comments show only what's new | done | line-level attribution, `changed-lines.js` (PR #423) |
| 25 | Suggest the `.gatetestignore` line | done | `suggestLine`, CLI + PR reply (PR #423) |
| 26 | A policy file teams can review in a PR | done | the policy IS `.gatetest.json` + `.gatetestignore`; fakeFixDetector now reads those two files (and only the policy rules read them): `policy-ignore-line-added` and `policy-gate-softened` warn on the PR that widens a suppression, disables a module, sets report-only or raises the threshold — quiet on comments and on tightening; a suppression-only PR is no longer scoped out as "nothing changed"; provenance carries both files' SHA-256 and `verify-report` prints them |
| 27 | Merge-queue and monorepo path filters | open | — |
| 28 | One-command local reproduction of a CI failure | done | blocked gate leads with `gatetest replay <run-url>` (PR #423) |
| 29 | Lead with the fake-fix detector | **Craig** | positioning |
| 30 | Make `test.skip` in a "fix" commit block | done | measured first: eleven `.skip` additions in ~14,000 commits across ten real repos, none in a fix-shaped commit. Now: `fake-fix:test-skip-added` scores 1.0 in a test file (it was soft), fakeFixDetector diffs a PR against its base instead of its last commit, and the finding blocks only when a commit touching the file calls itself a fix — otherwise a warning, still reported |

## D. The website as a machine (31–40)

| # | Move | Status | Evidence |
|---|---|---|---|
| 31 | Ship `/pricing` as a real page | done | PR #419 |
| 32 | Ship `/enterprise` | done | PR #419 |
| 33 | Put the precision table on the site | done | `/precision`, nightly regeneration (PR #422) |
| 34 | Surface the 121 module pages in navigation | done | PR #419 |
| 35 | Turn the bug hunts into the blog | **Craig** | — |
| 36 | Badges as the distribution channel | done | graded badge redirect; free scan ends with the badge (PR #423) |
| 37 | Free scan as the primary call to action | **Craig** | — |
| 38 | Keep the comparison pages dated and factual | done | git-dated `ComparisonReviewed` (PR #423) |
| 39 | A real changelog page | open | `docs/HISTORY.md` is prose; needs a structured source |
| 40 | Three case studies with numbers | **Craig** | — |

## E. Enterprise readiness (41–46)

| # | Move | Status | Evidence |
|---|---|---|---|
| 41 | A security page that answers the questionnaire | **Craig** | — |
| 42 | Self-hosted / air-gapped mode | open | engine is already offline-capable; signed reports make it auditable |
| 43 | SSO, roles, audit log | **Craig** | — |
| 44 | DPA, subprocessor list, SOC 2 roadmap | **Craig** | — |
| 45 | Invoicing, POs, annual terms | **Craig** | — |
| 46 | Compliance mapping as a report | open | `compliance-mappings.js` feeds the CISO report; engine-side evidence pack rides on move 21 |

## F. The compounding moat (47–50)

| # | Move | Status | Evidence |
|---|---|---|---|
| 47 | Open-source the real-world corpus | **Craig** | — |
| 48 | Finish the MCP registry submission | open | — |
| 49 | Pick one editor extension and ship it | open | two unshipped trees |
| 50 | Make fix recipes the network effect | open | — |

## Next, in order

the 8 gates left in KI #106, 06 (schedule the ratchet), 46.
Waiting on Craig: 15, 29, 35, 41.
