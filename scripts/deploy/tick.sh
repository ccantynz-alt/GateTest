#!/usr/bin/env bash
# tick.sh — drive one of GateTest's periodic endpoints from the production box.
#
# Usage: tick.sh /api/scan/worker/tick
#
# ── Why this exists ─────────────────────────────────────────────────────────
# CLAUDE.md quality bar #12 requires a scheduler hitting /api/scan/worker/tick
# (~2 min) and /api/watches/tick (~5 min). Nothing did. The intended driver was
# the cron-ticks GitHub Actions workflow, but that needs a CRON_SECRET *repo
# secret* which is unset, so it has been disarmed — while the box itself has
# had CRON_SECRET in website/.env.local all along.
#
# Depending on GitHub Actions to drive a box that can drive itself also breaks
# Forbidden #3 in spirit: a critical user flow (a queued scan ever running)
# should not hang off an external system. This keeps the queue draining from
# the machine that owns it; the Actions workflow can stay as a belt-and-braces
# second driver, since both ticks are idempotent.
set -euo pipefail

ENDPOINT="${1:?usage: tick.sh <endpoint-path>}"
APP_DIR="${GATETEST_APP_DIR:-/opt/gatetest}"
ENV_FILE="$APP_DIR/website/.env.local"
# The service binds 10.0.1.1:3000 (see gatetest-web.service). Hit it directly
# rather than looping out through the public hostname and back in.
BASE="${GATETEST_TICK_BASE:-http://10.0.1.1:3000}"

if [ ! -r "$ENV_FILE" ]; then
  echo "tick: cannot read $ENV_FILE" >&2
  exit 1
fi

# Read the secret without sourcing the file — .env.local holds every production
# credential, and sourcing it would export all of them into this process.
SECRET="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -n1 | tr -d '"'"'"'' | tr -d '\r')"
if [ -z "$SECRET" ]; then
  echo "tick: CRON_SECRET not set in $ENV_FILE" >&2
  exit 1
fi

# --fail-with-body would be nicer but is curl 7.76+; keep it portable.
CODE="$(curl -s -o /tmp/gatetest-tick-body -w '%{http_code}' -m 120 \
  -X POST -H "Authorization: Bearer $SECRET" "$BASE$ENDPOINT")"
BODY="$(head -c 500 /tmp/gatetest-tick-body || true)"

echo "tick $ENDPOINT -> HTTP $CODE $BODY"

# These endpoints answer 200 with {"ok":false,"error":...} on internal failure —
# that is how `column q.host does not exist` went unnoticed for so long. Treat a
# false `ok` as a failure so `systemctl list-timers` / journal show it.
if [ "$CODE" != "200" ]; then
  exit 1
fi
case "$BODY" in
  *'"ok":false'*) echo "tick: endpoint reported ok:false" >&2; exit 1 ;;
esac
