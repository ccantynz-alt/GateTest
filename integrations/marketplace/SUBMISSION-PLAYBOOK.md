# GitHub Marketplace submission — step-by-step

> **Total time:** 20 minutes of your time, then 2-3 weeks of GitHub review.
> **Outcome:** GateTest listed at github.com/marketplace/gatetest, free + paid tiers visible to every GitHub user.
>
> Everything below is Craig's action — only Craig can submit because the
> GateTestHQ App is owned by his account.

---

## Pre-flight checklist (do this once, ~5 min)

Before opening the Marketplace listing form:

- [ ] **App is published**, not just registered — go to
      https://github.com/settings/apps → GateTestHQ → check the "Public"
      toggle is on (not "Private")
- [ ] **App has a homepage URL** = `https://gatetest.ai`
- [ ] **App has a callback URL** = `https://gatetest.ai/api/github/callback`
- [ ] **App has a webhook URL** = `https://gatetest.ai/api/webhook`
- [ ] **App has a 200x200 logo** uploaded — should be the GateTest mark
      (not the wordmark)
- [ ] **App has been installed on at least 1 public repo** that isn't
      yours (proves it works for the wider world)

---

## Step 1: Open the Marketplace listing form (1 min)

1. Go to https://github.com/settings/apps
2. Click **GateTestHQ**
3. Left sidebar → **Public page**
4. Scroll down → **List on Marketplace**

If "List on Marketplace" is greyed out, the pre-flight is incomplete.

---

## Step 2: Fill the listing fields (10 min — copy from `listing.md`)

The form has these sections. Each cell below tells you what file to paste from.

| Field | Source |
|---|---|
| **Name** | `GateTest` |
| **Categories** | Pick **Code review** + **Continuous integration** + **Code quality** |
| **Use case (short, 160 chars)** | `listing.md` → "Short description" block — already 160 chars |
| **Description (Markdown, long)** | `listing.md` → "Full description" block — paste verbatim |
| **Logo (200x200 PNG)** | Upload `integrations/marketplace/assets/logo-200.png` (you'll need to export from your design tool) |
| **Feature card (1280x640 PNG)** | Upload `integrations/marketplace/assets/feature-card.png` (same — design step) |
| **Privacy policy URL** | `https://gatetest.ai/legal/privacy` |
| **Terms of service URL** | `https://gatetest.ai/legal/terms` |
| **Status URL** | `https://gatetest.ai/status` (just shipped this commit) |
| **Support email** | `hello@gatetest.ai` |

---

## Step 3: Add pricing plans (5 min)

GitHub Marketplace supports both **free** and **paid** plans. Add these:

### Plan 1: Free
- **Plan name:** `Quick Scan`
- **Description:** `4 module quick scan — syntax, lint, secrets, code quality. 60s end-to-end.`
- **Price:** Free
- **Has a free trial:** No (the entire plan is free)

### Plan 2: Paid (per-month, since GitHub Marketplace doesn't support per-scan)
- **Plan name:** `Continuous`
- **Description:** `All 90 modules. Auto-fix PRs. AI code review. Pair-review. Architecture annotations. Unlimited scans.`
- **Pricing model:** Per-unit (per repo)
- **Price:** $49/month per repo
- **Has a free trial:** Yes — 14 days

### Plan 3: Paid (Nuclear)
- **Plan name:** `Nuclear`
- **Description:** `Everything in Continuous + Claude per-finding diagnosis + cross-finding correlation + mutation testing + chaos testing + executive summary. Boardroom-ready.`
- **Pricing model:** Per-unit (per repo)
- **Price:** $199/month per repo
- **Has a free trial:** Yes — 14 days

> Note: the per-scan tiers ($29 / $99 / $199 / $399) on gatetest.ai stay
> as-is — they're served from the website, not the Marketplace billing.
> The Marketplace listing pushes customers toward the recurring plans
> because that's what GitHub's billing supports.

---

## Step 4: Screenshots (3 min — but design work is on you)

You need **at least 3 screenshots, max 10**. Recommended set:

1. **Hero screenshot** — gatetest.ai homepage with the new free-preview scanner visible (just shipped this commit)
2. **Live scan in progress** — `/scan/status` page mid-scan, with the LiveScanTerminal running
3. **Findings panel** — completed scan with the FindingsPanel showing real findings
4. **Fix PR opened on GitHub** — screenshot of the PR GateTest opens after a Scan + Fix run
5. **Inline diff viewer** — the new before/after diff component (just shipped 6.1.3)
6. **Pricing page** — show all 4 tiers
7. **Status page** — gatetest.ai/status with all green probes (just shipped this commit)
8. **Public proof page** — gatetest.ai/fixes (just shipped this commit)

Resolution: at least 1280x720, max 10MB each, PNG or JPG.

Crop tightly — Marketplace renders these in a carousel and dead space looks amateur.

---

## Step 5: Submit for review (1 min)

1. Click **Save draft** to confirm everything saves
2. Re-read the long description — typos in this field are the #1 reason GitHub bounces listings
3. Click **Submit for review**

GitHub's review takes **2-3 weeks**. They check:
- App actually works on a public repo (they install it on a test repo)
- Privacy policy is real and applies to GitHub data
- Pricing is consistent between the Marketplace plan and your billing
- Logo + screenshots meet quality bar
- No misleading claims (don't say "the only X" if there's a competitor)

---

## Step 6: After approval

When GitHub approves:
1. Listing goes live at `github.com/marketplace/gatetest`
2. Add the badge to README:
   ```markdown
   [![Available on GitHub Marketplace](https://img.shields.io/badge/Marketplace-Available-brightgreen?logo=github)](https://github.com/marketplace/gatetest)
   ```
3. Update gatetest.ai homepage with a "Install from GitHub Marketplace" CTA (1 button)
4. Tweet / Post on Hacker News announcing it
5. Watch the install counter go up

---

## What can go wrong + how to fix

| Problem | Fix |
|---|---|
| "App must have webhook events configured" | Settings → Webhook → tick `push` + `pull_request` + `installation` |
| "Webhook URL must respond 200 within 10s" | `/api/webhook` already does — verify with curl from the Marketplace form's "Test webhook" button |
| "Logo too small" | Re-export at exactly 200x200, PNG, no transparency around the edges |
| "Privacy policy doesn't mention how GitHub data is used" | Add a "GitHub data" section to gatetest.ai/legal/privacy explaining: we read repo contents to scan, don't persist source code, only persist hashed scan fingerprints |
| Listing rejected for "misleading claim" | The bot checks for words like "the only", "best", "fastest" — soften them |

---

## Reference: existing assets in this repo

- `integrations/marketplace/listing.md` — long-form copy
- `integrations/marketplace/screenshots.md` — capture script + storyboard
- `integrations/github-actions/gatetest-gate.yml` — drop-in CI workflow
- `integrations/scripts/install.sh` — one-line installer
