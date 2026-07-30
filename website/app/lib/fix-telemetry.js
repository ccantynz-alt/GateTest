/**
 * Re-export shim — the canonical fix-telemetry lives at
 * src/core/fix-telemetry.js.
 *
 * Moved there 2026-07-30 for the same reason as auto-distill: it lived under
 * `website/`, which the published npm package excludes, so the CLI could never
 * load it. See Known Issue #74.
 *
 * Keep this a one-line re-export: tests/lib-shims.test.js asserts function
 * IDENTITY between this module and the src/core canonical.
 */
module.exports = require('../../../src/core/fix-telemetry.js');
