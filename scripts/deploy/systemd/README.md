# Production timers — the queue drain, and the estate probe

`CLAUDE.md` quality bar #12 requires a scheduler hitting
`/api/scan/worker/tick` (~2 min) and `/api/watches/tick` (~5 min). Until
2026-08-05 **nothing did**, on any host.

The intended driver was the `cron-ticks` GitHub Actions workflow, but it needs a
`CRON_SECRET` **repo secret** that was never set, so it has been disarmed —
while the box itself has had `CRON_SECRET` in `website/.env.local` the whole
time. Meanwhile `/api/scan/worker/tick` was answering
`{"ok":false,"error":"column q.host does not exist"}` under HTTP 200, so even a
working scheduler would have drained nothing (fixed in `d3fe3738`).

Net effect: no queued scan had ever executed. The Marketplace listing's central
promise — *"scans run on every push"* — was false in production.

Keeping the drain on the box also respects Forbidden #3: a critical user flow
should not hang off an external system. The Actions workflow can stay as a
second driver if its secret is ever set — both ticks are idempotent.

## The estate probe (`gatetest-empire-smoke`)

Added 2026-08-29 for the same reason, with the same evidence.

`.github/workflows/empire-smoke.yml` declares `*/5`, but **GitHub schedules are
best-effort and are throttled hard on public repos**. Measured in this repo on
2026-08-29: `readiness-probe.yml` is configured `*/30`, and its actual scheduled
runs landed at 01:29, 08:16, 13:57, 17:38 and 20:32 UTC — gaps of **three to
seven hours** against a thirty-minute cron. Declaring `*/5` does not buy
five-minute checks.

So the two drivers are split by what each is actually good at:

| Driver | Gives you | Does not give you |
|---|---|---|
| GitHub Actions workflow | alerting on red (email + archived report artifact), runs from outside our network | a cadence you can rely on |
| This systemd timer | a real 5-minute cadence the machine honours | outbound alerting — a red unit is visible, not pushed |

Same Forbidden #3 argument as the queue drain: something we depend on should
not hang off an external system that can silently stop running it.

The probe needs **no secrets** — every check is a public GET, a DNS lookup or a
TLS handshake — so `gatetest-empire-smoke.service` deliberately carries no
`EnvironmentFile` line at all. An `EnvironmentFile=-` there would be the exact
"green that cannot turn red" pattern `src/modules/systemd.js` flags: the `-`
makes a missing file non-fatal, so the job keeps reporting success while
running without the config it was meant to have.

## Install (from the box, as root)

```bash
cd /opt/gatetest
install -m 755 scripts/deploy/tick.sh /opt/gatetest/scripts/deploy/tick.sh
install -m 755 scripts/deploy/empire-smoke.sh /opt/gatetest/scripts/deploy/empire-smoke.sh
cp scripts/deploy/systemd/*.service scripts/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gatetest-tick.timer gatetest-watches.timer gatetest-empire-smoke.timer
```

## Verify

```bash
systemctl list-timers | grep gatetest
journalctl -u gatetest-tick.service -n 20 --no-pager
journalctl -u gatetest-empire-smoke.service -n 20 --no-pager
```

A healthy estate probe logs a markdown table ending `Empire Smoke: GREEN`.
`YELLOW` (up-but-slow, or a cert inside its 14-day window) still exits 0 by
design — failing every run for the 13 days a cert sits in its window would
train everyone to mute the unit. `RED` exits 1 and marks the unit failed, so
`systemctl list-units --failed` is the signal.

A healthy tick logs `tick /api/scan/worker/tick -> HTTP 200 {"ok":true,...}`.

`tick.sh` deliberately **fails** when the endpoint returns `"ok":false` even
though the HTTP status is 200 — that combination is exactly how the broken
`q.host` column stayed invisible for weeks. A red unit in
`systemctl list-timers` is the point.
