# GateTest Deep Audit — 2026-08-18

Craig's ask: *"remove all limitations developers have with pre-existing tools … crawl the competitors and websites where people are complaining … audit at the highest/deepest level along with the website … all PRs pushed and merged … no false positives … what are the 20 biggest advancements."*

Four audits ran in parallel; the worst findings were fixed the same day (commits `b0b45c25` → `68ef2ea0`, all deployed). Shareable version with the same content: the "GateTest Deep Audit" artifact.

## What shipped today

| Commit | Change | Effect |
|---|---|---|
| `b0b45c25` | Public repos read through **one anonymous archive download** (`website/app/lib/repo-snapshot.js`: codeload tarball, built-in zlib, 40-line tar reader; no dependency). Falls in behind the credentialed paths in `fetchTree`/`fetchBlob`; preview, playground stream and `/api/scan/run` no longer refuse a public repo without a token. | **Free scan works in production for the first time since ~8 Aug** — `POST /api/scan/preview` expressjs/express → 79 findings, 662 ms. KI #101's product half closed without Craig's key. |
| `070de65e` | **Every hosted scan path runs the real engine on the whole repo.** `scan-engine-dispatch.ts` is the one place engine choice lives; `loadRepoFiles` reads up to 4,000 text files in one request; the worker scans the pushed SHA at a new `deterministic` tier (full engine, AI modules skipped, asserted against `src/`); responses carry `coverage {filesAnalysed, filesInRepo, truncated, engine}`. | Before: worker tick (every push / Continuous), Stripe job (every paid one-time scan) and `/api/v1/scan` ran 23 TS modules on a 50-file sample at HEAD; even `/api/scan/run` read 50 files with 12 extensions. Verified: Full tier on express → 88 modules, 210/213 files, 10.4 s. |
| `770aabb6` | **Blocking false positives cut ~90%** — seo, authBypass, visual, accessibility, subprocess modules, unitTests, undefinedRef, security, python/ruby, claudeCompliance, codeQuality, links, envVars, deployScriptValidator, performance, deployReadiness; each fix with a positive control (real defect still fires) beside a negative one (measured FP silent). | Table below. Every planted NodeGoat vuln still fires; authBypass on our repo 83 → 16 errors, and those 16 include the security audit's real findings. |
| `430e195f` | `fakeFixDetector` scopes its git diff to the scanned project (`-- .`). | A fixture inside this repo reported *our own commit* as 20 fake fixes. |
| `0936de14` | **Security:** SSRF guard + rate limits on `/api/scan/url|nuclear|server`; Slack fails closed; `x-vercel-cron` bypass removed; recipe writes require `GATETEST_RECIPE_STORE_TOKEN` (client confidence ignored); server-fix Forensic branch admin-only; chat limiter module-scoped; webhook returns handler status; ssrf-guard blocks 100.64/10 (Tailscale), 198.18/15, 224/4, 240/4. | Three unauthenticated internal port scanners, one fail-open command endpoint, one recipe-poisoning path, two free-AI-spend routes closed. |
| `d3437933` | **Website:** playground upsell "Full Scan — $29 → tier=quick" fixed; subscription success page; single scan trigger + honest progress + re-run on failure; MCP button pauses while email unconfigured; hosted MCP manifest generated from the registry (was 120); 15 stale count claims; root canonical moved; OG images render; compare-page facts; Nuclear→Forensic in $399 deliverables; carried "120/120 green" → measured nightly self-scan; phantom Continuous cards removed. | Build clean; sync test regex widened. |
| `68ef2ea0` | **Hosted engine never executes customer code on the box:** skip list = unitTests, integrationTests, e2e, lint (ESLint loads customer `eslint.config.js`), mutation, chaos. | The CodeRabbit-RCE shape, closed before every push ran the full engine hosted. |

## Live production

| Check | State | Detail |
|---|---|---|
| Deploy | fresh | push-to-deploy works; `/api/platform-status` shows the pushed commit |
| Free repo scan | **working** | anonymous archive path |
| GitHub App auth | **dead** | `GATETEST_PRIVATE_KEY` is the doc placeholder (KI #100) — Craig |
| Off-box cron | 401 | `CRON_SECRET` repo secret unset — Craig |
| MCP key email | unset | `RESEND_API_KEY` missing — button pauses itself |
| Recipe writes | 503 | new `GATETEST_RECIPE_STORE_TOKEN` must be set on the box |

## What developers hate about the tools we replace (top 10 of 25, ~60 sources)

1. **SAST false positives / low signal** (SonarQube, Semgrep, CodeQL, Snyk Code) — "seven issues, one or two actual bugs"; "222 issues, 208 false positives, and missed this one entirely". *We were worse: 8/8 real repos blocked. Now ~90% quieter; per-rule precision still not shown.*
2. **Dependency alert fatigue** — unreachable / dev-dep / wrong-platform CVEs (Dependabot, Snyk, GHAS) — Filippo: "a noise machine". *Same shape today; reachability is the opening.*
3. **AI reviewers = walls of noise** (CodeRabbit, Greptile, Copilot review) — teams beg to disable them. *No comment budget / evidence gate yet.*
4. **Bot PR avalanche / CI load** (Dependabot, Renovate).
5. **LOC / per-seat pricing cliffs, enterprise paywalls** (SonarQube, Snyk, GHAS). *Structural advantage — say it louder.*
6. **Gates that fail on the wrong thing** — old code counted as new (SonarQube), flaky patch coverage (Codecov).
7. **Slow / stuck scans** (SonarQube .NET 16 min → 4 h; CodeQL 6-h timeouts).
8. **Self-host ops burden** (SonarQube: PostgreSQL, JVM, Elasticsearch, 5–15 h/month).
9. **Hallucinated / diff-only AI findings** ("python 3.14 does not exist yet").
10. **Hosted reviewer = supply-chain blast radius** (CodeRabbit RCE, write access to 1M repos). *Closed the same shape today.*

Also high: license rug-pulls (Semgrep→Opengrep), rules with no rationale + coarse suppression, weak language coverage, IDE plugin heaviness, naive metrics gamed as "compliance software", weak auto-fix, non-deterministic results, dashboards nobody reads. (Reddit and G2 were blocked to the crawler; sources are HN via Algolia, GitHub issues, Sonar/Codecov forums, Capterra, vendor posts flagged as such.)

## False-positive measurement (full suite, fresh clones; blocking = error ≥ 0.7 confidence)

| Repo | Lang | Files | Blocking before | after | Still blocks |
|---|---|---:|---:|---:|---|
| expressjs/express | JS | 213 | 7 | **0** | — |
| pallets/flask | Py | 236 | 20 | 3 | deliberate eval/exec, one stub |
| gin-gonic/gin | Go | 130 | 8 | 1 | trivy SARIF perms (real) |
| sinatra/sinatra | Ruby | 292 | 9 | 2 | `system "kill -9 #{pid}"` (debatable) |
| spring-petclinic | Java | 131 | 270 | 9 | a11y on Thymeleaf pages, untagged image (real) |
| shadcn-ui/taxonomy | Next/TS | 188 | 20 | 2 | strict:false, bundler guard (real) |
| OWASP/NodeGoat (control) | JS | 111 | 358 | 41 | planted vulns dominate |
| fastapi/fastapi | Py | 3,137 | 57 | 30 | innerHTML in docs JS (dup), docs_src secrets |

Recall on NodeGoat unchanged at ~6/13 planted classes — the recall gap is advancement #6.

## The 20 biggest advancements (ranked)

| # | Advancement | Status | Why |
|---|---|---|---|
| 1 | Read any public repo with zero credentials, whole repo, one request | **shipped** | KI #100/#101; 2.5% coverage |
| 2 | Real engine on every hosted path + deterministic every-push tier | **shipped** | four hosted paths disagreed on "full" |
| 3 | Precision as a product: measured FP cuts → per-rule precision shown to users, auto-demotion, "noisiest 10 rules" panel | first pass shipped | complaint #1 |
| 4 | Finding registry: one defect = one finding, mandatory file:line, cross-module dedupe | **shipped** (99c59379) | eval ×3, secrets ×4, `file:null` |
| 5 | The 5-comment PR: budgeted, ranked, evidence-attached, never repeated | budget + ranking shipped (99c59379); evidence gate for AI findings queued | complaints #3/#9/#22 |
| 6 | Recall on the vulns buyers benchmark (NoSQLi, template XSS, cookie flags, IDOR, CSRF, helmet) + published benchmarks with misses | **detection shipped 2026-08-25** (all six fire on a live NodeGoat clone at the planted locations; express control clean; see docs/benchmarks/2026-08-25-nodegoat-recall.md); 13-class re-enumeration + public benchmarks page still queued | 6/13 on NodeGoat |
| 7 | Fix PRs with proof: originating module re-run, TS syntax gate, fail-closed scanner gate, tests executed, injection guard, path allow-list; CLI orchestrator tests the hypothesis | queued | audit #7/#8/#9; complaint #19 |
| 8 | Reachability-gated dependency alerts | **shipped** (af22bc79) | complaint #2 |
| 9 | Isolation you can read: no customer code on the box (skip list shipped) → sandbox + published model + on-box option | partial | complaint #13 |
| 10 | New-code attribution proven by git; deterministic re-scans; `--diff-against <scan-id>` | attribution shipped (fdc9907d); deterministic re-scan proof queued | complaints #7/#20 |
| 11 | Pipeline reliability: leases, dead-letter, terminal classification, callback retry, `pending` status, fetch/module timeouts, queue depth on /api/status | **shipped 2026-08-25** — claim was already atomic (SKIP LOCKED CTE) + reclaimStuck; added: terminal-vs-retryable classification (404/dead-creds/empty-repo dead-letter on attempt 1, rate limits still retry), 3-try callback retry on success AND dead-letter paths, pending commit status at enqueue (fire-and-forget), 10s AbortSignal timeouts on every github/gluecron callback fetch, queue block (queued/running/done/dead + oldest age) on /api/status behind a 2s race so the probe keeps its cannot-hang promise | audit #11/#17/#18 |
| 12 | Language depth beyond JS/TS — honestly labelled, then Python built as a real second tier; fix `smart-suite-selector` | queued | audit #13 |
| 13 | Suppression in place: 👎 on the PR writes `.gatetestignore` and feeds precision | queued | complaint #15 |
| 14 | The risk report, not the hygiene report (exploitable-now / reachable CVEs / secrets / trend; smells in an appendix) | queued | complaints #14/#18/#24 |
| 15 | Import Sonar/Semgrep/ESLint/Snyk/Dependabot config in an afternoon | queued | switching cost |
| 16 | Scan-time SLO in the PR, incremental by default, per-module timeouts | queued | complaint #8 |
| 17 | Local = hosted parity, verifiable (config hash + engine version on both; MCP is the IDE surface) | queued | complaints #9/#17 |
| 18 | Dogfood the Bible's own bar (`.gatetest.json` raises limits + excludes 18 paths) | queued | audit #14 |
| 19 | Website: one funnel, one truth (hero toggle, one URL-scan flow, money-page titles, cited compare pages, no domain literals) | mostly shipped | website audit |
| 20 | DX parity: `--json/--format`, `--fail-on`, exit codes, SARIF fingerprints + helpUri, one VS Code extension, pre-commit recipe, rule URLs | queued | audit §9 |

## Craig's list

1. Replace `GATETEST_PRIVATE_KEY` on the box (`/opt/gatetest/website/.env.local`, restart `gatetest-web`) — App auth dead until then (KI #100).
2. `gh secret set CRON_SECRET` with the box's value.
3. Set `RESEND_API_KEY` (MCP key email).
4. Set `GATETEST_RECIPE_STORE_TOKEN` on the box (new, fail-closed).
5. Legal pages still name Vercel as infrastructure/sub-processor — counsel pass.
6. Decide: URL-scan "Continuous" ($19/$49 cards removed) real tier or not? "Full Scan = all 121 modules" vs "every module that applies to a repository"?
7. Install Playwright on the box or `/api/web/scan` keeps blaming the customer for our missing browser.

Verification habit: `node scripts/ops/readiness-probe.js --base https://gatetest.io` answers "is production working"; a green CI run does not.
