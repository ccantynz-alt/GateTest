// =============================================================================
// FLAKY-TESTS — hermetic tests are not "real network" calls
// =============================================================================
// The warning-volume audit (2026-09-01) started from a number nobody had
// looked at: axios @81df7a5 (org axios) produced 487 non-blocking warnings on
// a clean scan. Warnings do not block, but volume on clean code is how a tool
// teaches developers to stop reading it.
//
// flaky-tests was 264 of the 487 — 54% of the noise from one module, on an
// HTTP client library whose test suite necessarily makes HTTP calls. Three
// distinct false-positive classes, each found by opening the flagged line
// rather than by reasoning about the rule:
//
//  1. INJECTED FETCH. tests/smoke/bun/tests/cancel.smoke.test.ts defines
//     `const fetch = async () => new Response(…)` and passes it in. The URL
//     `https://example.com/in-flight` is never requested. The hint list
//     recognised mocking LIBRARIES only, so the modern inject-your-own-fetch
//     pattern read as an unmocked call.
//
//  2. LOOPBACK. tests/unit/adapters/http.test.js calls `http.createServer` 14
//     times and points 96 of its 126 requests at localhost / 127.0.0.1 /
//     [::1]. There is no DNS to hiccup and no third party to 5xx — the two
//     failures the rule's own message names. 113 findings from that one file.
//
//  3. HAND-BUILT TEST DOUBLE. The smoke tests build `createTransportMock()`
//     and pass it as `transport`, so the request never reaches the network
//     stack.
//
// Result: 264 -> 111 on axios, with the genuine unmocked call still firing.
//
// A NOTE ON METHOD, because it is the more useful lesson: I sampled ONE
// finding, fixed its class, and expected a large drop. It removed 7 of 264.
// The sample was not representative and I had assumed it was. The reduction
// only came from going back and counting where the findings actually were.
//
// The load-bearing test here is the last group. Every fix above is a
// suppression, and a suppression with no positive control is indistinguishable
// from breaking the rule.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FlakyTestsModule = require('../src/modules/flaky-tests');

async function networkFindings(filename, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-flaky-'));
  try {
    const full = path.join(root, 'tests', filename);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    await new FlakyTestsModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed && /real-network/.test(c.id));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('flaky-tests — hermetic tests are silent', () => {
  const HERMETIC = {
    'injects its own fetch (axios cancel.smoke)':
      "const fetch = async () => new Response('{}', { status: 200 });\n"
      + "test('t', async () => { await axios.get('https://example.com/in-flight', { fetch }); });\n",

    'patches the global fetch':
      "globalThis.fetch = async () => new Response('{}');\n"
      + "test('t', async () => { await axios.get('https://example.com/x'); });\n",

    'loopback — localhost':
      "test('t', async () => { await axios.get('http://localhost:4444/x'); });\n",

    'loopback — 127.0.0.1':
      "test('t', async () => { await axios.get('http://127.0.0.1:8080/y'); });\n",

    'loopback — IPv6 [::1]':
      "test('t', async () => { await fetch('http://[::1]:9000/z'); });\n",

    'hand-built transport double (axios formData.smoke)':
      'const createTransportMock = () => ({ request(o, cb) {} });\n'
      + "test('t', async () => { await axios.post('http://example.com/form', f, { transport: createTransportMock() }); });\n",

    'axios-mock-adapter':
      "const mock = new MockAdapter(axios);\n"
      + "test('t', async () => { await axios.get('https://api.example.com/v1'); });\n",
  };

  for (const [why, src] of Object.entries(HERMETIC)) {
    it(`silent: ${why}`, async () => {
      const found = await networkFindings('a.test.js', src);
      assert.deepStrictEqual(
        found.map((f) => f.id), [],
        `${why} does not touch the network and must not be called flaky`,
      );
    });
  }
});

describe('flaky-tests — genuine unmocked calls still fire', () => {
  // Without this group, deleting the rule entirely would satisfy everything
  // above. Each case is a real external call with no test double in the file.
  const REAL = {
    'axios to a public host':
      "test('t', async () => { await axios.get('https://api.example.com/v1/users'); });\n",

    'fetch to a public host':
      "test('t', async () => { const r = await fetch('https://api.stripe.com/v1/charges'); });\n",

    // Loopback suppression is per-LINE, so an external call in the same file
    // as loopback calls must still be reported. axios's own adapter test has
    // exactly this shape.
    'external call sharing a file with loopback calls':
      "test('a', async () => { await axios.get('http://localhost:4444/ok'); });\n"
      + "test('b', async () => { await axios.get('https://api.example.com/v1/live'); });\n",
  };

  for (const [why, src] of Object.entries(REAL)) {
    it(`fires: ${why}`, async () => {
      const found = await networkFindings('b.test.js', src);
      assert.ok(
        found.length > 0,
        `${why} is a real network dependency and must still be reported`,
      );
    });
  }
});

describe('flaky-tests — the mock heuristic stays at warning severity', () => {
  // gluecron-com-78's point, adopted: the "a file declaring a Mock/Stub/Fake
  // binding is a file that mocks" hint knowingly admits a false negative — a
  // data fixture named `mockUser` in a file that also calls out for real would
  // go unreported. That trade is defensible at WARNING severity, where 80
  // false warnings cost more trust than one missed advisory.
  //
  // It is NOT defensible if the same heuristic ever gates something blocking,
  // or anything a user reads as a security signal. So the severity boundary is
  // the contract, pinned here, and a future refactor that promotes this module
  // has to come back and meet the argument rather than inherit the exemption.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'modules', 'flaky-tests.js'), 'utf8',
  );

  // My first version of this asserted the whole module was warning-only, and
  // it failed immediately: `flaky-tests:only-committed` is error severity, and
  // rightly so — a committed `.only` / `fit(` silently disables the rest of
  // the suite, so CI reports green having run one test. That rule does not
  // consult the mock heuristic at all.
  //
  // The contract is narrower than "nothing here blocks": what must stay
  // non-blocking is the rule the heuristic GATES. Writing the broad version
  // first and being corrected by it is the reason to assert the specific one.

  it('the rule gated by the mock heuristic is warning severity', async () => {
    // Behavioural, not textual: run the rule and read the severity it emits.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-flaky-sev-'));
    try {
      const full = path.join(root, 'tests', 'sev.test.js');
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(
        full,
        "test('t', async () => { await axios.get('https://api.example.com/v1/users'); });\n",
      );
      const checks = [];
      const result = {
        addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
        addInfo() {},
      };
      await new FlakyTestsModule().run(result, { projectRoot: root });
      const net = checks.filter((c) => !c.passed && /real-network/.test(c.id));
      assert.ok(net.length > 0, 'the real-network rule did not fire on a genuine call');
      for (const f of net) {
        assert.strictEqual(
          f.meta.severity, 'warning',
          'real-network has been promoted to a blocking severity. Its mock-name '
          + 'heuristic knowingly trades a false negative for quieter warnings, '
          + 'which is only defensible while it cannot fail a build. Re-argue the '
          + 'trade before promoting it.',
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('only-committed stays blocking — it is not gated by the heuristic', () => {
    // The other half of the boundary: narrowing the contract must not quietly
    // license softening a rule that should block. A committed `.only` makes a
    // green CI run meaningless.
    assert.match(
      src,
      /only-committed[\s\S]{0,200}severity:\s*'error'/,
      'only-committed is no longer blocking — a committed .only makes CI green on one test',
    );
  });
});
