# Corpus precision / recall — nine repos, 2026-09-01

**Engine:** GateTest v1.61.0, `--suite full`, run as a customer runs it.
**Supersedes** the two-repo measurement earlier the same day, which was not
wrong but was not generalisable: express passes, so a corpus of express and
NodeGoat showed nothing.

## Results

Counts are the **engine's own** blocking / soft split, not a count of finding
lines. See "A correction to this file's own method" below.

| Repo | SHA | Gate | Modules | Blocking | Soft | Warnings |
|---|---|---|---|---|---|---|
| expressjs/express | `023767f` | **PASSED** | 89/89 | **0** | 13 | 121 |
| expressjs/multer | `a53296b` | **PASSED** | 89/89 | **0** | 0 | 49 |
| chalk/chalk | `661317e` | BLOCKED | 88/89 | 1 | 0 | 41 |
| fastify/fastify | `4cdb0c5` | BLOCKED | 85/89 | 5 | 3 | 272 |
| axios/axios | `81df7a5` | BLOCKED | 83/89 | 7 | 17 | 487 |
| lodash/lodash | `a666ba5` | BLOCKED | 82/89 | 21 | 5 | 226 |
| appsecco/dvna *(vulnerable)* | `9ba473a` | BLOCKED | 81/89 | 25 | 1 | 69 |
| OWASP/NodeGoat *(vulnerable)* | `c5cb68a` | BLOCKED | 76/89 | 60 | 2 | 200 |
| juice-shop *(vulnerable)* | `1618a61` | BLOCKED | 62/89 | 468 | 10 | 815 |

## Movement during the session

Every precision fix was checked against the vulnerable half. **Recall did not
move once**, which is the only reason the precision changes are trustworthy.

| | start | end |
|---|---|---|
| axios | 54 | **7** |
| lodash | 47 | **21** |
| express / multer | 0 | 0 |
| NodeGoat / dvna / juice-shop | 62 / 25 / 477 | 60 / 25 / 468 |

*(NodeGoat and juice-shop end lower only because the start figures were
line-counts, which included soft findings — see the correction below. No
recall was lost.)*

## What the fixes were

1. **Illustration directories scanned as production surface.** 30 of axios's
   54 were in `examples/` and `sandbox/`; 100% of authBypass's findings on
   express were in `examples/`. Now one predicate, `src/core/scan-scope.js`.
2. **Harness pages audited as user-facing pages.** 33 of lodash's 47 were in
   `test/` and `perf/` — `test/index.html` is a QUnit runner titled "lodash
   Test Suite". Presentation modules now use `isNonUserFacingPage`.
3. **JSONC config files reported as JSON syntax errors.** axios's
   `.devcontainer/devcontainer.json` blocked the gate on a trailing comma,
   which is legal in that format.
4. **Documentation not scanned for secrets at all.** A real `sk_live_…` in a
   README produced zero findings. Now in scope, with `<angle-bracket>`
   placeholders added to the allow-list so NodeGoat's documented
   `mongodb://<username>:<password>@…` does not become a false positive.

All four were **scope**, never severity. Craig ruled the same day that
accessibility findings block — "keep the a11y blocking, thats quality" — and
they still do, on every page a user can reach.

## A correction to this file's own method

Earlier runs of the harness counted lines beginning with `x` and called that
"blocking". The engine distinguishes blocking errors from soft, low-confidence
findings, and the line count includes both. That overstated:

- axios: reported 9, actually **7** blocking
- lodash: reported 26, actually **21** blocking
- NodeGoat: reported 62, actually **60** blocking

The harness now parses the engine's own `Errors:` line. Recording this because
a benchmark that measures itself loosely is the same defect class it exists to
find, and the numbers were quoted to two other teams before being corrected.

## Honest limits

- **89 modules ran, not 121.** The remainder need a CI runner or do not apply
  to a JS repo. Do not quote 121 as the number that ran.
- **Nine repos is not a rate.** It is enough to show precision and recall are
  not broken, and enough to have caught four defects that two repos hid.
- **Warnings were not individually audited.** 487 on axios and 121 on express
  do not block, but that volume erodes trust on its own and is unexamined.
- **The remaining blocking findings were left alone deliberately.** lodash's 21
  include real CVEs in its devDependencies and genuine empty catches in
  `lodash.js`. Driving a precision number to zero by widening exclusions is
  the failure mode this exercise exists to catch.
