# HANDOVER — Session Transfer File

> **READ THIS FIRST** when starting a new session on ANY username.
> This file is the single source of truth for project continuity.
> Updated automatically at end of every session.

---

## Last Updated
- **Date**: 2026-04-05
- **Branch**: `claude/gate-test-qa-system-bztML`
- **Last Commit**: `8b5ba2e` — Polish website — fix 11 dead links, real URLs, clean footer

---

## What GateTest IS (30-second briefing)

GateTest is an **AI-powered QA gate** — a CLI tool with 16 test modules that scans code before it ships. Nothing gets pushed unless every check passes. It has:
- A **CLI tool** (`npm install -g gatetest`) with 16 modules
- A **marketing website** at gatetest.io (Next.js + Tailwind, deployed on Vercel)
- A **GitHub App** that auto-scans repos on push/PR via webhooks
- A **CLAUDE.md generator** that writes project-specific quality rules

---

## Current State — What's DONE

### Core CLI (working)
- 16 test modules: syntax, lint, security, a11y, perf, visual, SEO, compat, quality, links, data, unit, integration, e2e, secrets, docs
- Console reporter, JSON reporter, interactive HTML dashboard reporter
- CLAUDE.md parser that reads and enforces rules
- `--init-claude-md` flag auto-generates CLAUDE.md for any project
- `gatecode.sh` with scan-repo, dashboard, watch commands
- Continuous background scanner

### Website (deployed on Vercel)
- 12 components: Navbar, Hero, Problem, AiNative, HowItWorks, Modules, Comparison, Integrations, ContinuousScanning, GateRules, Pricing, Cta, Footer
- All links working (GitHub, npm, mailto, anchor links)
- Dark theme, terminal aesthetics, glow effects
- Vercel config: `vercel.json` with `rootDirectory: "website"`

### GitHub App (code ready, needs setup)
- Webhook handler: `website/app/api/webhook/route.ts` (Vercel serverless)
- Standalone server: `src/app-server.js` (for non-Vercel hosting)
- Handles: push events, PR events, installation events
- Posts: commit statuses, PR comments with scan results
- **NOT YET CREATED** on GitHub — needs 5-minute setup (see below)

### Claude Hooks (built for Zoobicon, template ready)
- 3-layer enforcement: SessionStart, PreToolUse, Stop
- Forces Claude to read CLAUDE.md and run GateTest every session
- Template in session history, needs to be generalized

---

## Current State — What's NOT DONE

### Immediate (do these next)
1. **Create GitHub App on github.com** — Settings > Developer Settings > GitHub Apps > New
   - Webhook URL: `https://gatetest.io/api/webhook`
   - Permissions: Contents (read), Pull requests (read+write), Commit statuses (read+write)
   - Events: Push, Pull request
   - Generate private key, set env vars on Vercel: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
2. **Push Zoobicon changes** — 3 commits waiting (hooks, scan report, updated report). Needs `git push` from user's machine with auth.
3. **Install GitHub App on repos** — ccantynz-alt/GateTest, Zoobicon, bookaride

### Short-term
- Set up GateTest scanning on `bookaride` repo
- Generalize the Claude hooks into a template that `--init-claude-md` generates
- Add more scan modules for deeper analysis
- Build scan history trending in dashboard

### Medium-term
- GitHub Marketplace listing (optional — GateTest works without it)
- Public documentation site
- CI/CD pipeline templates (GitHub Actions, Vercel, Netlify)

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Quality rules, enforced every build |
| `MARKETING.md` | Positioning, pricing, website copy |
| `bin/gatetest.js` | CLI entry point |
| `src/index.js` | Main library, orchestrates 16 modules |
| `src/core/claude-md-generator.js` | Auto-generates CLAUDE.md for any project |
| `src/reporters/html-reporter.js` | Interactive dashboard with checkboxes |
| `src/app-server.js` | Standalone GitHub App server |
| `website/app/api/webhook/route.ts` | Vercel webhook handler for GitHub App |
| `website/app/page.tsx` | Main website page (assembles sections) |
| `gatecode.sh` | Shell CLI: scan-repo, dashboard, watch |

---

## User Preferences (IMPORTANT)

- **Wants clear visibility** — not scrolling text, but a dashboard showing what's broken/fixed/remaining
- **Hates "circus" output** — scan results must be organized, categorized, with progress tracking
- **Jumps between usernames** — this handover file exists so any session can pick up instantly
- **Works from iPad sometimes** — can't always run git commands locally
- **Wants GateTest to be "the most advanced AI testing system ever launched"**
- **Autonomous = key** — no manual approval gates, no human bottlenecks
- **GitHub App must "just work"** — no GitHub Marketplace approval needed (confirmed: personal apps don't need it)

---

## Repos Being Managed

| Repo | Status | Notes |
|------|--------|-------|
| `ccantynz-alt/GateTest` | Active | This repo. CLI + website |
| Zoobicon.com | Scanned | 98 issues found, report at `.gatetest/reports/fix-these.md`. 3 commits unpushed. |
| bookaride | Queued | User shared Vercel URL, not yet scanned |

---

## How to Continue a Session

```bash
# 1. Read this file
cat HANDOVER.md

# 2. Check where we left off
git status && git log --oneline -5 && git branch

# 3. Read CLAUDE.md for full rules
# (Already loaded by hooks if set up)

# 4. Pick up from "What's NOT DONE" section above
```

---

*This file is updated at the end of every session. If it's stale, check `git log` for the latest work.*
