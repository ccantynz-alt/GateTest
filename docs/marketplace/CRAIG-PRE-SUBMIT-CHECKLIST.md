# Marketplace pre-submit checklist — Craig only

**Written 2026-08-04. Updated 2026-08-05 after deploying and re-verifying live.**

Context: the listing was rejected once (2026-05-14) and has been under review
since 2026-07-25. Craig's constraint — *"I may not get the third opportunity."*
So this is ordered by **what a reviewer hits first**, not by effort.

## The current answer: DO NOT SUBMIT — 4 blockers

Run `node scripts/marketplace-preflight.js` for this live, any time. As of
2026-08-05, after the deploy, it reports:

| # | Blocker | Who |
|---|---|---|
| 1 | `/legal/terms` + `/legal/privacy` render **"DRAFT … not final legal terms"** | Craig (attorney) |
| 2 | live app **missing `issues:write`** — the PR comment the listing promises fails silently | Craig (App settings) |
| 3 | `RESEND_API_KEY` unset — MCP-tier key delivery takes money and never sends | Craig (box env) |
| 4 | `CRON_SECRET` **repo secret** unset → the `cron-ticks` workflow is disarmed | Craig (optional, see below) |

Plus one warning: the orphaned duplicate app `gatetest-hq` (3766251) is still
installed on `crclabs-hq`.

**#4 is no longer functionally fatal.** The queue is now drained by systemd
timers on the box itself (`scripts/deploy/systemd/`), so scans run without
GitHub Actions. Setting the repo secret would add a redundant second driver;
both ticks are idempotent. Left on the list because the preflight still flags it.

**#3 is NOT the KI #82 typo.** That KI theorised the key was stored as
`RESENDER_API_KEY`. Checked the box directly on 2026-08-05: there is **no
Resend key under any spelling** in `website/.env.local`. It has to be added.

⚠️ **Two things a reviewer would have hit that were NOT on the 2026-08-04 list,
because nobody had probed the running system:**

- **No queued scan had ever executed.** `/api/scan/worker/tick` was returning
  `{"ok":false,"error":"column q.host does not exist"}` under **HTTP 200** —
  production's `scan_queue` predated the dual-host column, and the worker never
  ran the migration the enqueue path runs. Fixed in `d3fe3738`.
- **Nothing ever called the ticks.** Quality bar #12 requires a scheduler;
  there was no cron entry and no timer on the box. Fixed in `39f4e3e1`.

Together those made the listing's central claim — *"scans run on every push"* —
false. A reviewer would have installed, pushed, and seen nothing at all.

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

## 1. ✅ Redeploy production — DONE 2026-08-05

Production was 66 commits behind, serving a 2026-07-29 build. **Deployed and
verified live:**

- [x] `/api/platform-status` → commit `96df6c52`+, version **1.61.0**
- [x] `/docs/configuration` → **200** (was 404)
- [x] `/pricing` → **121 modules** (was 120 / 88)
- [x] `/github/setup` → Contents and Issues both **Read & write**
- [x] the sibling discovery map no longer advertises the dead `gatetest.ai`

Three deploy-path bugs were found and fixed in the process. Each independently
guaranteed the deploy silently did nothing, which is why this drift persisted:

1. **`grep -q` under `set -o pipefail`** — `systemctl list-unit-files | grep -q`
   is false *exactly when it matches*, because `grep -q` exits early, `systemctl`
   dies with SIGPIPE (141), and pipefail reports 141. The restart step had
   therefore never fired on any host, under any unit name. Proven on the box.
2. **The clean-tree guard made the script single-use** — `npm install` and the
   website prebuild dirty tracked files (`package-lock.json`,
   `build-info.json`) *after* the guard, so run 2+ always aborted with
   "uncommitted changes — resolve manually first."
3. **Wrong unit name** — the box runs `gatetest-web.service`, not
   `gatetest.service`.

**Deploy command that works** (Craig is on the tailnet; `jarvis` = the box):

```bash
ssh root@jarvis 'cd /opt/gatetest && git fetch origin main -q \
  && git show origin/main:scripts/deploy/deploy-on-box.sh > /tmp/gt-deploy.sh \
  && GATETEST_APP_DIR=/opt/gatetest bash /tmp/gt-deploy.sh'
```

Running the script from `/tmp` avoids `git reset --hard` rewriting it
mid-execution; `GATETEST_APP_DIR` is then required, because the script otherwise
infers the repo from its own location.

**Then make it automatic** so this never recurs — the deploy workflow exists
but is inert:

- [ ] Settings → Secrets and variables → Actions → add `BOX_SSH_KEY` and
      `BOX_SSH_HOST`

Until those are set, every push shows a green "Deploy … success" that deployed
nothing. As of `5b8e5be3` it now says so loudly and reports how far behind
production is, but it still cannot deploy without the secrets.

### "We have Tailscale — do we still need those secrets?"

Yes, for CI. Tailscale solves **reachability**, not **CI identity**:

| Who is deploying | Needs the secrets? |
|---|---|
| Craig, from his own machine | **No** — he's on the tailnet, just SSH in and run the script |
| GitHub Actions | **Yes** — the runner is an ephemeral Azure VM with no tailnet membership |

Verified 2026-08-04: **port 22 on `66.42.121.161` is open to the public
internet** (`SSH-2.0-OpenSSH_8.9p1`), so `BOX_SSH_*` works today with no
Tailscale involvement at all.

The better long-term posture, since Tailscale already exists, is to **close
public 22** and have CI join the tailnet instead
(`tailscale/github-action` + `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET`). That's
a deliberate infra change, not something to do mid-review — but leaving SSH
open to the whole internet on the box that serves production is worth a
decision either way.

### ✅ Contradiction resolved 2026-08-05 — no longer a Craig decision

The previous version of this checklist asked Craig to rule on whether
production was Vapron or the box, because `docs/deploy/VAPRON-DEPLOY.md` said
*"do not use `scripts/deploy/deploy-on-box.sh`"* while `deploy-box.yml` runs
exactly that script.

**DNS answers it without needing Craig:** `gatetest.io` resolves to
**66.42.121.161** — the box that script targets — and `/api/platform-status`
answered from it on 2026-08-05. Production is the box; `deploy-box.yml`
automates the correct path. The runbook line was the stale half and has been
corrected.

- [x] ~~Craig: confirm which is authoritative~~ — settled by DNS + a live probe.
      Adding `BOX_SSH_*` automates the real path, not a retired one.

(Fixed regardless, in the same pass: the script built with `npx next build`,
skipping the `prebuild` SHA stamp — so it would ship new code while
`/api/platform-status` still reported the old commit, hiding the very drift
this checklist is about. Now `npm run build`.)

---

## 2. 🔴🔴 Point the App at the live domain — THE most important item

**This is now blocker #1, above the legal pages.** It is not just a dead link
in the listing; it severs the product.

Evidence chain, all measured 2026-08-05:

| Step | Measured |
|---|---|
| `scan_queue` row count in production | **0 — nothing has ever been enqueued** |
| `https://gatetest.ai/api/webhook` | **HTTP 000** (NXDOMAIN, registry redemption) |
| `https://gatetest.io/api/webhook` | **HTTP 200** |
| App `external_url` | still `https://gatetest.ai` |

So every push webhook GitHub has ever sent us has failed to deliver. That is
why the queue is empty — and it means the two fixes shipped today (the
`q.host` migration and the systemd timers) make the drain *work*, but there is
still **nothing arriving to drain** until the App is repointed.

Be precise about this: after today's work the pipeline is correct from
`/api/webhook` onward, and severed before it. Only Craig can reconnect it.

- [ ] Set `external_url` → `https://gatetest.io` on app **3322634**
- [ ] **Set Webhook URL → `https://gatetest.io/api/webhook`** ← the one that
      actually breaks the product
- [ ] Setup URL → `https://gatetest.io/github/setup`
- [ ] Callback URL → `https://gatetest.io/api/github/callback`
- [ ] Then confirm delivery: push to any installed repo and check
      `SELECT count(*) FROM scan_queue;` is non-zero, or watch
      `journalctl -u gatetest-tick.service -f` show a non-idle tick.

GitHub's App settings page has a **Recent Deliveries** tab — every entry there
should currently show a delivery failure against `gatetest.ai`. That is the
fastest confirmation of the above.

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

---

## 5b. 🔴 Grant the App the scopes the code actually calls

Settled in code 2026-08-05 — `src/core/github-app-permissions.js` is now the
single declaration, and `tests/marketplace-sync.test.js` proves it covers every
endpoint the bridge calls. **The live App still has to be granted them by hand**
(nothing in this repo can edit github.com):

| Permission | Level | Forced by |
|---|---|---|
| Contents | **Read & write** | `POST .../git/refs` + `POST .../git/commits` — the auto-fix branch |
| Pull requests | Read & write | `POST .../pulls` |
| Commit statuses | Read & write | `POST .../statuses/{sha}` |
| **Issues** | **Read & write** | `POST .../issues/{n}/comments` — the PR comment the listing promises |
| Metadata | Read | `GET /repos/{o}/{r}` |

Webhook events: `push`, `pull_request`, `workflow_run` (all three are branched
on in `website/app/lib/github-events.js`).

- [ ] Set all five scopes + all three events on app **3322634**
- [ ] Note: `Contents` was disclosed to customers as **Read** on both the
      install page and the listing until 2026-08-05. Both now say Read & write,
      matching what GitHub's install prompt actually asks for. Tests mock the
      HTTP layer, so CI cannot catch a missing grant — only the live App can.
- [ ] Run `node scripts/marketplace-preflight.js` once `gh` is authenticated;
      it verifies the live grants automatically (it was querying the wrong org
      until 2026-08-05, so any previous "pass" from it meant nothing).

---

## 6. Final pass before clicking submit

- [ ] Confirm the uploaded logo/screenshots aren't stale from the rejected
      2026-05-14 submission (old module counts, "Nuclear" tier name)
- [ ] Confirm `hello@gatetest.ai` forwarding works — the last rejection notice
      reportedly sat unread ~2 months
- [ ] Re-read `integrations/marketplace/listing.md`: the 2026-05-14 rejection
      was for describing **paid** functionality without ≥100 installs. The
      listing is now correctly Free-only. Do not reintroduce paid plans.
