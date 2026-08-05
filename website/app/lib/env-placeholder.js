'use strict';
/**
 * Website-side access to the present-but-fake env detector.
 * Same shim pattern as ssrf-guard.js — one definition in src/core so the
 * engine, CLI, /api/status and the Marketplace preflight cannot disagree.
 */
module.exports = require('../../../src/core/env-placeholder.js');
