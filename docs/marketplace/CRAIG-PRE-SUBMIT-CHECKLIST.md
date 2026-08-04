# Marketplace pre-submit checklist — Craig only

**Written 2026-08-04.** Everything on this page needs Craig; none of it can be
done from the repo. The engineering side is finished and pushed.

Context: the listing was rejected once (2026-05-14) and has been under review
since 2026-07-25. Craig's constraint — *"I may not get the third opportunity."*
So this is ordered by **what a reviewer hits first**, not by effort.

---

## 0. Where the listing actually lives

The app is **not** under `crclabs-hq`. There are three GateTest identities:

| Identity | What it is | Owns |
|---|---|---|
| **`Gate-Test`** | Org, created 2026-04-08, 0 repos | **`gatetesthq`, app_id `3322634`** — the live app, matches all current code |
| `crclabs-hq` | Org, created 2026-05-18 | the older orphaned `gatetest-hq`, app_id `3766251` |
| `ccantynz-alt` | Personal account | this repo |

➡️ **Manage the listing at `github.com/organizations/Gate-Test/settings/apps/gatetesthq`.**

---

## 1. 🔴 Redeploy production — do this before anything else

**Nothing below matters until this is done.** Production is serving a build
from **2026-07-29, 60 commits behind `main`**.

Right now a reviewer opening gatetest.io reads:

| They see | Truth |
|---|---|
| "120 modules" | 121 |
| "88 modules" on the $99 card | 121 |
| "Pay only when it fixes something" | charged at checkout — the claim is false |

All three are already fixed in the repo. They reach the public only on redeploy.

- [ ] Redeploy to current `main` per `docs/deploy/VAPRON-DEPLOY.md`
- [ ] Confirm `/api/platform-status` shows the new commit and `1.61.0`
- [ ] Confirm `/docs/configuration` stops 404ing (it exists in source; the
      deployed build predates it)

**Then make it automatic** so this never recurs — the deploy workflow exists
but is inert:

- [ ] Settings → Secrets and variables → Actions → add `BOX_SSH_KEY` and
      `BOX_SSH_HOST`

Until those are set, every push shows a green "Deploy … success" that deployed
nothing. As of `5b8e5be3` it now says so loudly and reports how far behind
production is, but it still cannot deploy without the secrets.

---

## 2. 🔴 Point the App at the live domain

Both apps still advertise **`external_url = https://gatetest.ai`**, which
returns **HTTP 000** — the domain is in redemption. `gatetest.io` serves 200.

A reviewer clicking through from the listing lands on a dead site.

- [ ] Set `external_url` → `https://gatetest.io` on app **3322634**
- [ ] Verify the App's other URLs (need app auth, so unverifiable from here):
  - Setup URL → `https://gatetest.io/github/setup`
  - Webhook URL → `https://gatetest.io/api/webhook`
  - Callback URL → `https://gatetest.io/api/github/callback`

---

## 3. 🔴 Legal pages still say "DRAFT"

`/legal/terms` and `/legal/privacy` are live (HTTP 200) and render:

> **Draft notice.** … should not be treated as final legal terms until that
> review is complete.

Reviewers open the required legal URLs first. A "DRAFT" stamp there is the
single most likely rejection trigger.

- [ ] Attorney sign-off, then remove the `[DRAFT — requires attorney review]`
      markers
- [ ] Privacy policy: name the email sub-processor — it currently says **"TBD"**

---

## 4. 🟠 Broken sign-in buttons

Per live `/api/status`:

- [ ] `GOOGLE_CLIENT_SECRET` unset → **`/api/auth/google` returns 503**
- [ ] `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` unset → **`/api/auth/gitlab`
      returns 503**

Either set them or hide the buttons. A reviewer clicking a sign-in button and
getting a 503 is a failed review.

- [ ] `RESEND_API_KEY` unset → the MCP $29/mo flow takes the money and the API
      key never arrives (the webhook 500s). This is a paying-customer bug
      independent of the Marketplace.

---

## 5. 🟠 Two of everything

A reviewer finding two listings for one product is its own risk.

| | Canonical | Retire / confirm |
|---|---|---|
| GitHub App | `gatetesthq` 3322634 (`Gate-Test`) | `gatetest-hq` 3766251 (`crclabs-hq`) — orphaned |
| VS Code ext | `editors/vscode`, publisher `gatetest` | `vscode-extension` v1.0.1, publisher `GateTestHQ` |

- [ ] Decide which is canonical for each and retire the other
- [ ] Add `issues:write` to the live app — `postPrComment` calls the
      Issues-comments endpoint, so PR comments fail without it. Tests mock the
      HTTP layer, so CI cannot catch this.

---

## 6. Final pass before clicking submit

- [ ] Confirm the uploaded logo/screenshots aren't stale from the rejected
      2026-05-14 submission (old module counts, "Nuclear" tier name)
- [ ] Confirm `hello@gatetest.ai` forwarding works — the last rejection notice
      reportedly sat unread ~2 months
- [ ] Re-read `integrations/marketplace/listing.md`: the 2026-05-14 rejection
      was for describing **paid** functionality without ≥100 installs. The
      listing is now correctly Free-only. Do not reintroduce paid plans.
