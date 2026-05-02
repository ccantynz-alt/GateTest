# Refund / Credit Comms — DRAFT for Craig's Review

**Status:** DRAFT. Not sent. Boss Rule #9 — Craig sends, modifies, or discards.

**Context:** A $199 Scan + Fix customer received a deliverable that did not include the pair-review and architecture-annotator features promised at that tier. Root cause: every caller of `/api/scan/fix` omitted the `tier` field from the request body, so the route silently fell back to the $99 deliverable. Confirmed by audit at `website/app/api/scan/fix/route.ts:1043,1068` and all four callers (`scan/status/page.tsx:241`, `AdminPanel.tsx:361,417,1441`, `watches/tick/route.ts:161`).

**Severity:** This is a delivery-promise failure, not a scan failure. The scan ran. The fix PR was opened. The two $199-only PR comments (pair-review critique + architecture observations) never posted.

---

## Option 1 — Honest, full refund

> Subject: GateTest Scan + Fix — refund processed
>
> Hi [name],
>
> When you bought the $199 Scan + Fix tier on [date], your scan ran and the fix PR opened — but two of the deliverables you paid for didn't post: the pair-review critique on each fix, and the architecture-shape report. I found the cause in an audit this week: every internal call to our fix endpoint was missing a tier flag, so the system silently fell back to the $99 deliverable.
>
> You paid $199 and received the $99 product. That's on us, not you. I've processed a full refund of $199 to the card on file — it should appear within 3-5 business days.
>
> The fix is shipping this week along with a deeper rework of the auto-fix pipeline. When it's back online I'll send you a credit code so you can run the real Scan + Fix on your repo at no charge.
>
> — Craig
> GateTest

## Option 2 — Refund the difference + credit

> Subject: GateTest Scan + Fix — partial refund + credit
>
> Hi [name],
>
> Your $199 Scan + Fix scan delivered the scan and fix PR you paid for, but two pieces of that tier — the per-fix pair-review critique and the architecture report — didn't post because of a tier-flag bug in our pipeline that I discovered in an audit this week.
>
> You effectively received the $99 deliverable. I've refunded the $100 difference back to the card on file, and I'm including a $199 credit so you can re-run the full Scan + Fix on any repo once the rework ships next week.
>
> — Craig
> GateTest

## Option 3 — Credit only (least cash impact)

> Subject: GateTest Scan + Fix — credit on the way
>
> Hi [name],
>
> Your $199 Scan + Fix on [date] ran the scan and opened the fix PR, but two parts of that tier — the pair-review critique on each fix and the architecture-shape report — didn't post. An audit I ran this week traced it to a bug in our pipeline.
>
> I'm sending you a $199 credit code so you can re-run the full Scan + Fix on any repo at no charge once the upgrade I'm working on ships next week. The new version is materially better than what you originally bought, so the credit lands on the upgraded product.
>
> If you'd prefer a cash refund instead, just reply and I'll process it.
>
> — Craig
> GateTest

---

## Recommendation

**Option 1.** Cleanest. Removes any argument the customer could later make. The cash hit is $199; the trust gain is permanent. The Bible's Forbidden List #20 says "never ask Craig 'do you want me to fix this?' — if it's broken, FIX IT" — applied to customer relationships, the equivalent is "if you took the wrong amount, give it back without negotiating."

The credit-on-rerun offer at the end of Option 1 is also good marketing: this customer will be the first to try the surgical-fix mode and become either an evangelist or an early honest critic. Both outcomes are useful.

## Stripe action

When you've decided which option to send:
- Stripe Dashboard → Payments → search for the customer's email
- Refund the captured Payment Intent (full $199 for Option 1, partial $100 for Option 2)
- Note: Stripe processes refunds back to the original card; no extra customer action needed

## After sending

Add the customer's email to a `early-rerun-credits` list (Notion / spreadsheet / wherever your CRM lives) so we can hand out the rerun code when surgical-fix ships.
