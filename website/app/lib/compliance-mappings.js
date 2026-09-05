'use strict';
/**
 * Re-export shim. The compliance mapping table (module → OWASP / SOC2 / CIS)
 * lives in the engine at src/core/compliance-mappings.js so the CLI's
 * compliance evidence pack, the SARIF reporter and the website's CISO report
 * all read ONE table (Doctrine §4). Same pattern as auto-distill.js.
 */
module.exports = require('../../../src/core/compliance-mappings.js');
