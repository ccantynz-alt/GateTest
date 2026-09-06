// =============================================================================
// deploy-on-box.sh must expect every file its own build rewrites
// =============================================================================
// The box deploy refuses to run over uncommitted changes — the right guard
// against a human editing production by hand. But the deploy's own website
// `prebuild` rewrites tracked files (build-info.json for the commit stamp,
// changelog.json since Move 39), so any generator the script does not list
// locks the box out on the NEXT deploy. That is exactly what happened on
// 2026-09-05: changelog.json was added to the prebuild, not to SELF_DIRTIED,
// and five consecutive deploys exited with "unexpected uncommitted changes"
// while production sat 85 commits behind main.
//
// One definition (Doctrine §4): the prebuild line in website/package.json
// names the generators; each generator names its output under
// website/app/data; SELF_DIRTIED must contain all of them.
// =============================================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'scripts', 'deploy', 'deploy-on-box.sh'), 'utf8');
const PREBUILD = JSON.parse(fs.readFileSync(path.join(ROOT, 'website', 'package.json'), 'utf8')).scripts.prebuild || '';

function selfDirtied() {
  const m = /^SELF_DIRTIED='([^']*)'/m.exec(SCRIPT);
  assert.ok(m, 'deploy-on-box.sh must declare SELF_DIRTIED');
  return new Set(m[1].split(/\s+/).filter(Boolean));
}

function prebuildOutputs() {
  const outputs = new Set();
  for (const rel of PREBUILD.match(/scripts\/[\w-]+\.js/g) || []) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/website\/app\/data\/[\w.-]+\.json/g)) outputs.add(m[0]);
    // path.join('website', 'app', 'data', 'x.json') form
    for (const m of src.matchAll(/'website',\s*'app',\s*'data',\s*'([\w.-]+\.json)'/g)) outputs.add(`website/app/data/${m[1]}`);
  }
  return outputs;
}

test('every file the website prebuild writes is in SELF_DIRTIED', () => {
  const listed = selfDirtied();
  const written = prebuildOutputs();
  assert.ok(written.size >= 2, `expected the prebuild to name its outputs; found ${[...written].join(', ')}`);
  const missing = [...written].filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `add to SELF_DIRTIED in scripts/deploy/deploy-on-box.sh: ${missing.join(' ')}`);
});

test('control: the two known generators are found (build-info.json, changelog.json)', () => {
  const written = prebuildOutputs();
  assert.ok(written.has('website/app/data/build-info.json'));
  assert.ok(written.has('website/app/data/changelog.json'));
});
