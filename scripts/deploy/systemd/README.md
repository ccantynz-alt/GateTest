# Production timers — the queue drain

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

## Install (from the box, as root)

```bash
cd /opt/gatetest
install -m 755 scripts/deploy/tick.sh /opt/gatetest/scripts/deploy/tick.sh
cp scripts/deploy/systemd/*.service scripts/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gatetest-tick.timer gatetest-watches.timer
```

## Verify

```bash
systemctl list-timers | grep gatetest
journalctl -u gatetest-tick.service -n 20 --no-pager
```

A healthy tick logs `tick /api/scan/worker/tick -> HTTP 200 {"ok":true,...}`.

`tick.sh` deliberately **fails** when the endpoint returns `"ok":false` even
though the HTTP status is 200 — that combination is exactly how the broken
`q.host` column stayed invisible for weeks. A red unit in
`systemctl list-timers` is the point.
