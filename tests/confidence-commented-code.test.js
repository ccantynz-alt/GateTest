// =============================================================================
// CONFIDENCE — commented-out code is reported softly, live code blocks
// =============================================================================
// An open question for several sessions, raised because the SAME rule scored
// two findings differently in one file, five lines apart:
//
//   OWASP/NodeGoat @c5cb68a, app/data/allocations-dao.js
//     :73  security:NoSQL injection ($where with interpolated input)  0.20
//     :78  security:NoSQL injection ($where with interpolated input)  full
//
// gluecron-com-78's hypothesis was that confidence measures PATTERN FIT while
// being read as LIKELIHOOD OF BEING REAL — two different quantities sharing a
// scale, the same family as a `total` that counts the page. I shared the
// suspicion and flagged it rather than presenting 62 findings as 62 clean
// true positives.
//
// Measured, and we were both wrong. Reading the file settles it:
//
//     63:  /*
//     64:  // Fix for A1 - 2 NoSQL Injection - escape the threshold parameter
//     ...
//     73:      return {$where: `… ${parsedThreshold}`};      <- inside the comment
//     76:  */
//     78:      $where: `… '${threshold}'`                    <- live code
//
// Line 73 is NodeGoat's commented-out FIX. Line 78 is the live vulnerability.
// The 0.20 is `isInsideBlockComment` firing, so confidence is measuring
// exactly what it claims to: whether the code can run. The scorer is right.
//
// Recorded as a test rather than a note because the behaviour is subtle, was
// arrived at by measurement, and would regress silently — the whole finding
// would still "look fine" if commented code started blocking, or if live code
// started being discounted.
//
// The architecture producing it is worth naming: the security module skips
// lines that OPEN with a comment marker (cheap, per-line), and the confidence
// scorer does a real multi-line block scan (accurate, expensive). Line 73
// starts with `return {`, so only the second catches it.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { scoreFinding, BLOCK_THRESHOLD } = require('../src/core/confidence');

// NodeGoat's shape, reduced to essentials: a commented-out $where and a live
// one in the same function.
const SOURCE = [
  'function getByThreshold(userId, threshold) {',
  '    if (threshold) {',
  '        /*',
  '        // Fix for NoSQL Injection - escape the threshold parameter',
  '        const parsedThreshold = parseInt(threshold, 10);',
  '        if (parsedThreshold >= 0 && parsedThreshold <= 99) {',
  '            return {$where: `this.userId == ${userId} && this.stocks > ${parsedThreshold}`};',
  '        }',
  '        */',
  '        return {',
  '            $where: `this.userId == ${userId} && this.stocks > ${threshold}`',
  '        };',
  '    }',
  '}',
].join('\n');

const COMMENTED_LINE = 7;  // the $where inside the block comment
const LIVE_LINE = 11;      // the $where that executes

/**
 * Score a finding the way the runner does — the module supplies file, line and
 * the file's source text, and the scorer decides.
 *
 * An earlier version of this test drove the security module through a bare
 * result object instead. That harness never supplies sourceText, so the
 * block-comment signal could not fire and BOTH lines scored 1.0 — a limitation
 * of the test, read as a defect in the engine. The real CLI scan reports 0.20
 * on the commented line. Measuring the harness instead of the thing is the
 * mistake this file exists to document as much as the behaviour is.
 */
function confidenceAt(line) {
  return scoreFinding({
    module: 'security',
    ruleKey: 'security:NoSQL injection ($where with interpolated input)',
    filePath: 'app/data/allocations-dao.js',
    line,
    sourceText: SOURCE,
  }).confidence;
}

describe('confidence — commented-out vulnerable code', () => {
  it('scores the live $where at blocking confidence', () => {
    const conf = confidenceAt(LIVE_LINE);
    assert.ok(
      conf >= BLOCK_THRESHOLD,
      `live vulnerable code must block; got ${conf}`,
    );
  });

  it('scores the commented-out $where below the blocking threshold', () => {
    const conf = confidenceAt(COMMENTED_LINE);
    assert.ok(
      conf < BLOCK_THRESHOLD,
      `code inside a block comment cannot execute and must not block; got ${conf}`,
    );
  });

  it('live code scores strictly above commented code', () => {
    // The failure mode that would make the behaviour useless: a block-comment
    // signal leaking past the `*/` and softening real code.
    assert.ok(
      confidenceAt(LIVE_LINE) > confidenceAt(COMMENTED_LINE),
      'the block-comment signal is not discriminating between the two',
    );
  });

  it('a finding with no source text is not silently discounted', () => {
    // Modules that cannot supply source must not have their findings quietly
    // softened — that is the false-negative direction.
    const conf = scoreFinding({
      module: 'security',
      ruleKey: 'security:NoSQL injection',
      filePath: 'app/data/allocations-dao.js',
      line: LIVE_LINE,
    }).confidence;
    assert.ok(conf >= BLOCK_THRESHOLD, `path-only score must not block-discount; got ${conf}`);
  });
});
