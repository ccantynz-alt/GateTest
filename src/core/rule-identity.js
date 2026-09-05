'use strict';
/**
 * The identity of a RULE, as opposed to a finding: the check name with the
 * file and line it embedded stripped off. `hardcodedUrl:hardcoded-url:localhost:src/cfg.js:1`
 * → `hardcodedUrl:hardcoded-url:localhost`. One definition, imported by the
 * runner (suppressed-rule accounting), the flywheel recorder (per-rule
 * fired / silenced counts) and the noise model (KI #76, the Fifty move 07).
 */
function ruleIdentity(check) {
  let key = String((check && check.name) || '');
  const file = (check && (check.file || check.filePath)) || '';
  if (file) {
    const at = key.indexOf(`:${file}`);
    if (at > 0) key = key.slice(0, at);
  }
  // Trailing `:<line>` survives when the name embedded a path we couldn't
  // match verbatim (separator differences, relative vs absolute).
  return key.replace(/:\d+$/, '');
}

module.exports = { ruleIdentity };
