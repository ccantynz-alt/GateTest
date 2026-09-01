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

module.exports = { isIllustrationPath, ILLUSTRATION_DIR_RE };
