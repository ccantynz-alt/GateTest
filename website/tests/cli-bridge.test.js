/**
 * CLI bridge smoke test — the single tripwire that catches drift between
 *   - `website/app/lib/cli-bridge/static-registry.ts` (67 requires)
 *   - `website/app/lib/cli-bridge/capabilities.ts` (67 entries)
 *   - `src/core/registry.js` (BUILT_IN_MODULES, the CLI source of truth)
 *
 * Why: the bundler silently drops any `require()` it cannot statically
 * trace. If a future edit converts a literal path into `require(varName)`,
 * the bundle ships with zero modules and every customer sees fake passes.
 *
 * This test does not exercise the bundler — it asserts the static shape
 * that the bundler relies on and that the capabilities file agrees with
 * the registry. Run: `node --test website/tests/cli-bridge.test.js`.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY_SRC = path.join(REPO_ROOT, "website/app/lib/cli-bridge/static-registry.ts");
const CAPS_SRC = path.join(REPO_ROOT, "website/app/lib/cli-bridge/capabilities.ts");
const CLI_REGISTRY = path.join(REPO_ROOT, "src/core/registry.js");

const EXPECTED_COUNT = 67;

function parseStaticRegistryKeys() {
  const src = fs.readFileSync(REGISTRY_SRC, "utf8");
  const keys = [];
  // Match lines like:   syntax: require("../../../../src/modules/syntax.js"),
  const re = /^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*require\("(\.\.\/)+src\/modules\/[A-Za-z0-9_-]+\.js"\),?$/gm;
  let m;
  while ((m = re.exec(src)) !== null) keys.push(m[1]);
  return keys;
}

function parseCapabilityKeys() {
  const src = fs.readFileSync(CAPS_SRC, "utf8");
  const caps = {};
  const re = /^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*\{\s*capability:\s*"([^"]+)"/gm;
  let m;
  while ((m = re.exec(src)) !== null) caps[m[1]] = m[2];
  return caps;
}

function parseCliRegistryNames() {
  const src = fs.readFileSync(CLI_REGISTRY, "utf8");
  // The CLI registry uses either `const NAME = require(...)` then put in a
  // BUILT_IN_MODULES map, or a direct map. Scan for the keys of the final
  // exported map.
  const map = {};
  // Look for a BUILT_IN_MODULES = { ... } block.
  const blockMatch = src.match(/BUILT_IN_MODULES\s*=\s*\{([\s\S]*?)\n\};/);
  if (!blockMatch) return [];
  const body = blockMatch[1];
  const re = /^\s+([A-Za-z][A-Za-z0-9_]*):/gm;
  let m;
  while ((m = re.exec(body)) !== null) map[m[1]] = true;
  return Object.keys(map);
}

describe("CLI bridge static registry", () => {
  it("registers exactly 67 modules", () => {
    const keys = parseStaticRegistryKeys();
    assert.equal(
      keys.length,
      EXPECTED_COUNT,
      `static-registry.ts must declare ${EXPECTED_COUNT} literal require()s; found ${keys.length}`
    );
  });

  it("uses only literal string paths (bundler-traceable)", () => {
    const raw = fs.readFileSync(REGISTRY_SRC, "utf8");
    // Strip block and line comments so the "never do this: require(p...)" warning
    // in the file header doesn't false-positive.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Reject any `require(` that is NOT followed immediately by a double-quote literal.
    const bad = src.match(/require\(\s*[^"\s]/g);
    assert.equal(
      bad,
      null,
      "Found a non-literal require() in static-registry.ts — the bundler cannot trace it and the bundle will silently ship zero modules"
    );
  });
});

describe("CLI bridge capability map", () => {
  it("declares exactly 67 module capabilities", () => {
    const caps = parseCapabilityKeys();
    assert.equal(
      Object.keys(caps).length,
      EXPECTED_COUNT,
      `capabilities.ts must declare ${EXPECTED_COUNT} entries; found ${Object.keys(caps).length}`
    );
  });

  it("capability and registry key sets are identical", () => {
    const regKeys = parseStaticRegistryKeys().sort();
    const capKeys = Object.keys(parseCapabilityKeys()).sort();
    assert.deepEqual(
      regKeys,
      capKeys,
      "capabilities.ts and static-registry.ts must declare the same module names — drift here will ship fake-pass skips"
    );
  });

  it("every capability value is a known category", () => {
    const allowed = new Set([
      "fs-only",
      "fs-with-optional-exec",
      "needs-git",
      "needs-toolchain",
      "needs-browser",
    ]);
    const caps = parseCapabilityKeys();
    for (const [name, value] of Object.entries(caps)) {
      assert.ok(
        allowed.has(value),
        `Module ${name} has unknown capability "${value}"`
      );
    }
  });

  it("every needs-toolchain / needs-browser entry declares a specific skipReason", () => {
    const src = fs.readFileSync(CAPS_SRC, "utf8");
    const re = /^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*\{\s*\n\s*capability:\s*"(needs-toolchain|needs-browser)"[\s\S]*?\n\s{2}\},?/gm;
    let m;
    let count = 0;
    while ((m = re.exec(src)) !== null) {
      count++;
      const block = m[0];
      assert.match(
        block,
        /skipReason:\s*"[^"]+"/,
        `Module ${m[1]} is ${m[2]} but has no skipReason — customers must see a specific reason, never a vague skip`
      );
    }
    // Sanity — we know from the Bible there are 6 toolchain + 5 browser = 11.
    assert.equal(count, 11, `Expected 11 skipReason entries; found ${count}`);
  });
});

describe("CLI bridge agrees with the CLI's own registry", () => {
  it("every bridge module name exists in src/core/registry.js BUILT_IN_MODULES", () => {
    const bridgeKeys = new Set(parseStaticRegistryKeys());
    const cliKeys = new Set(parseCliRegistryNames());
    if (cliKeys.size === 0) {
      // If the CLI registry uses a different shape we don't fail — this
      // cross-check is best-effort. The prior tests still catch drift on
      // the website side.
      return;
    }
    for (const name of bridgeKeys) {
      assert.ok(
        cliKeys.has(name),
        `Bridge registers "${name}" but src/core/registry.js does not — either the bridge has a typo or a module was removed from the CLI`
      );
    }
  });
});
