#!/usr/bin/env bash
# GateTest never-idle sweep. Runs on Stop.
# Exit 0 = all green, stop is allowed.
# Exit 2 = something is red, wake the model with findings.
# Loop-guard: bounded to 3 consecutive rewakes per session so the model can't be
# trapped in an unfixable red state.
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || exit 0

SENTINEL="/tmp/gatetest-sweep-count-${USER:-nobody}.txt"
MAX_REWAKES=3

count=0
[ -f "$SENTINEL" ] && count=$(cat "$SENTINEL" 2>/dev/null || echo 0)
if ! [[ "$count" =~ ^[0-9]+$ ]]; then count=0; fi

if [ "$count" -ge "$MAX_REWAKES" ]; then
  rm -f "$SENTINEL"
  exit 0
fi

findings=""

# 1. Tests
if ! node --test tests/*.test.js >/tmp/gatetest-sweep-tests.log 2>&1; then
  failed=$(grep -E "^(not ok|# fail)" /tmp/gatetest-sweep-tests.log | head -5 | sed 's/^/    /')
  findings+=$'\n- Tests failing:\n'"$failed"
fi

# 2. Website build (only if website/ exists and node_modules present — slow, skip otherwise)
if [ -d website/node_modules ]; then
  if ! (cd website && npx --no-install next build >/tmp/gatetest-sweep-build.log 2>&1); then
    errs=$(grep -E "(error|Error)" /tmp/gatetest-sweep-build.log | head -3 | sed 's/^/    /')
    findings+=$'\n- Website build failing:\n'"$errs"
  fi
fi

# 3. Module registry loads
if ! node bin/gatetest.js --list >/tmp/gatetest-sweep-modules.log 2>&1; then
  err=$(head -3 /tmp/gatetest-sweep-modules.log | sed 's/^/    /')
  findings+=$'\n- Module registry failing to load:\n'"$err"
fi

# 4. Unresolved TODO/FIXME in recently-touched files (git diff HEAD)
if git rev-parse --git-dir >/dev/null 2>&1; then
  recent=$(git diff --name-only HEAD 2>/dev/null | grep -E '\.(js|ts|tsx)$' || true)
  if [ -n "$recent" ]; then
    todos=$(echo "$recent" | xargs -r grep -l -E 'TODO|FIXME' 2>/dev/null | head -5 | sed 's/^/    /')
    if [ -n "$todos" ]; then
      findings+=$'\n- TODO/FIXME in touched files:\n'"$todos"
    fi
  fi
fi

if [ -z "$findings" ]; then
  rm -f "$SENTINEL"
  exit 0
fi

count=$((count + 1))
echo "$count" > "$SENTINEL"

cat <<EOF
Never-idle sweep found issues ($count/$MAX_REWAKES):
$findings

Per CLAUDE.md ALWAYS-ON MODE: fix these before ending the turn. If any item
falls under THE BOSS RULE (pricing / DNS / Stripe / deploys / new deps / brand
copy / external APIs / major arch / money-user-comms), escalate to Craig instead
of auto-fixing.
EOF
exit 2
