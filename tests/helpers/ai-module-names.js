'use strict';

/**
 * Registry names of every scan module that talks to the Anthropic API,
 * DERIVED from the code rather than hand-listed: a module is "AI" if its
 * source (or a src/core helper it requires) contains the API host or the
 * x-api-key header. Used to assert that `AI_ENGINE_MODULES` in
 * website/app/lib/scan-engine-dispatch.ts stays complete — the deterministic
 * every-push tier must never leak Anthropic spend when a new AI module lands.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const API_MARKERS = /api\.anthropic\.com|['"]x-api-key['"]/;
// Fix-time helpers: modules import these for `autoFix` only, which never runs
// on a scan. Following them would wrongly mark deterministic modules as AI.
const FIX_TIME_HELPERS = new Set(['ai-fix-engine.js', 'cli-fix-orchestrator.js', 'bidirectional-test-gate.js']);

function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'registry.js'), 'utf8');
  const out = [];
  const re = /^\s*([A-Za-z0-9_]+):\s*['"](\.\.\/modules\/[^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], file: path.join(ROOT, 'src', 'core', m[2]) });
  return out;
}

function callsAnthropic(file, seen = new Set()) {
  if (seen.has(file) || !fs.existsSync(file)) return false;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  if (API_MARKERS.test(src)) return true;
  // Follow local requires into src/core helpers one level deep.
  const req = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = req.exec(src))) {
    let target = path.resolve(path.dirname(file), m[1]);
    if (!target.endsWith('.js')) target += '.js';
    if (FIX_TIME_HELPERS.has(path.basename(target))) continue;
    if (target.includes(path.join('src', 'core')) && callsAnthropic(target, seen)) return true;
  }
  return false;
}

const AI_MODULE_NAMES = readRegistry()
  .filter((r) => callsAnthropic(r.file))
  .map((r) => r.name)
  .sort();

module.exports = { AI_MODULE_NAMES };
