'use strict';
/**
 * The directory names every tree walk skips — one definition (Doctrine §4).
 * BaseModule._collectFiles walks with it, src/core/migration-dirs.js walks
 * with it, and the mutation sandbox copies around it. Before this each
 * carried its own copy pinned to the others by a test; a list with three
 * homes drifts toward whichever repo its author scans most.
 */
const WALK_EXCLUDES = Object.freeze([
  'node_modules', '.git', 'dist', 'build', '.gatetest', 'coverage',
  '.next', '.nuxt', '.svelte-kit', '.output', '.vercel', '.turbo',
  '__pycache__', '.pytest_cache', 'target', 'vendor', '.cargo',
  'out', 'public/build', '.cache', '.parcel-cache',
  // .claude is the agent-coordination dir (worktrees, scratch state).
  // Scanning .claude/worktrees/agent-* inflates findings with duplicate
  // scans of the same code — every gatetest run on a repo with active
  // agent worktrees would produce N× the noise.
  '.claude',
]);

module.exports = { WALK_EXCLUDES };
