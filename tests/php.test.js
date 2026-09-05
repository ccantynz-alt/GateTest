const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PhpModule = require('../src/modules/php');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('PhpModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-php-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new PhpModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new PhpModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

// 2026-09-05, laravel/framework: 23 of 28 blocking findings were
// `$redis->eval($lua)` — Redis Lua EVAL on a connection, not PHP eval().
describe('PhpModule — eval is the language builtin, not a method', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-php-eval-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  async function evalFindings(source) {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'Thing.php'), `<?php\n${source}\n`);
    const result = makeResult();
    await new PhpModule().run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && /php:eval/.test(c.name));
  }
  it('stays quiet on $redis->eval() and Redis::eval()', async () => {
    assert.deepStrictEqual(await evalFindings('$connection->eval($script, 1, $key);\nRedis::eval($lua);'), []);
  });
  it('still fires on the builtin', async () => {
    assert.strictEqual((await evalFindings('$out = eval($userCode);')).length, 1);
  });
});

describe('PhpModule — a method DEFINITION named eval is not a call', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-php-evaldef-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  it('public function eval($script, ...) is quiet; eval(var_export(...)) still fires', async () => {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'Conn.php'), '<?php\nclass Conn {\n    public function eval($script, $numberOfKeys, ...$arguments) { return $this->client->eval($script); }\n    public function cache($value) { eval(var_export($value, true).";"); }\n}\n');
    const result = makeResult();
    await new PhpModule().run(result, { projectRoot: tmp });
    const hits = result.checks.filter((c) => !c.passed && /php:eval/.test(c.name));
    assert.strictEqual(hits.length, 1, hits.map((h) => h.name).join(', '));
    assert.strictEqual(hits[0].line, 4);
  });
});
