# GateCode GitHub App — Setup Checklist

**This is the ONE thing standing between you and a fully operating GateCode.**

The webhook code is already deployed at `https://gatetest.io/api/webhook`.
It just needs 3 environment variables to come alive.

---

## What You're Doing

Creating a GitHub App called "GateTest" (or similar) that:
- Receives push and pull request webhooks from any repo it's installed on
- Authenticates as a GitHub App using a JWT
- Runs GateTest scans
- Posts results back as PR comments and commit statuses

---

## Step 1 — Create the GitHub App (5 minutes)

**Go to:** https://github.com/settings/apps/new

Fill in these fields:

| Field | Value |
|-------|-------|
| **GitHub App name** | `GateTest` (or `GateTest-QA` if taken — must be globally unique) |
| **Description** | `The QA gate for AI-generated code. Scans every push and PR.` |
| **Homepage URL** | `https://gatetest.io` |
| **Webhook → Active** | ☑ checked |
| **Webhook URL** | `https://gatetest.io/api/webhook` |
| **Webhook secret** | Generate one: run `openssl rand -hex 32` in a terminal and paste the output. **SAVE THIS — you need it for Vercel.** |

### Repository permissions (scroll down)

| Permission | Access |
|------------|--------|
| Contents | **Read-only** |
| Issues | **Read & write** |
| Pull requests | **Read & write** |
| Commit statuses | **Read & write** |
| Metadata | Read-only (mandatory, auto-selected) |

### Subscribe to events

- ☑ **Push**
- ☑ **Pull request**

### Where can this GitHub App be installed?

- ◉ **Any account** (so others can install on their repos — required for SaaS)

Click **Create GitHub App**.

---

## Step 2 — Get the 3 Credentials

After creation, you land on the App settings page.

### Credential 1: App ID
At the top of the page you'll see something like:
```
App ID: 123456
```
**Copy this number.** This is `GATETEST_APP_ID`.

### Credential 2: Private Key
Scroll down to **Private keys** section.
Click **Generate a private key**.
A `.pem` file downloads automatically (e.g. `gatetest.2026-04-06.private-key.pem`).
Open it in a text editor. The contents look like:
```
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA....many lines....
-----END RSA PRIVATE KEY-----
```
**Copy the ENTIRE contents** (including the BEGIN and END lines).
This is `GATETEST_PRIVATE_KEY`.

### Credential 3: Webhook Secret
The random string you generated and pasted in Step 1.
This is `GATETEST_WEBHOOK_SECRET`.

---

## Step 3 — Add to Vercel (3 minutes)

**Go to:** https://vercel.com/dashboard → your `gatetest` project → **Settings** → **Environment Variables**

Add three variables, each for the **Production** environment:

| Name | Value | Notes |
|------|-------|-------|
| `GATETEST_APP_ID` | The number from Step 2 | e.g. `123456` |
| `GATETEST_PRIVATE_KEY` | The full .pem file contents | Paste including BEGIN/END lines and all line breaks. Vercel handles multi-line. |
| `GATETEST_WEBHOOK_SECRET` | The random hex string | Same one you put in the GitHub App webhook field |

After saving all three:
- Go to **Deployments** tab
- Click the latest deployment
- Click **Redeploy** (top right) to pick up the new env vars

---

## Step 4 — Install the App on Your Repos

**Go to:** `https://github.com/apps/gatetest` (or whatever name you chose)

Click **Install**, choose your account, then either:
- **All repositories** (recommended for testing)
- **Only select repositories** → pick `GateTest` and any others you want scanned

---

## Step 5 — Test It

Push any commit to a watched repo, then check:

1. **GitHub commit status:** A "GateTest" check should appear next to your commit (yellow → green/red)
2. **PR comments:** Open a PR and you should see a GateTest comment with the results table
3. **Vercel logs:** https://vercel.com/dashboard → gatetest → Logs — look for `[GateTest]` entries

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Webhook returns 401 | Wrong webhook secret | Re-copy from GitHub App settings, paste into Vercel |
| Webhook returns 500 with "App not configured" | `GATETEST_APP_ID` missing | Add to Vercel and redeploy |
| JWT errors in logs | Private key malformed | Re-paste the full .pem including BEGIN/END lines |
| No webhook firing at all | App not installed on repo | Install via apps page |
| Webhook fires but no PR comment | Permissions missing | Edit App → ensure Issues + PRs are Read & Write |

---

## Step 6 (Optional) — Verify the App

Once it's working:
- Go to your App settings → **Advanced** → **Request verification**
- GitHub reviews and adds a verified badge (a few days)
- Required if you want to list on the GitHub Marketplace

---

## What's Already Built (No Action Needed)

| Component | Location | Status |
|-----------|----------|--------|
| Webhook endpoint | `website/app/api/webhook/route.ts` | ✅ Deployed |
| JWT authentication | Same file | ✅ Deployed |
| Signature verification | Same file | ✅ Deployed |
| Repo scanning logic | Same file (`scanRepo` function) | ✅ Deployed |
| PR comment formatter | Same file (`formatComment` function) | ✅ Deployed |
| Commit status setter | Same file | ✅ Deployed |
| Vercel deployment | Already live at gatetest.io | ✅ Live |

**Everything else is done. Just add the 3 environment variables and the app comes alive.**
