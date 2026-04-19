# GateTest Infra Scanner

**Read-only live-server state validator.** Given a declarative spec, the
scanner SSHes to the target host and verifies every invariant that matters:
services up, ports listening, files own-by-the-right-user, certs not about to
expire, endpoints returning 200, disk not full, and — critically — **no
silent crash loops** in systemd.

Today's "Caddy log-dir permission" bug and the crash-looping services it
produced would have been caught by this scanner on its first run.

---

## What it checks

| Section       | Check                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| `services`    | Every listed systemd unit is `active (running)` — not `failed`, not `activating`         |
| `ports`       | Every listed TCP port is bound via `ss -tln`                                             |
| `paths`       | Every file/dir exists with the expected owner, group, and octal mode                     |
| `certs`       | Every listed domain's TLS cert has at least `min_days` until expiry (default 14)         |
| `endpoints`   | Every URL returns `expect_status` — probed from BOTH the target box AND the scanner     |
| `disk`        | Free space on the given mount is above the threshold (default 20%)                      |
| `crash_loop`  | Each service's `journalctl` restart count in the last hour is below threshold           |

The crash-loop check is the one most tools miss: `systemctl is-active` still
reports `active` in the split-second between restarts on a `Restart=always`
loop, so naive health probes give you a green light while the service is
actually dying 20 times a minute. The scanner counts `Started` events in
journalctl for the last hour, which catches this exact pattern.

---

## Generating the scanner SSH key

Use a **dedicated non-root, non-deploy key** so the scanner has only what it
needs — read systemd state, stat files, run `curl` against localhost. If the
key leaks, it cannot modify anything.

On your control host (laptop, CI runner, or bastion):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gatetest_scanner -C "gatetest-scanner@$(hostname)" -N ""
chmod 600 ~/.ssh/gatetest_scanner
```

On the **target server**, create a low-privilege user and install the key:

```bash
# as root on target
useradd -m -s /bin/bash -c 'GateTest infra scanner' gatetest
mkdir -p /home/gatetest/.ssh
chmod 700 /home/gatetest/.ssh

cat >> /home/gatetest/.ssh/authorized_keys <<'EOF'
ssh-ed25519 AAAA...  gatetest-scanner@<your-control-host>
EOF

chmod 600 /home/gatetest/.ssh/authorized_keys
chown -R gatetest:gatetest /home/gatetest/.ssh
```

Optionally lock the key down further by prefixing it in `authorized_keys`
with:

```
command="/usr/local/sbin/gatetest-scanner-shim",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
```

…if you want to restrict it to a specific wrapper script. Not required — the
scanner only runs `systemctl is-active`, `ss -tln`, `stat`, `df`, `curl`, and
`journalctl`, all of which are safe for an unprivileged read-only user.

Then add the target's host key to the control host's `known_hosts` (or let
the scanner's `StrictHostKeyChecking=accept-new` pick it up on first run):

```bash
ssh-keyscan -H 45.76.171.37 >> ~/.ssh/known_hosts
```

Test it:

```bash
ssh -i ~/.ssh/gatetest_scanner gatetest@45.76.171.37 'systemctl is-active caddy'
```

---

## Running the scanner

```bash
node integrations/infra/scanner.js integrations/infra/example-crontech.spec.yaml
```

The output is JSON — pipe it to `jq` for humans:

```bash
node integrations/infra/scanner.js spec.yaml | jq '.sections'
```

Exit code:

- `0` — every check passed
- `1` — at least one check failed (report on stdout)
- `2` — missing spec file or malformed arguments

The scanner prints nothing to stdout except the JSON report. Progress + any
logging goes to stderr, with automatic redaction of auth-shaped strings
(PEM blocks, GitHub PATs, Stripe keys, Bearer tokens, etc.).

---

## Spec format

See [`spec.schema.json`](./spec.schema.json) for the full JSON Schema.
See [`example-crontech.spec.yaml`](./example-crontech.spec.yaml) for a
working example targeting Crontech's Vultr box.

Both YAML and JSON are accepted — the loader detects by file extension.

---

## Integrating with the GateTest scan pipeline

The infra scanner is a standalone executable today. It exports a class:

```js
const { InfraScanner, loadSpec } = require('./integrations/infra/scanner.js');
const spec = loadSpec('integrations/infra/example-crontech.spec.yaml');
const report = await new InfraScanner().scan(spec);
// report.summary.passed === true/false
// report.sections.services[...] / .ports / .paths / .certs / .endpoints / .disk / .crash_loop
```

To wire it into the main GateTest runner as a module, register a thin module
adapter under `src/modules/infra-state.js` that calls `InfraScanner.scan()`
and converts each failing check into a `result.issue(...)` call at
`severity: error`. That adapter is left out of this first cut intentionally
— the Bible requires module additions to ship with registry updates, suite
bindings, a line in CLAUDE.md's "KEY FILES" section, and version-string
updates, which is out of scope for this PR.

---

## Testing hook

The `InfraScanner` constructor accepts injected executors so every check can
be unit-tested without a live host:

```js
new InfraScanner({
  sshExecutor: () => async (cmd) => ({ stdout: 'active\n', stderr: '', code: 0 }),
  httpProbe:   async () => ({ ok: true, status: 200 }),
  tlsProbe:    async () => ({ ok: true, days: 60 }),
});
```

See `tests/infra-scanner.test.js` for the full fixture set.

---

## Forbidden

- **Never modify the target.** The scanner only reads. Do not add an "auto-fix"
  flag. If the target drifts, the scanner reports it and a human (or a
  separate, authorized remediation pipeline) acts.
- **Never commit a private key.** The scanner path is a string in the spec;
  the key itself lives outside the repo.
- **Never log raw command output without running it through `redact()`.** The
  scanner's logger does this automatically; any new log call must too.
