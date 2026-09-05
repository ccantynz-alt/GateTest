const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RustModule = require('../src/modules/rust-lang');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('RustModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rust-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new RustModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new RustModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

// 2026-09-05, tokio-rs/axum: 13 of 28 blocking findings were `todo!()` /
// `unimplemented!()` inside `#[cfg(test)] mod tests` at the bottom of a
// source file — test code the path pattern cannot see.
describe('RustModule — #[cfg(test)] opens test scope for the rest of the file', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-rust-cfg-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  async function scan(source) {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'lib.rs'), source);
    const result = makeResult();
    await new RustModule().run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && /rust:(?:todo-macro|unimplemented)/.test(c.name));
  }
  it('a todo!() under #[cfg(test)] is a warning, one above it is an error', async () => {
    const found = await scan([
      'pub fn real() -> u32 { unimplemented!() }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    fn helper() -> u32 { todo!() }',
      '}',
      '',
    ].join('\n'));
    const bySev = Object.fromEntries(found.map((c) => [c.line, c.severity]));
    assert.strictEqual(bySev[1], 'error', 'shipped code keeps blocking');
    assert.strictEqual(bySev[5], 'warning', 'test module is reported, not blocking');
  });
});
