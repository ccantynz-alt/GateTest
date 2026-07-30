/**
 * Re-export shim — the canonical recipe-store-remote lives at
 * src/core/recipe-store-remote.js.
 *
 * Moved with auto-distill 2026-07-30: auto-distill requires it by relative
 * path, so leaving it under `website/` would have re-created the same
 * did-not-ship gap one level down. See Known Issue #74.
 *
 * Keep this a one-line re-export: tests/lib-shims.test.js asserts function
 * IDENTITY between this module and the src/core canonical.
 */
module.exports = require('../../../src/core/recipe-store-remote.js');
