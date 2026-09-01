# Precision / Recall — 2026-09-01

**Engine:** GateTest v1.61.0 at commit `4f6246bd`
**Question this answers (Craig, 2026-09-01):** *"we need robust — the dev
operators will see us coming if this product is problematic."*

A developer evaluating GateTest forms their opinion in the first five minutes,
on **their own repo**, not ours. Two numbers decide whether they keep using it:

1. Does it **block clean code**? If yes, they leave, and correctly.
2. Does it **catch real bugs**? If no, it is decoration.

Either number alone is worthless. A scanner that passes everything scores
perfectly on (1). This benchmark measures both, on the same suite, against
third-party code neither written nor tuned by us.

---

## Method

Both repos cloned fresh from upstream at the SHAs below and scanned with the
CLI exactly as a customer runs it. **`--suite full`** on both — that is what a
paying Full Scan ($99) executes; the CLI default is `standard` (46 modules)
and would have flattered the precision number by running fewer rules.

```
node bin/gatetest.js --suite full --all
```

---

## Precision — clean code must pass

**Target:** `expressjs/express` @ `023767f` — 141 JS files. Chosen because it is
widely used, actively maintained, and has no relationship to us.

| Metric | Result |
|---|---|
| Gate | **PASSED** |
| Modules | **89 / 89 passed** |
| Blocking findings | **0** |
| Soft (low-confidence, non-blocking) | 21 |
| Warnings | 133 (95 low confidence) |

**Zero blocking findings on a clean third-party repo.** This is the number that
decides whether a developer dismisses the product on first contact.

## Recall — planted vulnerabilities must be caught

**Target:** `OWASP/NodeGoat` @ `c5cb68a` — an intentionally vulnerable Express
app, maintained by OWASP as a teaching target. Same engine, same suite.

| Metric | Result |
|---|---|
| Gate | **BLOCKED** |
| Modules | 76 / 89 passed |
| Blocking findings | **62** |
| Warnings | 200 (23 low confidence) |

Classes caught, including NodeGoat's headline planted vulnerabilities:

| Finding | NodeGoat vulnerability |
|---|---|
| `security:NoSQL injection ($where with interpolated input)` | A1 — injection |
| `security:eval()` / `quality:eval() usage detected` (×3, `contributions.js:32-34`) | A1 — server-side JS injection |
| `taint:sink:eval` (×3, cross-file) | the same sinks, traced from source |
| `auth-bypass:idor-shadow` | A4 — insecure direct object reference |
| `ssrf:tainted-url` (`research.js:16`) | SSRF |
| `redos:nested-quantifier` (`profile.js:59`) | regex denial of service |
| `secrets:config/env/*.js`, `docker-compose.yml` | hardcoded credentials |
| `secret-rotation:stale:private-key` (`server.key`) | committed private key |
| `security:npm-audit` | known-vulnerable pinned dependencies |

The cross-file taint result is worth separating out: `taint:sink:eval` reached
the same three lines as the direct `eval()` match, having traced from an
untrusted source in a different file. That is the finding a grep cannot produce.

---

## Verified, not assumed

The a11y findings that block NodeGoat were spot-checked against the source
before being counted as true positives, on the principle that a benchmark
which counts its own false positives as recall is worse than no benchmark:

- `a11y:html-lang:error-template.html` — the file really opens `<html>` with no
  `lang` attribute.
- `a11y:img-alt` — `<img src="/images/owasplogo.png" height="80px">`, genuinely
  no `alt`.

Both real defects.

---

## Honest limits of this measurement

- **89 modules ran, not 121.** The remainder either do not apply to a JS repo or
  need a CI runner / headless browser (mutation testing, chaos/fuzz) — the same
  constraint the Bible already documents for the website-only Nuclear path. The
  "121 modules" figure is the catalogue; 89 is what a JS repo actually exercises.
  Do not quote 121 as the number that ran here.
- **Two repos is not a corpus.** This establishes that precision and recall are
  not broken; it does not establish a rate. Widening the corpus is the next step,
  and a second codebase from another team beats more passes over these two.
- **NodeGoat's blocking set includes a11y, dead links and docs findings**, not
  only security. They are true (verified above), but a team that installs a
  quality gate expecting security and gets their build blocked on a missing
  `alt` attribute may read that as noise. Whether the full suite *should* block
  on accessibility is a product decision for Craig, not a defect to fix
  silently — flagged, not changed.

  > **RULED, Craig 2026-09-01: "keep the a11y blocking, thats quality."**
  > Accessibility findings block by design. They are not noise to be tuned
  > away, and no future pass should downgrade their severity or exclude them
  > from a suite to bring a finding count down. If an a11y rule fires
  > *wrongly*, fix its precision with a control pair — a true finding that is
  > inconvenient is the product working as intended.
- Warnings were not individually audited. 133 non-blocking warnings on express
  is a large number; some fraction are likely false positives that do not block
  but do erode trust. That audit is separate work.

## What this does establish

Two defects shipped and were found the same day this benchmark was run — the
MCP result formatter crashing on **every** scan, and a second `innerHTML` rule
failing the gate on correctly-escaped code. Both were exactly the
first-five-minutes kind. Neither was caught by unit tests; both were caught by
running the engine against real code.

That is the argument for this file existing and being re-run, rather than for
trusting a green suite.
