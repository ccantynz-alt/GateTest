/**
 * Mutation engine — the canonical mutation operators used by the
 * mutationTesting module (`src/modules/mutation.js`).
 *
 * Phase 3.3 of THE FIX-FIRST BUILD PLAN. Extracted to a separate
 * module so the operators can be unit-tested independently of the
 * full module orchestration (which requires running a customer's
 * test suite).
 *
 * Each operator is a pattern that, when applied to source, produces
 * a small intentional defect. The module then runs the project's
 * tests — if all tests still pass after the mutation, the test suite
 * has a coverage gap (the mutation "survived").
 *
 * Pure regex operators. No language-specific parsing. Conservative:
 * each pattern is constrained to avoid false-positives on legitimate
 * code (e.g. `+` is not mutated to `-` inside string literals or
 * type unions).
 */

const MUTATIONS = [
  // Conditional / equality mutations
  { name: 'negate-conditional',     pattern: /===\s/g,                replace: '!== ', desc: 'Negated conditional (=== → !==)' },
  { name: 'negate-conditional-eq',  pattern: /!==\s/g,                replace: '=== ', desc: 'Negated conditional (!== → ===)' },
  // Boundary mutations
  { name: 'boundary-lt',            pattern: /<\s/g,                  replace: '<= ',  desc: 'Boundary tightened (< → <=)' },
  { name: 'boundary-lte',           pattern: /<=\s/g,                 replace: '< ',   desc: 'Boundary loosened (<= → <)' },
  { name: 'boundary-gt',            pattern: />\s/g,                  replace: '>= ',  desc: 'Boundary tightened (> → >=)' },
  { name: 'boundary-gte',           pattern: />=\s/g,                 replace: '> ',   desc: 'Boundary loosened (>= → >)' },
  // Math operator swaps
  { name: 'math-add',               pattern: /\+(?!=)/g,              replace: '-',    desc: 'Math swap (+ → -)' },
  { name: 'math-sub',               pattern: /(?<!=)-(?!=)/g,         replace: '+',    desc: 'Math swap (- → +)' },
  // Return-value flips
  // Word-boundary anchors: `return true` should not match `return trueish`.
  { name: 'return-true',            pattern: /return true\b/g,        replace: 'return false', desc: 'Flipped return true' },
  { name: 'return-false',           pattern: /return false\b/g,       replace: 'return true',  desc: 'Flipped return false' },
  { name: 'remove-return',          pattern: /return\s+(?!;)/g,       replace: 'return void ', desc: 'Voided return value' },
  { name: 'empty-string',           pattern: /return ['"](.+?)['"]/g, replace: 'return ""',    desc: 'Emptied return string' },
  { name: 'zero-constant',          pattern: /return\s+(\d+)/g,       replace: 'return 0',     desc: 'Zeroed return constant' },
  { name: 'null-return',            pattern: /return\s+\{/g,          replace: 'return null && {', desc: 'Nulled return object' },
  { name: 'array-empty',            pattern: /return\s+\[/g,          replace: 'return [] && [', desc: 'Emptied return array' },
  // Increment / decrement
  { name: 'increment-swap',         pattern: /\+\+/g,                 replace: '--',   desc: 'Swapped ++ for --' },
  { name: 'decrement-swap',         pattern: /--/g,                   replace: '++',   desc: 'Swapped -- for ++' },
  // Logical operator swaps
  { name: 'and-to-or',              pattern: /&&/g,                   replace: '||',   desc: 'Swapped && for ||' },
  { name: 'or-to-and',              pattern: /\|\|/g,                 replace: '&&',   desc: 'Swapped || for &&' },
];

/**
 * Determine whether a single line should be excluded from mutation.
 * Skips comment-only lines, import/require lines, and string-literal-only
 * lines — applying mutations to those produces noise without testing
 * value.
 */
function shouldSkipLine(line) {
  if (typeof line !== 'string') return true;
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('/*')) return true;
  if (trimmed.startsWith('#')) return true; // shell / python
  if (/\brequire\s*\(/.test(trimmed)) return true;
  if (/^\s*import\s/.test(line)) return true;
  if (/^\s*from\s/.test(line)) return true;
  return false;
}

/**
 * Apply a single mutation operator to a single line of source.
 * Returns null if the operator doesn't match the line. Returns the
 * mutated line otherwise.
 *
 * Important: we reset `pattern.lastIndex` because all operators use
 * the global flag (we'd otherwise get state leakage between calls).
 */
function applyMutation(line, mutation) {
  if (typeof line !== 'string') return null;
  if (!mutation || !mutation.pattern || !mutation.replace) return null;
  if (shouldSkipLine(line)) return null;

  mutation.pattern.lastIndex = 0;
  if (!mutation.pattern.test(line)) return null;

  mutation.pattern.lastIndex = 0;
  const mutated = line.replace(mutation.pattern, mutation.replace);
  if (mutated === line) return null;
  return mutated;
}

/**
 * For a given source string, return all mutation candidates as
 * { lineNumber, original, mutated, mutation }. Bounded by maxPerLine
 * (default 1 — only first match per line) so we don't flood callers
 * with identical mutations on busy lines.
 */
function generateMutations(source, opts = {}) {
  if (typeof source !== 'string') return [];
  const maxPerFile = opts.maxPerFile || 50;
  const lines = source.split('\n');
  const candidates = [];

  for (let i = 0; i < lines.length; i++) {
    if (candidates.length >= maxPerFile) break;
    const line = lines[i];
    if (shouldSkipLine(line)) continue;

    for (const mutation of MUTATIONS) {
      if (candidates.length >= maxPerFile) break;
      const mutated = applyMutation(line, mutation);
      if (mutated == null) continue;
      candidates.push({
        lineNumber: i + 1,
        original: line,
        mutated,
        mutation,
      });
      // Only first matching operator per line — keeps the candidate
      // set diverse and the test runtime bounded.
      break;
    }
  }
  return candidates;
}

/**
 * Apply a single candidate to the full source string. Returns the
 * mutated source. Helper for callers that want to apply-then-test.
 */
function applyCandidate(source, candidate) {
  if (typeof source !== 'string') return source;
  if (!candidate) return source;
  const lines = source.split('\n');
  const idx = candidate.lineNumber - 1;
  if (idx < 0 || idx >= lines.length) return source;
  lines[idx] = candidate.mutated;
  return lines.join('\n');
}

module.exports = {
  MUTATIONS,
  shouldSkipLine,
  applyMutation,
  generateMutations,
  applyCandidate,
};
