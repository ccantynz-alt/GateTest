# GateCode — Automated QA Scanner Service

## What GateCode Is

GateCode is the **always-on service** that runs GateTest automatically across
all your projects. While GateTest is the testing engine, GateCode is the
automation layer that watches your repos and triggers scans without you
having to ask.

## How It Works

```
Your Repos (Zoobicon, etc.)
    ↓ (push event / schedule / manual trigger)
GateCode Service (gatecode.io / gatecode.dev)
    ↓
Runs GateTest (19 modules, live crawl, explorer, chaos)
    ↓
Results → Dashboard / PR comments / Slack alerts / Email
    ↓
If issues found → Triggers Claude to fix → Retests → Loop
```

## The Two Products Together

| | GateTest | GateCode |
|--|---------|----------|
| **What** | Testing engine (CLI) | Automation service |
| **Where** | Runs locally or in CI | Runs in the cloud 24/7 |
| **When** | When you tell it to | Automatically on every push |
| **How** | `node gatetest-scan.js` | Watches GitHub webhooks |
| **Cost** | Free forever | Free tier + paid plans |
| **Domain** | gatetest.io | gatecode.io / gatecode.dev |

## GateCode Features (To Build)

### 1. GitHub App
- Install on any repo with one click
- Receives push/PR webhooks automatically
- Posts scan results as PR comments
- Sets commit status (pass/fail)
- No tokens to manage — OAuth handles auth

### 2. Dashboard (gatecode.io)
- See all your projects in one place
- Historical scan results with trends
- "Last scanned: 2 minutes ago — 0 issues"
- Click into any project to see full report
- Compare scans over time

### 3. Scheduled Scans
- Cron-based: scan every hour, daily, weekly
- Always-on monitoring even when no one is pushing code
- Alert if a previously-clean page breaks (dependency update, CDN issue, etc.)

### 4. Multi-Repo Management
- Add all your repos: Zoobicon, GateTest, any future projects
- Each repo gets its own config
- Global settings + per-repo overrides
- Team access controls

### 5. Alert Channels
- Slack: "#qa-alerts: GateTest found 3 issues on zoobicon.com"
- Email: Daily digest of scan results
- GitHub: PR comments with full reports
- Webhook: POST to any URL with results

### 6. Claude Integration (The Killer Feature)
- GateCode detects issues
- GateCode opens a Claude Code session automatically
- Claude reads the report, fixes the issues
- GateCode retests
- Loop until clean
- Human only gets notified when it's all done
- "GateCode fixed 7 issues on zoobicon.com while you were sleeping"

## Architecture

```
┌─────────────────────────────────────┐
│           gatecode.io               │
│                                     │
│  ┌──────────┐    ┌──────────────┐  │
│  │ Dashboard │    │ GitHub App   │  │
│  │  (React)  │    │ (Webhooks)   │  │
│  └─────┬─────┘    └──────┬───────┘  │
│        │                 │          │
│  ┌─────┴─────────────────┴───────┐  │
│  │        Scan Orchestrator       │  │
│  │  (queues, schedules, triggers) │  │
│  └─────────────┬─────────────────┘  │
│                │                    │
│  ┌─────────────┴─────────────────┐  │
│  │      GateTest Engine          │  │
│  │  (19 modules, crawler, loop)  │  │
│  └─────────────┬─────────────────┘  │
│                │                    │
│  ┌─────────────┴─────────────────┐  │
│  │     Results & Reporting       │  │
│  │  (DB, alerts, PR comments)    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

## Revenue Model

- **Free**: 1 project, 10 scans/month, basic alerts
- **Pro** ($29/month): Unlimited projects, unlimited scans, Slack, dashboard
- **Team** ($79/month): Team access, historical trends, compliance reports
- **Enterprise**: SSO, SLA, on-premise, dedicated support

## The Repository Problem (Why GateCode Exists)

Every time Claude starts a new session, it fights with GitHub tokens,
auth, permissions. GateCode solves this permanently:

1. Install the GateCode GitHub App on your org — ONE TIME
2. GateCode has permanent, secure access to your repos
3. No more token management, no more auth failures
4. Claude talks to GateCode, GateCode talks to GitHub
5. Problem solved forever

## Domain

**gatecode.io** or **gatecode.dev** — to be secured

## Priority Build Order

1. ✅ GateTest engine (DONE — 19 modules, crawler, AI loop)
2. ✅ GateTest setup script (DONE — installs into any project)
3. 🔲 GateCode GitHub App (receives webhooks, posts results)
4. 🔲 GateCode Dashboard (web UI to see all projects)
5. 🔲 GateCode Scheduler (cron-based scans)
6. 🔲 GateCode Claude Integration (auto-fix loop)
7. 🔲 GateCode Alerts (Slack, email, webhook)

---

Last updated: 2026-04-05
