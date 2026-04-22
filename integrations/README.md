# GateTest — Platform Integration

**This directory is a PROTECTED INTEGRATION ARTIFACT.** It must not be deleted,
renamed, or weakened by any future session. See the root `CLAUDE.md` →
**PROTECTED PLATFORMS** section.

---

## What this is

GateTest is sold as a **standalone subscription product** on gatetest.ai.
This directory contains drop-in artifacts so the same engine can also protect
Craig's internal platforms **without making GateTest non-standalone.**

Today's protected platforms:

| Platform     | Repository                                         |
| ------------ | -------------------------------------------------- |
| Crontech.ai  | https://github.com/ccantynz-alt/Crontech           |
| Gluecron.com | https://github.com/ccantynz-alt/Gluecron.com       |

Every push and PR on those repos runs the full GateTest quality gate.
Broken code is rejected before it ships.

---

## How to install into a new repo (60 seconds)

From the root of the target repository:

```bash
curl -sSL https://raw.githubusercontent.com/ccantynz-alt/gatetest/main/integrations/scripts/install.sh | bash
git add .github .husky .gatetest.json
git commit -m "chore: install GateTest quality gate"
git push
```

That installs three things:

1. `.github/workflows/gatetest-gate.yml` — CI quality gate on every push/PR
2. `.husky/pre-push` — local pre-push hook (requires `npx husky init` once)
3. `.gatetest.json` — protection marker telling future automation this repo is protected

---

## Architecture — why GateTest stays standalone

```
┌────────────────────────────────┐        ┌──────────────────────────┐
│  gatetest (this repo)          │        │  Crontech / Gluecron     │
│  - sold as subscription        │        │  - consumes GateTest     │
│  - product on gatetest.ai      │        │  - no code copied in     │
│  - zero deps, clones in CI     │◄───────┤  - updates automatically │
└────────────────────────────────┘        └──────────────────────────┘
```

Target repos clone GateTest at CI time — nothing is vendored, nothing is forked,
nothing is duplicated. Ship a fix to GateTest → every protected platform picks
it up on the next CI run. Compounding moat, not drift.

---

## Protection rules

1. **NEVER** delete `integrations/` from this repo.
2. **NEVER** delete `.github/workflows/gatetest-gate.yml` from a protected repo.
3. **NEVER** delete `.husky/pre-push` from a protected repo.
4. **NEVER** delete `.gatetest.json` from a protected repo — it is the marker.
5. **NEVER** add `continue-on-error: true` to the gate step.
6. **NEVER** let a future Claude session "simplify" these files away.

Any change that weakens protection requires Craig's explicit authorization.
See the Bible → **THE FORBIDDEN LIST**.
