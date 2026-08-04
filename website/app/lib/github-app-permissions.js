'use strict';
/**
 * Website-side access to the GitHub App permission declaration.
 *
 * Thin re-export, deliberately — unlike `site-url.js`, which needs a genuine
 * second copy so Next can inline `NEXT_PUBLIC_BASE_URL` into client bundles,
 * this is static data with no env dependency. A copy here would be a second
 * thing to keep honest, which is the problem this file exists to end.
 *
 * Same shim pattern as `ssrf-guard.js` / `sentry-client.js`.
 */
module.exports = require('../../../src/core/github-app-permissions.js');
