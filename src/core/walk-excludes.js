'use strict';
/**
 * The directory names every tree walk skips — one definition (Doctrine §4).
 * BaseModule._collectFiles walks with it, src/core/migration-dirs.js walks
 * with it, and the mutation sandbox copies around it. Before this each
 * carried its own copy pinned to the others by a test; a list with three
 * homes drifts toward whichever repo its author scans most.
 *
 * 2026-09-05: nine more walkers had their own copy — the import graph
 * (and so importCycle, deadCode, spineHealth, aiHallucination,
 * dependencyReachability), crossFileTaint, undefinedRef, openapiDrift,
 * workspaces, safe-fs, universal-checker and the gitignore hard-skips —
 * each a different subset with a different extra. The import graph's
 * copy also skipped EVERY dot-directory, so a project's `.storybook/`,
 * `.configs/` or `examples/.experimental/` was invisible to the graph
 * while the modules walking with this list scanned it. This list is now
 * the union; a name here is one no first-party source lives under.
 * Everyone imports it (tests/walk-excludes.test.js forbids a copy).
 */
const WALK_EXCLUDES = Object.freeze([
  // version control
  'node_modules', '.git', '.svn', '.hg',
  // build output
  'dist', 'build', 'out', 'target', 'obj', '.next', '.nuxt', '.svelte-kit',
  '.output', '.vercel', '.turbo', '.cache', '.parcel-cache', '.gradle',
  '.dart_tool', 'public/build',
  // third-party trees
  'vendor', 'Pods', 'bower_components', 'jspm_packages', '.cargo', '.terraform',
  // test / coverage output and scratch
  'coverage', '.coverage', '.nyc_output', '.gatetest', 'tmp', 'temp',
  // Python environments and caches
  '__pycache__', '.venv', 'venv', '.tox', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  // editor state
  '.idea', '.vscode',
  // .claude is the agent-coordination dir (worktrees, scratch state).
  // Scanning .claude/worktrees/agent-* inflates findings with duplicate
  // scans of the same code — every gatetest run on a repo with active
  // agent worktrees would produce N× the noise.
  '.claude',
]);
const WALK_EXCLUDE_SET = new Set(WALK_EXCLUDES);

/** Is this directory NAME (one path segment, never a path) skipped by every walk? */
function isExcludedDir(name) {
  return WALK_EXCLUDE_SET.has(name);
}

module.exports = { WALK_EXCLUDES, WALK_EXCLUDE_SET, isExcludedDir };
