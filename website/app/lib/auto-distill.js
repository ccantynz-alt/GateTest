/**
 * Re-export shim — the canonical auto-distill lives at src/core/auto-distill.js.
 *
 * Moved there 2026-07-30 because it was the engine's flywheel and it did not
 * SHIP. `package.json` `files` is `["bin/","src/","lib/",…]` and `.npmignore`
 * excludes `website/`, so for every `npm i -g @gatetest/cli` user this module
 * simply did not exist — `flywheel-playback-engine._loadAutoDistill()` caught
 * the missing require and returned null, silently disabling both recipe
 * playback and distillation. See Known Issue #74.
 *
 * Keep this a one-line re-export: tests/lib-shims.test.js asserts function
 * IDENTITY between this module and the src/core canonical — forking it back
 * into a copy fails the suite.
 */
module.exports = require('../../../src/core/auto-distill.js');
