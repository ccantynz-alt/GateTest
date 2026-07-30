'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchTopErrors,
  fetchErrorTraces,
  extractSourceLocation,
} = require('../website/app/lib/datadog-client');

// ─── module shape ────────────────────────────────────────────────────────────

describe('datadog-client exports', () => {
  it('exports fetchTopErrors as a function', () => {
    assert.equal(typeof fetchTopErrors, 'function');
  });

  it('exports fetchErrorTraces as a function', () => {
    assert.equal(typeof fetchErrorTraces, 'function');
  });

  it('exports extractSourceLocation as a function', () => {
    assert.equal(typeof extractSourceLocation, 'function');
  });
});

// ─── extractSourceLocation ───────────────────────────────────────────────────

describe('extractSourceLocation', () => {
  it('returns null for empty / falsy input', () => {
    assert.equal(extractSourceLocation(''), null);
    assert.equal(extractSourceLocation(null), null);
    assert.equal(extractSourceLocation(undefined), null);
  });

  it('extracts Node.js style stack frames (file:line:col)', () => {
    const stack = 'Error: bad\n    at handler (src/api/checkout.ts:42:10)';
    const loc = extractSourceLocation(stack);
    assert.equal(loc.file, 'src/api/checkout.ts');
    assert.equal(loc.line, 42);
  });

  it('extracts .js frames', () => {
    const stack = '    at handler (app/api/route.js:15:3)';
    const loc = extractSourceLocation(stack);
    assert.equal(loc.file, 'app/api/route.js');
    assert.equal(loc.line, 15);
  });

  it('extracts Python style stack frames', () => {
    const stack = '  File "src/api/route.py", line 42, in handler';
    const loc = extractSourceLocation(stack);
    assert.equal(loc.file, 'src/api/route.py');
    assert.equal(loc.line, 42);
  });

  it('returns null for plain messages with no file reference', () => {
    assert.equal(extractSourceLocation('Something went wrong'), null);
  });
});

// ─── fetchTopErrors guard ────────────────────────────────────────────────────

describe('fetchTopErrors', () => {
  it('throws when apiKey is missing', async () => {
    await assert.rejects(
      () => fetchTopErrors({ appKey: 'ak' }),
      /apiKey and appKey are required/
    );
  });

  it('throws when appKey is missing', async () => {
    await assert.rejects(
      () => fetchTopErrors({ apiKey: 'k' }),
      /apiKey and appKey are required/
    );
  });
});

// ─── fetchErrorTraces guard ──────────────────────────────────────────────────

describe('fetchErrorTraces', () => {
  it('throws when apiKey is missing', async () => {
    await assert.rejects(
      () => fetchErrorTraces({ appKey: 'ak' }),
      /apiKey and appKey are required/
    );
  });

  it('throws when appKey is missing', async () => {
    await assert.rejects(
      () => fetchErrorTraces({ apiKey: 'k' }),
      /apiKey and appKey are required/
    );
  });
});

// ─── request/response behaviour (fetch stubbed) ───────────────────────────────
//
// The two fetch* helpers are the code behind the `get_production_errors` MCP
// tool, which the MCP Debug Protocol says to call before fixing any live
// customer issue. Everything below the argument guards above — which endpoint
// is hit, whether auth headers are sent, how a response is normalised, what
// happens on a non-OK status — was previously untested.

const KEYS = { apiKey: 'dd-api', appKey: 'dd-app' };

/** Swap global.fetch for the run of `fn`, capturing every call. */
async function withFetch(responder, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return responder(calls.length);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    global.fetch = original;
  }
}

/** Minimal Response stand-in — only the members the client actually touches. */
function jsonResponse(payload, { ok = true, status = 200, text = '' } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => (text || JSON.stringify(payload)),
  };
}

describe('fetchTopErrors — request shape', () => {
  it('POSTs to the US Logs Search endpoint by default', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.datadoghq.com/api/v2/logs/events/search');
    assert.equal(calls[0].init.method, 'POST');
  });

  it('honours the site option so EU-hosted customers hit the EU endpoint', async () => {
    // Regression guard: sending an EU customer's keys to the US host 403s, and
    // the failure looks like "no errors found" rather than a misconfiguration.
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS, site: 'datadoghq.eu' })
    );
    assert.equal(calls[0].url, 'https://api.datadoghq.eu/api/v2/logs/events/search');
  });

  it('sends both Datadog auth headers', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS })
    );
    assert.equal(calls[0].init.headers['DD-API-KEY'], 'dd-api');
    assert.equal(calls[0].init.headers['DD-APPLICATION-KEY'], 'dd-app');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  });

  it('filters on status:error, and adds service: only when a service is given', async () => {
    const bare = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS })
    );
    const bareBody = JSON.parse(bare.calls[0].init.body);
    assert.equal(bareBody.filter.query, 'status:error');

    const scoped = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS, service: 'checkout-api' })
    );
    const scopedBody = JSON.parse(scoped.calls[0].init.body);
    assert.equal(scopedBody.filter.query, 'status:error service:checkout-api');
  });

  it('sends ISO-8601 timestamps spanning hoursBack, newest first', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchTopErrors({ ...KEYS, hoursBack: 6 })
    );
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.sort, '-timestamp');
    // Logs API takes ISO strings (spans take unix seconds — see below).
    assert.match(body.filter.from, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(body.filter.to, /^\d{4}-\d{2}-\d{2}T/);
    const spanMs = Date.parse(body.filter.to) - Date.parse(body.filter.from);
    assert.ok(
      Math.abs(spanMs - 6 * 3600 * 1000) < 5000,
      `expected a ~6h window, got ${spanMs}ms`
    );
  });
});

describe('fetchTopErrors — response handling', () => {
  it('normalises events and derives sourceLocation from the message', async () => {
    const payload = {
      data: [{
        id: 'evt-1',
        attributes: {
          timestamp: '2026-07-30T10:00:00Z',
          message: 'Error: boom\n    at handler (src/api/checkout.ts:42:10)',
          service: 'checkout-api',
          status: 'error',
          tags: ['env:prod', 'version:1.2.3'],
        },
      }],
    };
    const { result } = await withFetch(
      () => jsonResponse(payload),
      () => fetchTopErrors({ ...KEYS })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'evt-1');
    assert.equal(result[0].service, 'checkout-api');
    assert.equal(result[0].status, 'error');
    assert.deepEqual(result[0].tags, ['env:prod', 'version:1.2.3']);
    assert.deepEqual(result[0].sourceLocation, { file: 'src/api/checkout.ts', line: 42 });
  });

  it('survives events with no attributes at all', async () => {
    const { result } = await withFetch(
      () => jsonResponse({ data: [{ id: 'bare' }] }),
      () => fetchTopErrors({ ...KEYS })
    );
    assert.equal(result[0].id, 'bare');
    assert.deepEqual(result[0].tags, []);
    assert.equal(result[0].sourceLocation, null);
  });

  it('returns [] when the payload has no data array', async () => {
    const { result } = await withFetch(
      () => jsonResponse({}),
      () => fetchTopErrors({ ...KEYS })
    );
    assert.deepEqual(result, []);
  });

  it('throws with the status and body excerpt on a non-OK response', async () => {
    await assert.rejects(
      () => withFetch(
        () => jsonResponse({}, { ok: false, status: 403, text: 'Forbidden: bad app key' }),
        () => fetchTopErrors({ ...KEYS })
      ),
      /Datadog Logs API error 403: Forbidden: bad app key/
    );
  });
});

describe('fetchErrorTraces — request shape', () => {
  it('GETs the spans endpoint on the configured site', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchErrorTraces({ ...KEYS, site: 'datadoghq.eu' })
    );
    assert.ok(
      calls[0].url.startsWith('https://api.datadoghq.eu/api/v2/spans?'),
      `unexpected URL: ${calls[0].url}`
    );
    // No method given => fetch defaults to GET; a body would be dropped.
    assert.equal(calls[0].init.method, undefined);
    assert.equal(calls[0].init.body, undefined);
  });

  it('queries error:true and scopes by service when given', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchErrorTraces({ ...KEYS, service: 'checkout-api' })
    );
    const q = new URL(calls[0].url).searchParams;
    assert.equal(q.get('filter[query]'), 'error:true service:checkout-api');
    assert.equal(q.get('sort'), '-timestamp');
  });

  it('sends the trace window in unix SECONDS, not milliseconds', async () => {
    // The Logs call above uses ISO strings; this one uses epoch seconds. Passing
    // milliseconds here silently returns nothing (window far in the future), so
    // the unit is pinned deliberately.
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchErrorTraces({ ...KEYS, hoursBack: 6 })
    );
    const q = new URL(calls[0].url).searchParams;
    const from = Number(q.get('filter[from]'));
    const to = Number(q.get('filter[to]'));
    assert.ok(Number.isInteger(from) && Number.isInteger(to), 'expected integer timestamps');
    assert.equal(to - from, 6 * 3600);
    // Seconds-since-epoch is ~1.7e9 in 2026; milliseconds would be ~1.7e12.
    assert.ok(to < 1e11, `looks like milliseconds, not seconds: ${to}`);
  });

  it('sends both Datadog auth headers', async () => {
    const { calls } = await withFetch(
      () => jsonResponse({ data: [] }),
      () => fetchErrorTraces({ ...KEYS })
    );
    assert.equal(calls[0].init.headers['DD-API-KEY'], 'dd-api');
    assert.equal(calls[0].init.headers['DD-APPLICATION-KEY'], 'dd-app');
  });
});

describe('fetchErrorTraces — response handling', () => {
  it('normalises spans and reads sourceLocation from meta["error.stack"]', async () => {
    const payload = {
      data: [{
        id: 'span-1',
        attributes: {
          service: 'checkout-api',
          name: 'http.request',
          resource: 'POST /api/checkout',
          error: 1,
          duration: 1234567,
          meta: { 'error.stack': '  File "src/api/route.py", line 88, in charge' },
        },
      }],
    };
    const { result } = await withFetch(
      () => jsonResponse(payload),
      () => fetchErrorTraces({ ...KEYS })
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'span-1');
    assert.equal(result[0].operationName, 'http.request');
    assert.equal(result[0].resource, 'POST /api/checkout');
    assert.equal(result[0].error, 1);
    assert.equal(result[0].duration, 1234567);
    assert.deepEqual(result[0].sourceLocation, { file: 'src/api/route.py', line: 88 });
  });

  it('defaults meta to {} and sourceLocation to null when absent', async () => {
    const { result } = await withFetch(
      () => jsonResponse({ data: [{ id: 'bare' }] }),
      () => fetchErrorTraces({ ...KEYS })
    );
    assert.deepEqual(result[0].meta, {});
    assert.equal(result[0].sourceLocation, null);
  });

  it('returns [] when the payload has no data array', async () => {
    const { result } = await withFetch(
      () => jsonResponse({}),
      () => fetchErrorTraces({ ...KEYS })
    );
    assert.deepEqual(result, []);
  });

  it('throws with the status and body excerpt on a non-OK response', async () => {
    await assert.rejects(
      () => withFetch(
        () => jsonResponse({}, { ok: false, status: 429, text: 'Rate limit exceeded' }),
        () => fetchErrorTraces({ ...KEYS })
      ),
      /Datadog Traces API error 429: Rate limit exceeded/
    );
  });
});
