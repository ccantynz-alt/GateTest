'use strict';

/**
 * Where is this scan running, and how does a developer get it back on their
 * own machine?
 *
 * The Fifty, move 28: "couldn't reproduce it locally" is the most expensive
 * sentence in CI. `gatetest replay <run-url>` already exists; what was
 * missing was the URL, printed where the failure is read. GitHub Actions
 * exposes everything needed as environment variables, so a blocked gate can
 * lead with the one command that reproduces it.
 *
 * Pure: takes `env` so it can be tested without touching process.env.
 */

/**
 * The URL of the current GitHub Actions run, or null when not in one.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function ciRunUrl(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return null;
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !runId || !/^\d+$/.test(runId)) return null;
  const server = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
  return `${server}/${repo}/actions/runs/${runId}`;
}

/**
 * The one command that reproduces this run locally, or null outside CI.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function replayCommand(env = process.env) {
  const url = ciRunUrl(env);
  return url ? `npx gatetest replay ${url}` : null;
}

module.exports = { ciRunUrl, replayCommand };
