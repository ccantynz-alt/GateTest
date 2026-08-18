'use strict';

// The hosted remote MCP manifest must be a build artifact of the registry —
// it was hand-generated once (120 modules) and told every claude.ai user the
// wrong count for three weeks after module #121 shipped (2026-08-18 audit).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../scripts/generate-mcp-remote-modules.js');

test('website/app/lib/mcp-remote-modules.json matches src/core/registry.js exactly (run scripts/generate-mcp-remote-modules.js)', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'website', 'app', 'lib', 'mcp-remote-modules.json'), 'utf8'));
  const fresh = build();
  assert.equal(file.count, fresh.count, 'count drifted');
  assert.deepEqual(file.modules.map((m) => m.name), fresh.modules.map((m) => m.name), 'module list drifted');
  assert.equal(file.count, file.modules.length);
});
