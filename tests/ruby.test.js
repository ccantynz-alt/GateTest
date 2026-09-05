const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RubyModule = require('../src/modules/ruby');

function makeResult() {
  return {
    checks: [],
    addCheck(name, passed, details = {}) { this.checks.push({ name, passed, ...details }); },
  };
}

describe('RubyModule — baseline shape', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ruby-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('exposes the expected BaseModule shape', () => {
    const mod = new RubyModule();
    assert.strictEqual(typeof mod.name, 'string');
    assert.ok(mod.name.length > 0);
    assert.strictEqual(typeof mod.description, 'string');
    assert.ok(mod.description.length > 0);
    assert.strictEqual(typeof mod.run, 'function');
  });

  it('runs without throwing on an empty project root', async () => {
    const mod = new RubyModule();
    const result = makeResult();
    await assert.doesNotReject(mod.run(result, { projectRoot: tmp }));
  });
});

describe('RubyModule — eval rule targets non-literal arguments (2026-08-18 audit)', () => {
  const { LANGUAGE_SPECS } = require('../src/core/universal-checker');
  const rule = LANGUAGE_SPECS.ruby.patterns.find((p) => p.name === 'eval').pattern;
  it('eval of a STRING LITERAL is the safe form and is not flagged', () => {
    assert.strictEqual(rule.test(`  buf = binding.eval('@_out_buf')`), false);
    assert.strictEqual(rule.test(`  eval("1 + 1")`), false);
  });
  it('POSITIVE CONTROL: eval of a variable / expression fires', () => {
    assert.strictEqual(rule.test(`  eval(params[:code])`), true);
    assert.strictEqual(rule.test(`  instance_eval user_input`), true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Measured on rails/rails @1ec64ce (2026-09-05), --suite full: 56 blocking.
// `ruby:eval` accounted for 54 findings and `ruby:system-interp` for 14, and
// the majority of both were not what the rule names.
// ─────────────────────────────────────────────────────────────────────────────
describe('RubyModule — rails @1ec64ce: what a method NAME is not', () => {
  let tmp;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ruby-rails-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  async function scan(rel, source) {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, source);
    const result = makeResult();
    await new RubyModule().run(result, { projectRoot: tmp });
    return result.checks.filter((c) => !c.passed && c.name.startsWith('ruby:'));
  }
  const rules = (found) => found.map((c) => c.name.split(':')[1]);

  it('a database connection\'s .exec is a query, not a shell', async () => {
    // actioncable/lib/action_cable/subscription_adapter/postgresql.rb:22 —
    // reported as command injection. `exec` on a receiver is a method; the
    // shell is `Kernel#exec`, `system`, or a backtick literal.
    const found = await scan('lib/pg.rb', 'pg_conn.exec("NOTIFY #{pg_conn.escape_identifier(channel)}")\n');
    assert.deepStrictEqual(rules(found).filter((r) => r === 'system-interp'), []);
  });

  it('a backtick-quoted word inside an error message is prose', async () => {
    // actionpack/lib/action_dispatch/http/param_builder.rb:139 and dozens like
    // it. A first fix matched any `` `…#{ `` and took the repo from 56 to 127
    // blocking on lines like this one.
    const found = await scan('lib/p.rb',
      'raise ParameterTypeError, "expected Array (got #{params[k].class.name}) for `#{k}`"\n');
    assert.deepStrictEqual(rules(found).filter((r) => r === 'system-interp'), []);
  });

  it('a real command literal with interpolation still fires', async () => {
    // railties/lib/rails/generators/app_base.rb:543 — genuinely a shell.
    const found = await scan('lib/gen.rb', 'output = `#{command}`\n');
    assert.ok(rules(found).includes('system-interp'), 'assignment from a backtick command must fire');
  });

  it('system() with interpolation still fires', async () => {
    const found = await scan('lib/s.rb', 'system("rm -rf #{dir}")\n');
    assert.ok(rules(found).includes('system-interp'));
  });

  it('class_eval carrying __FILE__ / .lineno is code generation, not eval', async () => {
    // activesupport/lib/active_support/configurable.rb:172 and
    // core_ext/module/attribute_accessors.rb:86. A source location is what
    // generated code carries; user input never comes with one.
    const found = await scan('lib/cfg.rb', [
      'class_eval reader, __FILE__, reader_line if instance_reader',
      'module_eval(definition.join(";"), location.path, location.lineno)',
      '',
    ].join('\n'));
    assert.deepStrictEqual(rules(found).filter((r) => r === 'eval'), []);
  });

  it('eval of what the program is handed still fires', async () => {
    // railties/lib/rails/commands/runner/runner_command.rb:38 — `rails runner`
    // evaluates stdin by design. The rule is right to report it; Rails is
    // right to ignore it. Neither side gets to make the other silent.
    const found = await scan('lib/run.rb', 'eval($stdin.read, TOPLEVEL_BINDING, "stdin")\n');
    assert.ok(rules(found).includes('eval'));
  });

  it('an error-severity rule inside a test tree reports as warning, not error', async () => {
    // actionview/test/template/asset_tag_helper_test.rb:489 — `eval(method)`
    // over a table of helper names. A test exercising eval is not an attack
    // surface. Before: test files downgraded only NON-error severities, so
    // eval/exec/system-interp stayed blocking inside test/.
    const found = await scan('test/helper_test.rb', 'AssetPathToTag.each { |m, tag| assert_dom_equal(tag, eval(m)) }\n');
    const ev = found.find((c) => c.name.startsWith('ruby:eval'));
    assert.ok(ev, 'still reported');
    assert.strictEqual(ev.severity, 'warning', 'reported, not a build verdict');
  });

  it('the same eval outside a test tree is an error', async () => {
    const found = await scan('lib/x.rb', 'eval(user_input)\n');
    const ev = found.find((c) => c.name.startsWith('ruby:eval'));
    assert.ok(ev); assert.strictEqual(ev.severity, 'error');
  });
});
