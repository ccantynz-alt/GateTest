#!/usr/bin/env bash
# empire-smoke.sh — run the cross-product smoke probe from the production box.
#
# ── Why this runs on the box and not only in GitHub Actions ─────────────────
# `.github/workflows/empire-smoke.yml` declares `*/5`, but GitHub schedules are
# best-effort and are throttled hard on public repos. Measured in THIS repo on
# 2026-08-29: `readiness-probe.yml` is configured `*/30` and its actual
# scheduled runs landed at 01:29, 08:16, 13:57, 17:38, 20:32 UTC — gaps of
# three to seven HOURS against a thirty-minute cron. A `*/5` declaration does
# not buy five-minute checks; it buys whatever GitHub feels like giving.
#
# So the Actions workflow is kept for what it is genuinely good at — alerting
# (a red run emails, and the report is archived as an artifact) — and the real
# cadence lives here, on a timer the machine actually honours. That is the same
# conclusion `systemd/README.md` reached for the queue drain, and the same
# Forbidden #3 argument: a thing we depend on should not hang off an external
# system that can silently stop running it.
#
# Needs no secrets: every probe is a GET, a DNS lookup or a TLS handshake
# against a public endpoint.
set -euo pipefail

APP_DIR="${GATETEST_APP_DIR:-/opt/gatetest}"
PROBE="$APP_DIR/integrations/smoke/empire-smoke.js"

if [ ! -r "$PROBE" ]; then
  echo "empire-smoke: cannot read $PROBE" >&2
  exit 1
fi

# Resolve node explicitly. systemd hands units a minimal PATH, so a node
# installed under nvm/fnm is invisible unless we go looking for it.
NODE_BIN="${GATETEST_NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  for candidate in /usr/bin/node /usr/local/bin/node /opt/node/bin/node; do
    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "empire-smoke: no node binary found (set GATETEST_NODE_BIN)" >&2
  exit 1
fi

# The probe prints a markdown table to stdout and exits:
#   0  green, or yellow (up-but-slow / cert inside its warning window)
#   1  red (a probe failed)
# journald captures the table either way, so `journalctl -u
# gatetest-empire-smoke` shows exactly which leg of the estate was down and
# when. A non-zero exit marks the unit failed, which is the point — a red unit
# in `systemctl list-units --failed` is the signal.
exec "$NODE_BIN" "$PROBE"
