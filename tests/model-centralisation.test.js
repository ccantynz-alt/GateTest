/**
 * KI #78 — every AI call site must resolve its model through engine-models,
 * so GATETEST_CHEAP_MODEL / GATETEST_FIX_MODEL actually reach it.
 *
 * Before this, ~12 files declared `const MODEL = 'claude-sonnet-5'` and five
 * website routes passed `model: "claude-sonnet-5"` inline. None of them could
 * see the env override, so "engine-models.js is the single source of truth"
 * was true only of the files that already imported it. That matters more than
 * tidiness: earlier in the same audit we found that an Anthropic HTTP error
 * was being reported as "no fix available", so a model retirement would have
 * looked like a quality regression. Being able to repoint every call site
 * with one env var is the mitigation for that.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Files converted to read CHEAP_MODEL from engine-models.
const CONVERTED = [
  'src/modules/agentic.js',
  'src/modules/ai-review.js',
  'src/modules/architecture-drift.js',
  'src/modules/intent-verification.js',
  'src/modules/regression-predictor.js',
  'src/core/bidirectional-test-gate.js',
  'lib/ai-ci-fixer-claude.js',
  'website/app/lib/chat-system-prompt.js',
  'website/app/lib/scan-modules/ai.ts',
  'website/app/api/admin/health/route.ts',
  'website/app/api/heal/sentry-webhook/route.ts',
  'website/app/api/scan/guidance/route.ts',
  'website/app/api/scan/server-fix/route.ts',
  'website/app/api/watches/tick/route.ts',
];

describe('KI #78 — AI call sites resolve models through engine-models', () => {
  for (const rel of CONVERTED) {
    it(`${rel} imports CHEAP_MODEL`, () => {
      assert.match(read(rel), /CHEAP_MODEL\s*\}\s*=\s*require\(/, 'must pull the model from engine-models');
    });

    it(`${rel} has no hardcoded model literal left`, () => {
      const src = read(rel);
      // Comments may still NAME a model when explaining history; only
      // executable literals are the problem.
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      assert.ok(
        !/(?:const\s+\w*MODEL\w*\s*=\s*|model:\s*)["']claude-[a-z0-9.-]+["']/.test(code),
        'a literal model id must not come back — route it through engine-models',
      );
    });
  }

  it('the env override reaches engine-models', () => {
    const before = process.env.GATETEST_CHEAP_MODEL;
    try {
      process.env.GATETEST_CHEAP_MODEL = 'claude-override-probe';
      delete require.cache[require.resolve('../src/core/engine-models')];
      const em = require('../src/core/engine-models');
      assert.strictEqual(em.CHEAP_MODEL, 'claude-override-probe');
    } finally {
      if (before === undefined) delete process.env.GATETEST_CHEAP_MODEL;
      else process.env.GATETEST_CHEAP_MODEL = before;
      delete require.cache[require.resolve('../src/core/engine-models')];
      require('../src/core/engine-models');
    }
  });

  it('every converted CommonJS file still loads', () => {
    for (const rel of CONVERTED.filter((f) => f.endsWith('.js') && !f.startsWith('website/app/api/'))) {
      assert.doesNotThrow(() => require(path.join(ROOT, rel)), `${rel} failed to load`);
    }
  });
});

describe('KI #78 — FALLBACK_MODEL is documented as unwired, not as a safety net', () => {
  // It is exported and asserted in tests (including a marketing-claim test),
  // but NO production code retries on it. The docstring used to call it a
  // "refusal fallback", which reads as an automatic retry that does not exist.
  it('no production code retries on FALLBACK_MODEL', () => {
    const users = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        // `.claude` holds tooling state, including git worktrees created by
        // agents — scanning it makes this suite fail on a normal parallel
        // workflow by finding copies of its own test files. Every scanner
        // module in src/ already excludes it; this walk did not.
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git'
          || e.name === '.claude' || e.name === 'dist') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(js|ts|tsx|mjs|cjs)$/.test(e.name)) continue;
        const rel = path.relative(ROOT, p).replace(/\\/g, '/');
        if (rel.startsWith('tests/') || rel.includes('engine-models')) continue;
        if (/\bFALLBACK_MODEL\b/.test(fs.readFileSync(p, 'utf8'))) users.push(rel);
      }
    };
    walk(ROOT);
    assert.deepStrictEqual(
      users,
      [],
      'FALLBACK_MODEL gained a consumer — update both engine-models docstrings, which currently say it is unwired',
    );
  });

  it('both engine-models twins say plainly that it is not wired', () => {
    for (const rel of ['website/app/lib/engine-models.js', 'src/core/engine-models.js']) {
      assert.match(read(rel), /DECLARED, NOT WIRED/, `${rel} must not re-advertise a retry that does not exist`);
    }
  });
});
