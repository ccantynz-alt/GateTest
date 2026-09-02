// =============================================================================
// CLAUDE-COMPLIANCE — `raise NotImplementedError` after a docstring CODE EXAMPLE
// =============================================================================
// The first time this engine was ever run against a Python repository
// (2026-09-01), it reported a blocking "not-implemented stub" on
// pallets/flask @d318b68, src/flask/sansio/scaffold.py:441 — which is the
// correct Python idiom for "subclasses must override".
//
// The guard for that idiom already existed, and already worked: the same file
// has a bare `raise NotImplementedError` at line 221 that it correctly
// cleared. What it could not see was DOCUMENTATION.
//
// `_looksAbstract` finds the enclosing method by walking up for a `def` at a
// lower indent. Flask's `add_url_rule` docstring contains:
//
//     .. code-block:: python
//
//         @app.endpoint("index")
//         def index():
//             ...
//
// so the walk matched `def index():` — prose inside a docstring — treated it
// as the enclosing signature, found ordinary documentation text in the
// "body", and concluded the method was concrete.
//
// Two fixes: skip a candidate `def` when an odd number of triple-quotes sits
// between it and the raise (i.e. it is inside a docstring), and widen the
// lookback, because a 60-line window cannot reach past a long API docstring
// to the real `def` — which is exactly where these methods live.
//
// The second group is load-bearing. A bare stub in a concrete function
// crashes whoever calls it, and must still be reported.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ClaudeCompliance = require('../src/modules/claude-compliance');

/** True when `_looksAbstract` clears the raise on the given 1-indexed line. */
function looksAbstract(source, oneIndexedLine) {
  const lines = source.split('\n');
  return ClaudeCompliance._looksAbstract(lines, oneIndexedLine - 1, source);
}

async function stubFindings(filename, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-pystub-'));
  try {
    fs.writeFileSync(path.join(root, filename), source);
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    await new ClaudeCompliance().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed && /stub/.test(c.id));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Flask's shape, reduced: an abstract method whose docstring contains a
// python code example that itself defines a function.
const DOC_EXAMPLE = [
  'class Base:',
  '    def add_url_rule(self, rule, endpoint=None):',
  '        """Register a URL rule.',
  '',
  '        .. code-block:: python',
  '',
  '            @app.endpoint("index")',
  '            def index():',
  '                ...',
  '',
  '        Subclasses must override this.',
  '        """',
  '        raise NotImplementedError',          // line 13
  '',
].join('\n');

describe('python — an abstract method is not a stub', () => {
  it('clears a raise after a docstring containing a `def` example', () => {
    assert.strictEqual(
      looksAbstract(DOC_EXAMPLE, 13), true,
      'a `def` inside a docstring code example was mistaken for the enclosing signature',
    );
  });

  it('still clears the simple bare-body case', () => {
    const src = [
      'class Base:',
      '    def _check_setup_finished(self, f_name):',
      '        raise NotImplementedError',       // line 3
      '',
    ].join('\n');
    assert.strictEqual(looksAbstract(src, 3), true);
  });

  it('clears a method reached past a LONG docstring', () => {
    // The lookback widening. Filler is docstring prose, so the real `def` is
    // far above the raise — the common shape for a documented API.
    const filler = Array.from({ length: 90 }, (_, i) => `        line ${i} of prose`);
    const src = [
      'class Base:',
      '    def documented(self):',
      '        """Summary.',
      ...filler,
      '        """',
      '        raise NotImplementedError',
      '',
    ].join('\n');
    assert.strictEqual(
      looksAbstract(src, 95), true,
      'the enclosing def was out of reach past a long docstring',
    );
  });

  it('reports it end-to-end on the Flask shape', async () => {
    const found = await stubFindings('scaffold.py', DOC_EXAMPLE);
    assert.deepStrictEqual(found.map((f) => f.id), []);
  });
});

describe('python — a real stub is still reported', () => {
  // Without this, clearing everything would satisfy every assertion above
  // while making the rule incapable of finding an unfinished function.
  it('a bare raise in a concrete top-level function fires', async () => {
    const found = await stubFindings(
      'calc.py',
      'def compute_total(items):\n    raise NotImplementedError\n',
    );
    assert.ok(
      found.length > 0,
      'an unimplemented concrete function crashes its caller and must be reported',
    );
  });

  it('_looksAbstract says false for a concrete function', () => {
    const src = 'def compute_total(items):\n    raise NotImplementedError\n';
    assert.strictEqual(looksAbstract(src, 2), false);
  });
});

describe('python — NotImplementedError with a message is a constraint, not a stub', () => {
  // psf/requests @5460f46, src/requests/models.py:623:
  //   raise NotImplementedError("Streamed bodies and files are mutually exclusive.")
  // A deliberate API restriction that explains itself. A stub, by definition,
  // does not explain itself — so the message is the signal.
  const EXPLAINED = {
    'a plain message': 'raise NotImplementedError("Streamed bodies and files are mutually exclusive.")',
    'an f-string message': 'raise NotImplementedError(f"unsupported: {kind}")',
  };

  for (const [why, raise] of Object.entries(EXPLAINED)) {
    it(`silent: ${why}`, async () => {
      const found = await stubFindings('m.py', `def f(items):\n    ${raise}\n`);
      assert.deepStrictEqual(
        found.map((f) => f.id), [],
        'an explained NotImplementedError is a documented constraint',
      );
    });
  }

  const BARE = {
    'bare raise': 'raise NotImplementedError',
    'empty parens — still no explanation': 'raise NotImplementedError()',
  };

  for (const [why, raise] of Object.entries(BARE)) {
    it(`fires: ${why}`, async () => {
      const found = await stubFindings('m.py', `def f(items):\n    ${raise}\n`);
      assert.ok(found.length > 0, `${why} crashes the caller with no explanation`);
    });
  }
});
