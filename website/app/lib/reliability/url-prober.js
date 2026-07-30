/**
 * Re-export shim — the canonical URL prober lives at
 * src/core/reliability/url-prober.js.
 *
 * The whole reliability/ tree moved to src/core on 2026-07-30 (KI #74g) because
 * `bin/gatetest-reliability` loaded it from website/, which the published npm
 * package excludes — so that command crashed with MODULE_NOT_FOUND for every
 * installed user despite being one of the three `bin` entries package.json
 * declares.
 *
 * This one file keeps a shim because website/app/api/web/scan/route.ts imports
 * it live. The rest of the tree had no website importers and moved without one.
 *
 * Keep it a one-line re-export: tests/lib-shims.test.js asserts function
 * IDENTITY against the src/core canonical.
 */
module.exports = require('../../../../src/core/reliability/url-prober.js');
