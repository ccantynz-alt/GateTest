# GateTest GitHub App — Registration Guide

## Step 1: Register the App

Go to: https://github.com/settings/apps/new

Fill in these fields:

| Field | Value |
|-------|-------|
| **GitHub App name** | `GateTest` |
| **Homepage URL** | `https://gatetest.io` |
| **Callback URL** | `https://gatetest.io/api/github/callback` |
| **Setup URL** | `https://gatetest.io/github/installed` |
| **Webhook URL** | `https://gatetest.io/api/webhook` |
| **Webhook secret** | Generate a strong random string (save it!) |

### Permissions needed:

**Repository permissions:**
- Contents: **Read** (to read code and scan it)
- Commit statuses: **Read & Write** (to post pass/fail checks)
- Pull requests: **Read & Write** (to post scan comments)
- Metadata: **Read** (always required)

**Subscribe to events:**
- [x] Push
- [x] Pull request

**Where can this app be installed?**
- [x] Any account

Click **Create GitHub App**.

---

## Step 2: Generate Private Key

On the app settings page:
1. Scroll to **Private keys**
2. Click **Generate a private key**
3. A `.pem` file downloads — keep this safe!

---

## Step 3: Set Environment Variables on Vercel

Go to Vercel → Project Settings → Environment Variables.

Add these three:

| Name | Value |
|------|-------|
| `GATETEST_APP_ID` | The App ID shown on the app settings page |
| `GATETEST_PRIVATE_KEY` | Contents of the `.pem` file (entire text including BEGIN/END lines) |
| `GATETEST_WEBHOOK_SECRET` | The webhook secret you created in Step 1 |

**Important:** For `GATETEST_PRIVATE_KEY`, paste the entire PEM contents.
Vercel handles multi-line env vars. If it doesn't work, replace newlines with `\n`.

---

## Step 4: Deploy and Test

1. Redeploy on Vercel (so it picks up the env vars)
2. Install the app on a test repo: https://github.com/apps/GateTestHQ
3. Push a commit — you should see:
   - "GateTest: Scanning..." pending status
   - Then "GateTest: All clear" or "GateTest: X issues found"
4. Open a PR — GateTest posts a detailed comment with results

---

## Step 5: List on GitHub Marketplace (optional)

On the app settings page:
1. Click **Marketplace listing** in the sidebar
2. Fill in:
   - **Short description**: "20 test modules scan your code on every push. Security, accessibility, performance, and more."
   - **Full description**: Use the marketing copy from MARKETING.md
   - **Pricing**: Free (we charge via gatetest.io, not GitHub)
   - **Categories**: Code quality, Security, Testing
3. Submit for review

---

## URLs Summary

| URL | Purpose |
|-----|---------|
| `https://gatetest.io/github/setup` | "Install GateTest" landing page |
| `https://gatetest.io/github/installed` | Post-install success page |
| `https://gatetest.io/api/github/callback` | GitHub redirects here after install |
| `https://gatetest.io/api/webhook` | Receives push/PR events from GitHub |

---

## Testing

Verify the webhook is working:
```
curl https://gatetest.io/api/webhook
# Should return: {"status":"ok","app":"GateTest","configured":true}
```
