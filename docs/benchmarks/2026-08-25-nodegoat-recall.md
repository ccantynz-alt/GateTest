# NodeGoat recall — the six missed classes, closed

**Date:** 2026-08-25. **Method:** fresh `--depth 1` clone of OWASP/NodeGoat,
full-suite engine run before and after; expressjs/express as the clean
control (the 2026-08-18 audit's 0-blocking baseline repo). Controls in
`tests/recall-nodegoat-classes.test.js` (17 tests, positive + negative per
rule).

The 2026-08-18 audit measured ~6/13 planted classes detected and named six
misses (advancement #6): NoSQLi, template XSS, cookie flags, IDOR, CSRF,
helmet. All six now fire on the live clone, at the planted locations:

| Class | Finding | Location | Severity |
|---|---|---|---|
| NoSQL injection | `security:NoSQL injection ($where with interpolated input)` | `app/data/allocations-dao.js:73`, `:78` | error (critical) |
| Template XSS | `security:template auto-escaping disabled (XSS)` | `server.js:137` (`swig.setDefaults({ autoescape: false })`) | error (critical) |
| Cookie flags | `cookie-sec:js-session-secure-absent` | `server.js:78` (the planted `// secure: true`) | warning |
| IDOR | `auth-bypass:idor-shadow` | `app/routes/allocations.js:18` (params `userId` shadows session `userId`) | error |
| CSRF | `security:no-csrf-protection` | project posture (csrf mount is inside a `/* */` block) | warning |
| Helmet | `security:no-helmet` | project posture (`require("helmet")` commented out) | warning |

## What made these detectable

- **Comment-stripped posture signals.** NodeGoat's helmet and csurf wiring
  sits inside block comments — the plant is exactly "protection that looks
  present to a grep." Posture signals are read from comment-stripped
  content, and a commented-out flag counts as an absent flag.
- **The ABSENT flag, not just the false one.** The cookie rules only fired
  on explicit `secure: false`; the planted form is `// secure: true`
  omitted. The new rule brace-matches the `session({ … })` config and flags
  a cookie block that never sets `secure`.
- **Identity shadowing, not "params used in a query".** Generic
  params-into-query heuristics drown in false positives. The precise IDOR
  shape is the same identifier read from `req.session` and then re-read
  from `req.params/query/body` — the authenticated identity replaced by a
  client-controlled one. That's NodeGoat's exact plant and it's rarely
  legitimate (suppressor: `// idor-ok`).
- **Dynamic `$where` only.** A static `$where: "this.stocks > 5"` string is
  not flagged; interpolation or concatenation into `$where` is.

## Severity honesty

Posture findings (helmet, CSRF) and the absent-secure-flag are WARNINGS —
an app behind a header-setting proxy or on token auth is a legitimate
reason for absence, and blocking on posture would violate Forbidden #25.
The injectable classes (NoSQLi, template XSS, IDOR shadowing) are errors.

## False-positive control (same run)

expressjs/express: zero findings at warning severity or above from all six
new rules. Signals from `examples/`, `test/`, and demo directories are
excluded from posture; example-app cookie findings are info-severity. The
express repo's four `examples/*/index.js` session configs are the pinned
negative case.

## Still open on the benchmark front

- The remaining un-detected planted classes from the audit's ~13 (beyond
  the six named misses) were not re-enumerated in this pass — next
  measurement should list every planted class with hit/miss explicitly.
- "Published benchmarks with misses" (the public site page) is still
  queued; this doc is the internal measurement record it will draw from.
