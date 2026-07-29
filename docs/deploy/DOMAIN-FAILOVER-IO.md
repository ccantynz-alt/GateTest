# Bringing GateTest back online on gatetest.io

**Status:** ready to execute — every step below is verified, none has been run.
**Blocked on:** Craig. Boss Rule #4 (domain/DNS), #5 (production deploy).
**Written:** 2026-07-30, during the KI #93 outage.

---

## The situation in one paragraph

`gatetest.ai` entered **redemption period** at the registry on 2026-07-29 08:14 UTC
and now returns NXDOMAIN everywhere — the site is unreachable by name. **Nothing
is wrong with the server.** The box still serves a correct HTTP 200 when DNS is
bypassed, running the current commit. Meanwhile `gatetest.io` is already
registered to the same Cloudflare account, is healthy, expires 2027-04-08, and
currently points at the **retired Vercel deployment** (it serves
`DEPLOYMENT_NOT_FOUND`).

So the fastest route back online is not the redemption — it is pointing the
domain we still control at the server that is already working.

### Verified facts

| Check | Result |
|---|---|
| `dig gatetest.ai` | NXDOMAIN (registry delegation pulled) |
| RDAP `gatetest.ai` | `["client transfer prohibited","redemption period"]`, changed 2026-07-29T08:14:34Z |
| `curl --resolve gatetest.ai:443:66.42.121.161` | **HTTP 200**, correct `<title>`, `/api/platform-status` healthy on commit `56ce9f1` |
| `dig gatetest.io` | resolves to `216.150.16.65` — Vercel, serving `DEPLOYMENT_NOT_FOUND` |
| RDAP `gatetest.io` | registrar **Cloudflare, Inc**, registered 2026-04-08, expires 2027-04-08, status healthy |
| `gatetest.io` nameservers | `aitana.ns.cloudflare.com`, `major.ns.cloudflare.com` — Cloudflare-managed, so an A-record edit is all that's needed |

The two domains share a registrar and were registered four days apart, which is
why `.io` is assumed to be Craig's. **Confirm that before step 1** — if the
registrant is someone else, stop and redeem `.ai` instead.

---

## Step 1 — DNS (Cloudflare dashboard)

In the `gatetest.io` zone, replace the Vercel records:

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | `66.42.121.161` | DNS only (grey cloud) |
| A | `www` | `66.42.121.161` | DNS only |
| A | `mcp` | `66.42.121.161` | DNS only |

**Grey cloud, not orange.** Traefik on the box terminates TLS via Let's Encrypt;
Cloudflare's proxy in front of it will fail the HTTP-01 challenge and you will get
a cert error instead of a working site.

Delete or overwrite whatever currently points at Vercel — leaving it means
requests race between two answers.

## Step 2 — Traefik routing (on the box)

The routers live in Coolify's Traefik dynamic config. **Add** `.io` alongside
`.ai` — do not replace it, so the site works the instant redemption resolves.

```bash
ssh root@jarvis
docker exec coolify-proxy sh -c "sed -i \
  's/Host(\`gatetest.ai\`) || Host(\`www.gatetest.ai\`)/Host(\`gatetest.ai\`) || Host(\`www.gatetest.ai\`) || Host(\`gatetest.io\`) || Host(\`www.gatetest.io\`)/g' \
  /traefik/dynamic/gatetest-web.yaml"

docker exec coolify-proxy sh -c "sed -i \
  's/Host(\`mcp.gatetest.ai\`)/Host(\`mcp.gatetest.ai\`) || Host(\`mcp.gatetest.io\`)/g' \
  /traefik/dynamic/gatetest-mcp.yaml"
```

Traefik watches this directory and reloads automatically — no restart. Let's
Encrypt provisions the new certs on first request, which takes a few seconds.

Verify before moving on:

```bash
docker exec coolify-proxy sh -c "grep rule: /traefik/dynamic/gatetest-*.yaml"
```

## Step 3 — Application base URL

As of commit `cddd02d` the domain is **one environment variable**. Every
canonical, Open Graph URL, sitemap entry, IndexNow submission, Stripe return URL
and OAuth redirect derives from it.

```bash
ssh root@jarvis
cd /opt/gatetest
cp website/.env.local website/.env.local.bak-$(date +%Y%m%d-%H%M%S)

# set (or add) both names
grep -q '^NEXT_PUBLIC_BASE_URL=' website/.env.local \
  && sed -i 's|^NEXT_PUBLIC_BASE_URL=.*|NEXT_PUBLIC_BASE_URL=https://gatetest.io|' website/.env.local \
  || echo 'NEXT_PUBLIC_BASE_URL=https://gatetest.io' >> website/.env.local

grep -q '^GATETEST_PUBLIC_BASE_URL=' website/.env.local \
  && sed -i 's|^GATETEST_PUBLIC_BASE_URL=.*|GATETEST_PUBLIC_BASE_URL=https://gatetest.io|' website/.env.local \
  || echo 'GATETEST_PUBLIC_BASE_URL=https://gatetest.io' >> website/.env.local
```

`NEXT_PUBLIC_BASE_URL` is inlined into the client bundle **at build time**, so a
rebuild is required — restarting the service is not enough:

```bash
cd /opt/gatetest/website && npm run build && systemctl restart gatetest-web
```

### Keep badges on the old origin (deliberate)

Do **not** set `GATETEST_BADGE_ORIGIN`. Badge markdown already pasted into
customers' READMEs points at `gatetest.ai` and we cannot edit those repos. Newly
generated snippets should keep matching the old ones until `.ai` is redeemed and
301'ing; flipping badges now splits customers across two origins, one of which
is dead.

## Step 4 — Verify (do not skip)

```bash
curl -sI https://gatetest.io | head -1                      # expect 200
curl -s https://gatetest.io/api/platform-status | head -c 200   # healthy + current commit
curl -s https://gatetest.io | grep -o '<link rel="canonical"[^>]*>'  # must say gatetest.io
curl -sI https://www.gatetest.io | head -1
curl -sI http://gatetest.io | head -1                       # expect 301 → https
node scripts/ops/readiness-probe.js                         # full journey
```

The canonical check is the one that matters. If it still says `gatetest.ai`, the
rebuild did not pick up the env var — `NEXT_PUBLIC_BASE_URL` is build-time.

---

## Still do the redemption

This gets the product reachable; it does not make the `.ai` problem go away.

1. **Redeem `gatetest.ai` anyway.** Redemption windows are ~30 days from
   2026-07-29; after that it goes to pendingDelete and becomes publicly
   registrable.
2. **The reason it matters even after moving:** every badge in every customer
   README points at `gatetest.ai`. If someone else registers it, they control an
   image URL that renders inside our customers' repos — and the GitHub
   Marketplace listing, the MCP key-delivery emails, and every inbound link
   still name it. Losing it is worse than an outage.
3. **Fix the cause.** A domain dropping to redemption two years before its
   nominal expiry points at a failed payment or chargeback on the Cloudflare
   account, not a lapse. Check the billing on that account or this recurs.
4. Once redeemed, keep `.ai` 301'ing to `.io` permanently rather than retiring it.

## Rollback

Every step is additive and reversible.

- **DNS:** repoint the `gatetest.io` A records at Vercel.
- **Traefik:** the `.ai` rules were never removed — reverse the `sed` to drop the
  `.io` clauses.
- **App:** restore `website/.env.local` from the timestamped backup, rebuild,
  restart.
