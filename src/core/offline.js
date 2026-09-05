'use strict';
/**
 * Offline / air-gapped mode — one switch, one definition (the Fifty, move 42).
 *
 * `gatetest --offline` (or GATETEST_OFFLINE=1) promises that NOTHING leaves
 * the machine: no telemetry upload, no AI calls, no live API ping from
 * `--doctor`. The engine already scans without a network — every module
 * reads the tree; the only outbound calls are the best-effort telemetry
 * flush and the opt-in Anthropic-backed fix paths — so the switch mostly
 * turns a promise the engine already keeps into one it states and records:
 * the summary carries `offline: true`, the signed provenance carries it under
 * scope, and the console says it. Anything that would need the network is
 * reported as not run, never attempted and never silently skipped.
 */

function isOffline(env = process.env) {
  const v = env.GATETEST_OFFLINE;
  return Boolean(v) && v !== '0' && String(v).toLowerCase() !== 'false';
}

/** Turn the mode on for this process: no upload, no telemetry buffer either. */
function enableOffline(env = process.env) {
  env.GATETEST_OFFLINE = '1';
  env.GATETEST_NO_TELEMETRY = '1';
}

const OFFLINE_NOTE = 'offline mode — nothing leaves this machine: no telemetry upload, no AI calls';

module.exports = { isOffline, enableOffline, OFFLINE_NOTE };
