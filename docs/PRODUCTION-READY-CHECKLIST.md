# PRODUCTION-READY CHECKLIST — including customer support

> Written 2026-08-21 at Craig's request. This is the launch gate: every unchecked
> box is a reason a paying customer gets hurt. Ordered by dependency — section 1
> makes everything below it meaningful. Update boxes in place as items close;
> move the *evidence* (what was verified, how) into `docs/HISTORY.md` when a
> section completes. Sources: CLAUDE.md Quality Bar §12–13,
> `docs/marketplace/CRAIG-PRE-SUBMIT-CHECKLIST.md`, `docs/ROADMAP.md` Known Issues.

Legend: **[C]** = needs Craig's accounts/hands, cannot be done from this repo.
Everything else is repo work under the standing pre-authorization.

---

## 1. Live pipeline actually works

The pipeline is proven from the public edge to the GitHub API call
(end-to-end test 2026-08-06) and fails exactly at credentials.

- [ ] **[C]** GitHub App webhook URL updated from dead `gatetest.ai` to
      `https://gatetest.io/api/webhook` (App 3322634 settings). Until this, no
      customer push has ever reached us (KI #99).
- [ ] **[C]** Real GitHub App private key on the box — prod key was a
      placeholder as of 2026-08-12, so all GitHub auth is dead. Paste
      `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` into `website/.env.local`,
      `systemctl restart gatetest-web` (KI #100 / pre-submit item 0b).
- [ ] **[C]** `issues:write` added to the live App — the PR comment the listing
      promises currently fails silently (pre-submit item 2).
- [ ] **[C]** Install the App on a test repo (KI #4), push, and watch the whole
      chain: `journalctl -u gatetest-tick.service -f` →
      `scan_queue` row → scan → commit status → PR comment.
- [ ] Verify deploys via `GET /api/platform-status` (deployed commit visible) —
      never trust a green CI run (lesson of KI #79: production sat 102 commits stale).
- [ ] Curl the live free-scan funnel on gatetest.io as an anonymous user —
      green tests ≠ working product.

## 2. Payments and the paid flow

- [ ] Fresh checkout → payment → scan → result end-to-end on the live site for
      Quick ($29) and one subscription tier. 4242-card in test mode first, then
      one real transaction.
- [ ] `checkout.session.completed` webhook firing against the box, fail-closed
      signature verification confirmed in prod.
- [ ] Billing portal (`gatetest.io/billing`) reachable and working for a real
      subscription.
- [ ] Failed scan → marked `failed` in DB → customer sees an honest message with
      a support path (no auto-refund; refund flows via support, see §3).

## 3. Customer support — the unbuilt layer

Support today is `mailto:hello@gatetest.ai` and nothing else, and that address
is on the OLD domain by deliberate choice (unverified sending fails silently —
see CLAUDE.md → THE DOMAIN).

- [ ] **[C]** `RESEND_API_KEY` set on the box — absent under any spelling
      (checked 2026-08-05), so **paid MCP keys have never been delivered**. A
      customer who pays $29/mo today gets nothing and no error. Worst single
      support liability on this list.
- [ ] **[C]** Verify `gatetest.io` as a sending domain in Resend, THEN set
      `RESEND_FROM` + `GATETEST_SUPPORT_EMAIL`.
- [ ] **[C]** Inbound forwarding for `hello@gatetest.ai` confirmed by test email
      landing in a read inbox. Decide whether `hello@gatetest.io` also exists
      and forwards.
- [ ] Transactional email coverage audit — which of these exist vs silently
      no-op: checkout receipt/confirmation, MCP key delivery,
      subscription-cancelled confirmation, scan-failed notice.
- [ ] Refunds: `/legal/refunds` matches the real process ("refunds via
      support"), and a support reply can actually execute one — document who
      besides Craig has Stripe dashboard access.
- [ ] **[C]** Support SLA decision: what response time do we promise? 24h is
      the minimum credible bar for a paid product; Enterprise card says
      "contact" and must mean something.
- [ ] Status surface for customers during an outage — `/api/platform-status`
      exists; decide human-readable status page vs "email us" for launch.
- [ ] Failure-mode messaging sweep: every paid-path error a customer can see
      tells them what happened and how to reach support (Forbidden #16 — this
      matters most to the person who just paid $399).
- [x] Feedback affordances shipped (2026-08-26): PR comment footer carries the
      `@gatetest ignore` command AND the support email; the free-preview API
      returns a `feedback` block; the scan status page's failure path already
      had a session-carrying support mailto.
- [x] Launch metrics shipped (2026-08-26): `GET /api/admin/metrics/launch`
      (admin-auth) — pipeline movement by day, push-to-result latency
      (avg/p95), last dead letters (terminal vs exhausted), suppression
      counts by rule. Watch this daily during soft launch.
- [x] First-real-push drill is one command (2026-08-26):
      `node scripts/ops/fire-test-webhook.js` on the box, right after the
      credentials land — exits 0 when a job completes end to end.

## 4. Legal — hard launch blocker

- [ ] **[C]** `/legal/terms` + `/legal/privacy` still render
      "DRAFT … not final legal terms". Needs an attorney (external). Cannot
      take real money at scale on draft terms; a Marketplace reviewer hits this
      immediately.

## 5. Honesty sweep — site says only what ships (four-surface sync)

Started 2026-08-21 (this session). Check off with commit SHAs.

- [x] KI #74 copy (2026-08-21): `/how-it-works` flywheel claims match reality —
      recipes are recorded locally; replay happens only after promotion (which
      today requires the #74f decision, still open — see §6).
- [x] KI #84 copy (2026-08-21): `/how-it-works` + `FlywheelTable` now describe
      the pipeline that actually runs (recipe playback → Claude surgical fix →
      syntax gate → scanner/test gate), not the never-called `try-fix.js`.
      Wire-in vs delete of `try-fix.js` stays a Craig decision (§6); the copy
      no longer depends on it.
- [x] KI #83 (2026-08-21): public/legal self-references to Vercel corrected —
      privacy §7 now says Vultr + Cloudflare + Neon with the false SOC 2 claim
      removed; Vercel sub-processor entry replaced with Vultr + DPA; terms'
      three provider lists say Vultr; four admin hint strings retargeted at
      `website/.env.local` on the deploy box.
- [x] Fabricated `promotedFromCustomers` / `winRate` / `promotedAt` provenance
      stripped from all 8 `src/shipped-rules/*.json`, replaced with
      `"origin": "curated"` (2026-08-21; loader verified, 8/8 still load).
- [ ] `node scripts/marketplace-preflight.js` green. Run 2026-08-21: DO NOT
      SUBMIT — 5 blockers, every one Craig-side (§1/§3/§4): App private key is
      a placeholder, `issues:write` missing, `RESEND_API_KEY` unset, DRAFT
      markers on both legal pages; plus orphaned duplicate app `gatetest-hq`
      (3766251) to delete. Nothing further is repo-fixable.
- [ ] `tests/module-count-sync.test.js` + `tests/marketplace-sync.test.js` green.

## 6. Open Craig product decisions (not launch-blocking, but decide before scale)

- [ ] KI #74f — how a locally distilled recipe earns promotion (decides when
      cached fixes are applied to customer code). Recommendation on file:
      count independent re-derivations via the `duplicate` branch.
- [ ] KI #84 — `try-fix.js`: wire into the real fix route, or delete as
      abandoned (copy no longer references it after §5).
- [ ] KI #95 — `fetchPriorArt`: wire into the repo fix route's diagnosis step
      (adds DB query + prompt cost on the $399 tier), delete the facade, or
      accept the dead export.
- [ ] KI #39 — BYOK × $29/mo MCP gate ruling.

## 7. Standing bar (per-release, mostly automated)

- [ ] Fast suite: `node --test --test-force-exit --test-timeout=60000 tests/*.test.js`
- [ ] Heavy suite: `node --test --test-force-exit --test-timeout=120000 tests/heavy/*.test.js`
- [ ] `cd website && npx next build` — zero errors
- [ ] `node bin/gatetest.js --list` — all 121 modules load
- [x] Next.js security patch level current (2026-08-21) — KI #59 RESOLVED:
      next@16.3.1, `npm audit` reports 0 vulnerabilities in both `website/`
      and root; full regression pass green
- [ ] systemd timers driving `/api/scan/worker/tick` + `/api/watches/tick`
      (verified 2026-08-06 — keep re-verifying after each deploy)
- [ ] Lighthouse Performance 95+ / Accessibility 100 / SEO 100; mobile 320px–2560px
