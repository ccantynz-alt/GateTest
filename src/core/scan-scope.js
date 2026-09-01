/**
 * Is a file part of the SHIPPED APPLICATION, or is it an illustration?
 *
 * Every module was answering this for itself, and mostly answering it about
 * GateTest's own repo. Measured 2026-09-01 on third-party code:
 *
 *   axios @81df7a5   — 54 blocking findings, 30 of them (56%) inside
 *                      `examples/` and `sandbox/`: a11y, visual and
 *                      hardcoded-url all reporting on demo HTML.
 *   express @023767f — all 12 authBypass findings inside `examples/`, i.e.
 *                      100% of that module's output on that repo.
 *
 * axios and chalk are among the most-depended-on packages in the ecosystem.
 * A gate that blocks them has not found 54 defects; it has found one, and
 * reported it 54 times. A developer evaluating us draws the obvious
 * conclusion and leaves.
 *
 * The lesson already existed in two places and had not been generalised:
 *   - src/modules/security.js excludes examples/samples/demos for its posture
 *     checks, and its comment names expressjs/express explicitly.
 *   - src/modules/accessibility.js has an exclusion list — but it is
 *     `website/app/admin/`, `website/app/dashboard/`, `website/public/`.
 *     Those are OUR paths. On a customer's repo it excludes nothing, which is
 *     how a rule can look well-behaved on the repo it was written in and be
 *     unusable everywhere else.
 *
 * WHAT THIS IS NOT FOR. This is a scope question, never a severity question.
 * Do not use it to quiet a rule that fires too often on real application
 * code — that is a precision bug in the rule, fixed with a control pair.
 * In particular, Craig ruled 2026-09-01 that accessibility findings BLOCK:
 * "keep the a11y blocking, thats quality." Nothing here changes that. An
 * `<img>` with no alt in a customer's app still fails the gate; the same tag
 * in a library's `examples/` folder is documentation.
 *
 * And it is deliberately NOT applied to secrets, dependency or dangerous-
 * pattern scanning. A credential committed under `examples/` is a real
 * credential, and an `eval()` in a demo still executes.
 */

// Segment-anchored, always. The loose `path.includes('test')` style checks
// elsewhere in this codebase also match `src/latest/`, and repeating that
// would silence real application code in `src/exampleService/`.
const ILLUSTRATION_DIR_RE =
  /(^|\/)(examples?|samples?|demos?|fixtures?|__fixtures__|__mocks__|sandbox|playground|scratch)\//i;

/**
 * True when `relPath` sits inside a directory whose contents illustrate the
 * software rather than constitute it.
 *
 * @param {string} relPath - path relative to the project root; either slash
 *                           style is accepted.
 */
function isIllustrationPath(relPath) {
  if (!relPath) return false;
  return ILLUSTRATION_DIR_RE.test(String(relPath).replace(/\\/g, '/'));
}

// Test and benchmark HARNESS directories. Separate from illustrations because
// the two answer different questions: an illustration is not the application,
// a harness is not a PAGE A USER VISITS. Only the presentation modules
// (a11y, visual, seo) care about the second distinction — authBypass and
// hardcoded-url already handle test paths their own way, and secrets/security
// must keep scanning both.
const HARNESS_DIR_RE =
  /(^|\/)(tests?|spec|specs|__tests__|e2e|cypress|playwright|perf|bench|benchmarks?)\//i;

/**
 * True when `relPath` is a document nobody navigates to as a user: a demo, a
 * fixture, or a test/benchmark harness page.
 *
 * Measured 2026-09-01 on lodash @a666ba5 — 33 of its 47 blocking findings
 * (70%) were in `test/` and `perf/`. The offenders were `test/index.html`
 * (titled "lodash Test Suite", loading qunit.css) and `perf/index.html`
 * ("lodash Performance Suite") being audited for landmark regions, viewport
 * tags and meta descriptions. A QUnit runner having no `<main>` landmark is
 * not an accessibility defect; it is not a page.
 *
 * Again: SCOPE, NOT SEVERITY. Craig ruled 2026-09-01 that a11y findings
 * block — "keep the a11y blocking, thats quality" — and they still do, on
 * every page a user can actually reach.
 */
function isNonUserFacingPage(relPath) {
  if (!relPath) return false;
  const norm = String(relPath).replace(/\\/g, '/');
  return isIllustrationPath(norm) || HARNESS_DIR_RE.test(norm);
}

module.exports = {
  isIllustrationPath,
  isNonUserFacingPage,
  ILLUSTRATION_DIR_RE,
  HARNESS_DIR_RE,
};
