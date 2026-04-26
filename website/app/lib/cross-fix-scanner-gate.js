/**
 * Cross-fix scanner re-validation gate.
 *
 * Phase 1.2b of THE FIX-FIRST BUILD PLAN. Sits between the syntax gate
 * and PR creation. Catches the failure mode no per-file check can see:
 * a fix that's syntactically valid AND clean by per-file pattern checks
 * BUT introduces a new finding when the scanner runs across the whole
 * post-fix workspace (broken import, removed export still referenced,
 * deleted symbol still called, etc.).
 *
 * Algorithm:
 *   1. Build synthetic post-fix workspace = originalFileContents with
 *      each fix's `fixed` content swapped in for that file's path.
 *   2. Call runTier(tier, ctx) with the synthetic workspace to get the
 *      post-fix findings, module by module.
 *   3. For each module's post-fix detail strings, mark any string NOT
 *      present in the original findings for that same module as a
 *      "new finding."
 *   4. Attribute new findings to the fix(es) that touched the file
 *      named in the detail string. If a new finding can't be attributed
 *      to a specific fix (no file path in the string, or the file
 *      wasn't fixed), it's recorded as "unattributed" — the orchestrator
 *      treats unattributed findings as advisory, not as a roll-back
 *      trigger.
 *   5. Roll back any fix that has at least one attributed new finding;
 *      the rest of the fixes proceed to PR.
 *
 * Pure JS, dependency-injected. The route imports this and provides
 * `runTier` from `website/app/lib/scan-modules`. Tests inject a stub
 * runTier so the algorithm can be exercised without touching real
 * scanner modules.
 *
 * Outcome shape:
 *   {
 *     accepted: Fix[],
 *     rolledBack: Array<{ file, fixed, original, issues, reason, newFindings: string[] }>,
 *     unattributedFindings: Array<{ module, detail }>,
 *     postFixFindingsByModule: Record<string, string[]>,
 *     summary: string,
 *   }
 */

/**
 * Build the synthetic post-fix workspace.
 *
 * @param {Array<{ path: string, content: string }>} originalFileContents
 * @param {Array<{ file: string, fixed: string }>} fixes
 * @returns {Array<{ path: string, content: string }>} new workspace
 */
function buildPostFixWorkspace(originalFileContents, fixes) {
  const fixesByPath = new Map();
  for (const f of fixes) fixesByPath.set(f.file, f.fixed);

  // Swap fixed content into the existing files. New files (no original
  // entry) get appended at the end so the workspace contains exactly:
  // every original file, with fixed versions where applicable, plus
  // any net-new files.
  const seenPaths = new Set();
  const result = [];
  for (const f of originalFileContents) {
    if (fixesByPath.has(f.path)) {
      result.push({ path: f.path, content: fixesByPath.get(f.path) });
    } else {
      result.push({ path: f.path, content: f.content });
    }
    seenPaths.add(f.path);
  }
  for (const fix of fixes) {
    if (!seenPaths.has(fix.file)) {
      result.push({ path: fix.file, content: fix.fixed });
    }
  }
  return result;
}

/**
 * Extract a file path from a finding detail string. Modules emit
 * details in shapes like:
 *   "src/foo.js:42: missing semicolon"
 *   "src/foo.js — broken JSON"
 *   "package.json: dependency conflict"
 *   "Module XYZ scanned 12 files, 3 issues"
 *
 * Returns the file path if one is detectable at the start of the
 * string (before the first ':' or em-dash or whitespace), otherwise
 * null. Permissive — false-positives here just mean a finding might
 * get attributed when it shouldn't, but the orchestrator double-checks
 * by confirming the file is in the fix set.
 */
function extractFileFromDetail(detail) {
  if (typeof detail !== 'string' || detail.length === 0) return null;
  // Try the most common shape first: leading path with extension,
  // followed by `:` or ` — ` or whitespace.
  const m = detail.match(/^([\w./\-@+]+?\.[\w]{1,8})(?::|\s+[—-]|\s)/);
  if (m) return m[1];
  return null;
}

/**
 * Diff post-fix findings vs original findings, per module.
 *
 * @param {Record<string, string[]>} originalFindingsByModule
 * @param {Record<string, string[]>} postFixFindingsByModule
 * @returns {Array<{ module, detail }>} new findings (one entry per
 *   detail string that appears post-fix but not in the original).
 */
function diffFindings(originalFindingsByModule, postFixFindingsByModule) {
  const newFindings = [];
  for (const [moduleName, postDetails] of Object.entries(postFixFindingsByModule)) {
    const originalSet = new Set(originalFindingsByModule[moduleName] || []);
    for (const detail of postDetails) {
      if (!originalSet.has(detail)) {
        newFindings.push({ module: moduleName, detail });
      }
    }
  }
  return newFindings;
}

/**
 * Attribute new findings to specific fixes.
 *
 * @param {Array<{ module, detail }>} newFindings
 * @param {Set<string>} fixedFilePaths
 * @returns {{ attributed: Map<string, string[]>, unattributed: Array<{ module, detail }> }}
 *   `attributed` keys are file paths, values are the new-finding
 *   detail strings for that file. `unattributed` is everything else.
 */
function attributeFindings(newFindings, fixedFilePaths) {
  const attributed = new Map();
  const unattributed = [];
  for (const finding of newFindings) {
    const candidatePath = extractFileFromDetail(finding.detail);
    if (candidatePath && fixedFilePaths.has(candidatePath)) {
      const list = attributed.get(candidatePath) || [];
      list.push(`[${finding.module}] ${finding.detail}`);
      attributed.set(candidatePath, list);
    } else {
      unattributed.push(finding);
    }
  }
  return { attributed, unattributed };
}

/**
 * Run the cross-file scanner gate.
 *
 * @param {Object} opts
 * @param {Array<{ file, fixed, original, issues }>} opts.fixes
 * @param {Array<{ path, content }>} opts.originalFileContents
 * @param {Record<string, string[]>} opts.originalFindingsByModule
 *   Findings from the pre-fix scan, grouped by module name. Each
 *   entry is the raw `details` array the module emitted.
 * @param {(tier: string, ctx: object) => Promise<{ modules: Array<{ name, details? }>, totalIssues: number }>} opts.runTier
 *   The scanner runner — typically `runTier` from
 *   `website/app/lib/scan-modules`, dependency-injected for tests.
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} [opts.tier='full']  Which tier to re-run for validation.
 * @param {string[]} [opts.fileList]   Pre-computed list of file paths
 *   in the workspace; defaults to deriving from the synthetic workspace.
 * @returns {Promise<{
 *   accepted: Array<{ file, fixed, original, issues }>,
 *   rolledBack: Array<{ file, fixed, original, issues, reason, newFindings: string[] }>,
 *   unattributedFindings: Array<{ module, detail }>,
 *   postFixFindingsByModule: Record<string, string[]>,
 *   summary: string,
 * }>}
 */
async function validateFixesAgainstScanner(opts) {
  const {
    fixes,
    originalFileContents,
    originalFindingsByModule,
    runTier,
    owner,
    repo,
    tier = 'full',
    fileList,
  } = opts || {};

  if (!Array.isArray(fixes)) throw new TypeError('fixes must be an array');
  if (!Array.isArray(originalFileContents)) throw new TypeError('originalFileContents must be an array');
  if (!originalFindingsByModule || typeof originalFindingsByModule !== 'object') {
    throw new TypeError('originalFindingsByModule must be an object');
  }
  if (typeof runTier !== 'function') throw new TypeError('runTier must be a function');
  if (typeof owner !== 'string' || typeof repo !== 'string') {
    throw new TypeError('owner and repo must be strings');
  }

  // No fixes → trivially nothing to validate.
  if (fixes.length === 0) {
    return {
      accepted: [],
      rolledBack: [],
      unattributedFindings: [],
      postFixFindingsByModule: {},
      summary: 'scanner gate: 0 fixes, nothing to validate',
    };
  }

  const postFixWorkspace = buildPostFixWorkspace(originalFileContents, fixes);
  const files = fileList || postFixWorkspace.map((f) => f.path);

  let runResult;
  try {
    runResult = await runTier(tier, {
      owner,
      repo,
      files,
      fileContents: postFixWorkspace,
    });
  } catch (err) {
    // If the scanner itself throws, fail OPEN — accept all fixes and
    // record the failure in the summary. Failing closed here would
    // block legitimate fixes whenever the scanner has a bug, which
    // is worse than missing a cross-fix conflict.
    const message = err && err.message ? err.message : String(err);
    return {
      accepted: fixes.slice(),
      rolledBack: [],
      unattributedFindings: [],
      postFixFindingsByModule: {},
      summary: `scanner gate: failed-open (runTier threw: ${message})`,
    };
  }

  const postFixFindingsByModule = {};
  for (const m of runResult?.modules || []) {
    if (m && m.name) {
      postFixFindingsByModule[m.name] = Array.isArray(m.details) ? m.details.slice() : [];
    }
  }

  const newFindings = diffFindings(originalFindingsByModule, postFixFindingsByModule);
  const fixedFilePaths = new Set(fixes.map((f) => f.file));
  const { attributed, unattributed } = attributeFindings(newFindings, fixedFilePaths);

  const accepted = [];
  const rolledBack = [];
  for (const fix of fixes) {
    const introduced = attributed.get(fix.file);
    if (introduced && introduced.length > 0) {
      rolledBack.push({
        ...fix,
        reason: `introduced ${introduced.length} new finding(s) on re-scan`,
        newFindings: introduced.slice(),
      });
    } else {
      accepted.push(fix);
    }
  }

  const summary = rolledBack.length === 0
    ? `scanner gate: ${accepted.length} fix${accepted.length !== 1 ? 'es' : ''} validated, no regressions${unattributed.length > 0 ? ` (${unattributed.length} unattributed advisory finding${unattributed.length > 1 ? 's' : ''})` : ''}`
    : `scanner gate: ${accepted.length} accepted, ${rolledBack.length} rolled back (${rolledBack.map((r) => r.file).join(', ')})`;

  return {
    accepted,
    rolledBack,
    unattributedFindings: unattributed,
    postFixFindingsByModule,
    summary,
  };
}

module.exports = {
  validateFixesAgainstScanner,
  // Exported for tests / advanced callers.
  buildPostFixWorkspace,
  extractFileFromDetail,
  diffFindings,
  attributeFindings,
};
