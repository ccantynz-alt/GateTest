/**
 * Re-export shim — the canonical SSRF guard lives at src/core/ssrf-guard.js.
 *
 * Moved there 2026-07-30 (KI #74g). It sat under website/, which the published
 * npm package excludes, and reliability/url-prober.js requires it — so
 * `bin/gatetest-reliability` (a declared `bin` entry) crashed with
 * MODULE_NOT_FOUND for every installed user.
 *
 * The shim stays because four live API routes import this path:
 * api/web/scan, api/web/scan/stream, api/wp/scan, api/wp/scan/stream.
 *
 * Keep it a one-line re-export: tests/lib-shims.test.js asserts function
 * IDENTITY against the src/core canonical — forking it into a copy fails the
 * suite, which for an SSRF guard would mean two different ideas of which hosts
 * are safe to reach.
 */
module.exports = require('../../../src/core/ssrf-guard.js');
