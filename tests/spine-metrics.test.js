/**
 * Spine metrics — structural health maths.
 *
 * Every assertion here runs against a hand-built graph with a known answer,
 * because a wrong number computed over a real filesystem walk looks entirely
 * plausible. Three of these tests exist specifically because the first version
 * of this module got them wrong on the real repo:
 *
 *   - test files inflated fan-in, so an entrypoint imported only by its own 8
 *     tests was reported as a "god file";
 *   - percentiles taken over all files (689 of 1193 having zero fan-in) put p90
 *     at 2, so a file with four dependents qualified as a hub;
 *   - the "untested" signal fired for every load-bearing file when the scan
 *     scope excluded tests/, including one that has had a test all along.
 *
 * NEGATIVE CONTROLS: several tests assert a rule DOES fire on a graph built to
 * trip it. Without them, tightening a threshold until the repo is quiet would
 * look identical to the rule working — the failure mode KI #77 called out as an
 * unfalsifiable assertion.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  percentile, degrees, reachableFrom, findLayerViolations, computeSpineMetrics,
  MIN_NODES_FOR_ANALYSIS,
} = require('../src/core/spine-metrics');

const rel = (p) => p.replace(/^\/p\//, '');

/** Build a graph from a { 'a.js': ['b.js'] } spec, plus matching edge records. */
function mk(spec) {
  const graph = new Map();
  const edges = [];
  const abs = (f) => `/p/${f}`;
  for (const f of Object.keys(spec)) graph.set(abs(f), new Set());
  for (const [f, tos] of Object.entries(spec)) {
    for (const t of tos) {
      if (!graph.has(abs(t))) graph.set(abs(t), new Set());
      graph.get(abs(f)).add(abs(t));
      edges.push({ from: abs(f), to: abs(t), kind: 'static', line: 1 });
    }
  }
  return { graph, edges };
}

/** N filler nodes so a fixture clears MIN_NODES_FOR_ANALYSIS. */
function filler(n, prefix = 'fill') {
  const spec = {};
  for (let i = 0; i < n; i += 1) spec[`${prefix}/f${i}.js`] = [];
  return spec;
}

describe('percentile', () => {
  it('is nearest-rank, inventing no values the data does not contain', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.strictEqual(percentile(v, 0.5), 5);
    assert.strictEqual(percentile(v, 0.9), 9);
    assert.strictEqual(percentile(v, 1), 10);
  });

  it('handles a single value and an empty list without throwing', () => {
    assert.strictEqual(percentile([7], 0.9), 7);
    assert.strictEqual(percentile([], 0.9), 0);
  });
});

describe('degrees', () => {
  it('counts fan-in and fan-out, ignoring edges to nodes outside the graph', () => {
    const { graph } = mk({ 'a.js': ['b.js', 'c.js'], 'b.js': ['c.js'], 'c.js': [] });
    graph.get('/p/a.js').add('/p/external.js'); // not a node — must not count
    const { fanIn, fanOut } = degrees(graph);
    assert.strictEqual(fanOut.get('/p/a.js'), 2, 'external edge must not inflate fan-out');
    assert.strictEqual(fanIn.get('/p/c.js'), 2);
    assert.strictEqual(fanIn.get('/p/a.js'), 0);
  });
});

describe('reachableFrom', () => {
  it('counts transitive reach, excluding the start node', () => {
    const { graph } = mk({ 'a.js': ['b.js'], 'b.js': ['c.js'], 'c.js': ['d.js'], 'd.js': [] });
    assert.strictEqual(reachableFrom(graph, '/p/a.js'), 3);
    assert.strictEqual(reachableFrom(graph, '/p/d.js'), 0);
  });

  it('terminates on a cycle instead of spinning forever', () => {
    const { graph } = mk({ 'a.js': ['b.js'], 'b.js': ['c.js'], 'c.js': ['a.js'] });
    assert.strictEqual(reachableFrom(graph, '/p/a.js'), 2);
  });
});

describe('findLayerViolations', () => {
  it('flags the minority-direction edge once a grain is established', () => {
    const spec = {};
    for (let i = 0; i < 6; i += 1) spec[`ui/c${i}.tsx`] = ['core/svc.js'];
    spec['core/svc.js'] = ['ui/c0.tsx']; // the back-edge
    const { edges } = mk(spec);

    const v = findLayerViolations(edges, rel);
    assert.strictEqual(v.length, 1, 'exactly the one upward edge');
    assert.strictEqual(v[0].fromDir, 'core');
    assert.strictEqual(v[0].toDir, 'ui');
    assert.strictEqual(v[0].forward, 6);
    assert.strictEqual(v[0].backward, 1);
  });

  it('stays silent on a genuinely bidirectional pair — a registry is not a violation', () => {
    // 6 each way: neither direction dominates, so no grain exists to violate.
    const spec = {};
    for (let i = 0; i < 6; i += 1) {
      spec[`a/x${i}.js`] = ['b/y.js'];
      spec[`b/z${i}.js`] = ['a/w.js'];
    }
    const { edges } = mk(spec);
    assert.deepStrictEqual(findLayerViolations(edges, rel), []);
  });

  it('stays silent below the minimum evidence threshold', () => {
    // Only 2 forward edges — not enough to call a direction "the grain".
    const { edges } = mk({ 'a/x.js': ['b/y.js'], 'a/x2.js': ['b/y.js'], 'b/y.js': ['a/x.js'] });
    assert.deepStrictEqual(findLayerViolations(edges, rel), []);
  });

  it('ignores lazy edges — a deferred require is often the fix for a layering problem', () => {
    const spec = {};
    for (let i = 0; i < 6; i += 1) spec[`ui/c${i}.tsx`] = ['core/svc.js'];
    const { edges } = mk(spec);
    edges.push({ from: '/p/core/svc.js', to: '/p/ui/c0.tsx', kind: 'lazy', line: 9 });
    assert.deepStrictEqual(findLayerViolations(edges, rel), []);
  });

  it('ignores intra-directory edges', () => {
    const spec = {};
    for (let i = 0; i < 8; i += 1) spec[`same/a${i}.js`] = ['same/b.js'];
    spec['same/b.js'] = ['same/a0.js'];
    const { edges } = mk(spec);
    assert.deepStrictEqual(findLayerViolations(edges, rel), []);
  });
});

describe('computeSpineMetrics — blast radius', () => {
  it('measures how many files a change can reach, not what the file imports', () => {
    const spec = { ...filler(20) };
    spec['core/base.js'] = [];
    for (let i = 0; i < 5; i += 1) spec[`mod/m${i}.js`] = ['core/base.js'];
    spec['app/top.js'] = ['mod/m0.js'];
    const { graph, edges } = mk(spec);

    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    const base = m.spine.find((s) => s.rel === 'core/base.js');
    // 5 direct dependents + app/top.js transitively through mod/m0.js
    assert.strictEqual(base.blast, 6);
    assert.strictEqual(base.fanIn, 5);
    assert.strictEqual(base.fanOut, 0);
  });
});

describe('computeSpineMetrics — test files are excluded from the graph', () => {
  // The regression this pins: bin/gatetest-mcp.mjs had fan-in 8, all 8 of them
  // its own test files, and was reported a god file on that basis. A test
  // importing a file is not the codebase depending on it.
  const build = () => {
    const spec = { ...filler(20) };
    spec['src/entry.js'] = [];
    for (let i = 0; i < 8; i += 1) spec[`tests/e${i}.test.js`] = ['src/entry.js'];
    return mk(spec);
  };

  it('does not let tests create fan-in', () => {
    const { graph, edges } = build();
    const m = computeSpineMetrics({
      fullGraph: graph, edges, rel,
      isTest: (abs) => /\.test\.js$/.test(abs),
    });
    assert.strictEqual(m.fanIn.get('/p/src/entry.js'), 0, 'test importers must not count');
    assert.strictEqual(m.testNodeCount, 8);
    assert.strictEqual(m.godFiles.length, 0);
  });

  it('counts them when exclusion is off — proving the exclusion is what changed the answer', () => {
    const { graph, edges } = build();
    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    assert.strictEqual(m.fanIn.get('/p/src/entry.js'), 8);
    assert.strictEqual(m.testNodeCount, 0);
  });
});

describe('computeSpineMetrics — god files (negative control)', () => {
  it('DOES fire on a real hub-and-dependent, so the rule is not dead', () => {
    const spec = { ...filler(20) };
    spec['core/god.js'] = [];
    for (let i = 0; i < 10; i += 1) {
      spec[`dep/d${i}.js`] = ['core/god.js'];       // 10 depend on it
      spec[`leaf/l${i}.js`] = [];
      spec['core/god.js'].push(`leaf/l${i}.js`);    // it depends on 10
    }
    const { graph, edges } = mk(spec);

    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    assert.strictEqual(m.godFiles.length, 1, 'the deliberately-planted god file must be found');
    assert.strictEqual(m.godFiles[0].rel, 'core/god.js');
    assert.strictEqual(m.godFiles[0].fanIn, 10);
    assert.strictEqual(m.godFiles[0].fanOut, 10);
  });

  it('does NOT fire on a file that is only a hub, or only a dependent', () => {
    const spec = { ...filler(20) };
    spec['core/hub.js'] = [];                        // high fan-in, zero fan-out
    spec['app/consumer.js'] = [];                    // high fan-out, zero fan-in
    for (let i = 0; i < 12; i += 1) {
      spec[`a/d${i}.js`] = ['core/hub.js'];
      spec[`b/l${i}.js`] = [];
      spec['app/consumer.js'].push(`b/l${i}.js`);
    }
    const { graph, edges } = mk(spec);
    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    assert.deepStrictEqual(m.godFiles.map((g) => g.rel), [],
      'being widely used, or widely using, is not on its own a god file');
  });

  it('does not report a weak hub — the four-dependent case that used to slip through', () => {
    const spec = { ...filler(30) };
    spec['src/index.js'] = [];
    for (let i = 0; i < 4; i += 1) spec[`x/c${i}.js`] = ['src/index.js'];   // fan-in 4 only
    for (let i = 0; i < 17; i += 1) {
      spec[`y/l${i}.js`] = [];
      spec['src/index.js'].push(`y/l${i}.js`);
    }
    const { graph, edges } = mk(spec);
    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    assert.deepStrictEqual(m.godFiles.map((g) => g.rel), [],
      'fan-in of 4 is not a hub, however high the fan-out');
  });
});

describe('computeSpineMetrics — unstable dependency (negative control)', () => {
  it('DOES fire when a stable module depends on a volatile one', () => {
    const spec = { ...filler(20) };
    spec['core/stable.js'] = ['churn/volatile.js'];
    spec['churn/volatile.js'] = [];
    for (let i = 0; i < 8; i += 1) spec[`u/c${i}.js`] = ['core/stable.js'];  // stable: high fan-in
    for (let i = 0; i < 6; i += 1) {
      spec[`v/l${i}.js`] = [];
      spec['churn/volatile.js'].push(`v/l${i}.js`);                          // volatile: all fan-out
    }
    const { graph, edges } = mk(spec);

    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    const hit = m.unstableDeps.find((u) => u.relFrom === 'core/stable.js');
    assert.ok(hit, 'stable -> volatile must be reported');
    assert.strictEqual(hit.relTo, 'churn/volatile.js');
    assert.ok(hit.iFrom <= 0.3, `expected stable source, got ${hit.iFrom}`);
    assert.ok(hit.iTo >= 0.7, `expected volatile target, got ${hit.iTo}`);
  });
});

describe('computeSpineMetrics — small projects', () => {
  it(`reports nothing structural below ${MIN_NODES_FOR_ANALYSIS} files`, () => {
    const spec = {};
    for (let i = 0; i < 8; i += 1) spec[`a/f${i}.js`] = ['b/hub.js'];
    spec['b/hub.js'] = ['a/f0.js'];
    const { graph, edges } = mk(spec);
    const m = computeSpineMetrics({ fullGraph: graph, edges, rel });
    assert.strictEqual(m.analysable, false);
    assert.deepStrictEqual(m.godFiles, []);
    assert.deepStrictEqual(m.layerViolations, []);
    assert.deepStrictEqual(m.unstableDeps, []);
  });
});

describe('computeSpineMetrics — budget', () => {
  it('skips blast radius rather than hanging the gate on a huge graph', () => {
    const { graph, edges } = mk(filler(30));
    const m = computeSpineMetrics({
      fullGraph: graph, edges, rel, maxNodesForBlast: 5,
    });
    assert.strictEqual(m.blastComputed, false);
    assert.deepStrictEqual(m.spine, []);
    // Degree metrics remain available — the cheap half still runs.
    assert.ok(m.fanIn instanceof Map);
  });
});
