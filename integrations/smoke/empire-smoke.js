/**
 * Empire Smoke Scanner
 *
 * Runs a battery of fast smoke probes against the Crontech/Gluecron empire:
 *   - crontech.ai homepage (HTTP/2 + body keyword)
 *   - api.crontech.ai /api/health (JSON ok:true)
 *   - gluecron.crontech.ai homepage (soft-fail on 502)
 *   - gluecron.com DNS resolution (soft: NXDOMAIN -> info)
 *   - crontech.ai:443 TLS certificate expiry (warn <14d)
 *
 * All probes run in parallel with per-probe 5s timeouts. The module exports a
 * single entry point, `runEmpireSmoke`, returning a structured SmokeReport
 * suitable for dashboards, alerts, or the GateTest continuous scanner.
 *
 * The `fetch` and DNS/TLS primitives are all injectable so tests can exercise
 * the aggregation logic without touching the network.
 */

const dnsPromises = require('dns').promises;
const tls = require('tls');

const DEFAULT_TIMEOUT_MS = 5000;
const CERT_WARN_DAYS = 14;

const DEFAULT_URLS = {
  crontechHome: 'https://crontech.ai/',
  apiHealth: 'https://api.crontech.ai/api/health',
  gluecronSub: 'https://gluecron.crontech.ai/',
  gluecronApex: 'https://gluecron.com/',
  certHost: 'crontech.ai',
  certPort: 443,
};

/**
 * Run a promise-producing function with a timeout. Rejects with a labeled
 * error if the wrapped promise does not settle in time.
 */
function withTimeout(label, fn, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(fn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Wrap a probe so it always resolves to a probe result object (pass/warn/fail
 * /skip) and records latency, regardless of how the underlying work settled.
 */
async function runProbe(name, fn, timeoutMs) {
  const started = Date.now();
  try {
    const result = await withTimeout(name, fn, timeoutMs);
    return {
      name,
      status: result.status,
      latency_ms: Date.now() - started,
      detail: result.detail,
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      latency_ms: Date.now() - started,
      detail: err && err.message ? err.message : 'unknown error',
    };
  }
}

/**
 * Probe: crontech.ai homepage. Expect 200, HTTP/2, body contains "Crontech".
 */
async function probeCrontechHome(fetchFn, url) {
  const res = await fetchFn(url, { method: 'GET', redirect: 'follow' });
  if (!res || res.status !== 200) {
    return { status: 'fail', detail: `expected 200, got ${res && res.status}` };
  }

  const body = typeof res.text === 'function' ? await res.text() : '';
  const warnings = [];

  // httpVersion is non-standard but populated by several fetch shims; treat
  // missing as "unknown" rather than a hard failure.
  const httpVersion = res.httpVersion || (res.headers && typeof res.headers.get === 'function' && res.headers.get('x-http-version'));
  if (httpVersion && !/^2|^3/.test(String(httpVersion))) {
    warnings.push(`http version ${httpVersion} (expected h2/h3)`);
  }

  if (!body || !/crontech/i.test(body)) {
    return { status: 'fail', detail: 'body missing "Crontech" keyword' };
  }

  if (warnings.length > 0) {
    return { status: 'warn', detail: warnings.join('; ') };
  }
  return { status: 'pass', detail: 'home 200 + body ok' };
}

/**
 * Probe: api.crontech.ai /api/health. Expect 200 JSON with ok:true.
 */
async function probeApiHealth(fetchFn, url) {
  const res = await fetchFn(url, { method: 'GET' });
  if (!res || res.status !== 200) {
    return { status: 'fail', detail: `expected 200, got ${res && res.status}` };
  }
  let payload;
  try {
    payload = typeof res.json === 'function' ? await res.json() : null;
  } catch (err) {
    return { status: 'fail', detail: `invalid JSON: ${err.message}` };
  }
  if (!payload || payload.ok !== true) {
    return { status: 'fail', detail: 'health payload missing ok:true' };
  }
  return { status: 'pass', detail: 'health ok:true' };
}

/**
 * Probe: gluecron.crontech.ai. 200 = pass, 502 = warn (Caddy up but service
 * unhealthy), anything else = fail.
 */
async function probeGluecronSub(fetchFn, url) {
  const res = await fetchFn(url, { method: 'GET', redirect: 'follow' });
  if (!res) {
    return { status: 'fail', detail: 'no response' };
  }
  if (res.status === 200) {
    return { status: 'pass', detail: 'subdomain 200' };
  }
  if (res.status === 502) {
    return { status: 'warn', detail: 'service down but Caddy up' };
  }
  return { status: 'fail', detail: `unexpected status ${res.status}` };
}

/**
 * Probe: gluecron.com apex. NXDOMAIN (DNS not yet configured) downgrades to
 * a "skip" with an info-level detail; other failures are hard fails.
 */
async function probeGluecronApex(fetchFn, resolveFn, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { status: 'fail', detail: `invalid url ${url}` };
  }

  try {
    await resolveFn(host);
  } catch (err) {
    if (err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')) {
      return { status: 'skip', detail: 'DNS not yet configured' };
    }
    return { status: 'fail', detail: `dns error: ${err && err.message}` };
  }

  const res = await fetchFn(url, { method: 'GET', redirect: 'follow' });
  if (res && res.status === 200) {
    return { status: 'pass', detail: 'apex 200' };
  }
  return { status: 'fail', detail: `apex status ${res && res.status}` };
}

/**
 * Probe: TLS certificate for host:port. Warn if notAfter is within
 * CERT_WARN_DAYS.
 */
async function probeCert(tlsConnectFn, host, port) {
  const cert = await tlsConnectFn(host, port);
  if (!cert || !cert.valid_to) {
    return { status: 'fail', detail: 'no cert presented' };
  }
  const notAfter = new Date(cert.valid_to);
  if (Number.isNaN(notAfter.getTime())) {
    return { status: 'fail', detail: `unparseable notAfter: ${cert.valid_to}` };
  }
  const msLeft = notAfter.getTime() - Date.now();
  const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000));
  if (daysLeft < 0) {
    return { status: 'fail', detail: `cert expired ${-daysLeft}d ago` };
  }
  if (daysLeft < CERT_WARN_DAYS) {
    return { status: 'warn', detail: `cert expires in ${daysLeft}d` };
  }
  return { status: 'pass', detail: `cert valid ${daysLeft}d` };
}

/**
 * Default TLS probe — opens a TLS socket and returns the peer certificate.
 */
function defaultTlsConnect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: true },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      }
    );
    socket.once('error', (err) => reject(err));
  });
}

/**
 * Roll up per-probe statuses into an overall empire status.
 *   - any fail     -> red
 *   - any warn     -> yellow
 *   - otherwise    -> green   (skips do not degrade status)
 */
function rollup(probes) {
  if (probes.some((p) => p.status === 'fail')) return 'red';
  if (probes.some((p) => p.status === 'warn')) return 'yellow';
  return 'green';
}

/**
 * Render a compact human-readable markdown summary table.
 */
function renderMarkdown(status, timestamp, probes) {
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
  const lines = [
    `### Empire Smoke: ${status.toUpperCase()} (${timestamp})`,
    '',
    '| Probe | Status | Latency | Detail |',
    '| --- | --- | --- | --- |',
  ];
  for (const p of probes) {
    const detail = (p.detail || '').replace(/\|/g, '\\|');
    lines.push(`| ${p.name} | ${icon[p.status] || p.status} | ${p.latency_ms}ms | ${detail} |`);
  }
  return lines.join('\n');
}

/**
 * Run all empire smoke probes in parallel.
 *
 * @param {object} [opts]
 * @param {object} [opts.urls] Override target URLs/host (see DEFAULT_URLS).
 * @param {Function} [opts.fetch] Fetch implementation (defaults to global fetch).
 * @param {Function} [opts.resolve] DNS resolve (defaults to dns.promises.resolve).
 * @param {Function} [opts.tlsConnect] TLS cert fetcher (defaults to tls.connect).
 * @param {number} [opts.timeoutMs] Per-probe timeout (default 5000).
 * @returns {Promise<{status:string, timestamp:string, probes:Array, markdown:string}>}
 */
async function runEmpireSmoke(opts = {}) {
  const urls = Object.assign({}, DEFAULT_URLS, opts.urls || {});
  const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  const resolveFn = opts.resolve || ((host) => dnsPromises.resolve(host));
  const tlsConnectFn = opts.tlsConnect || defaultTlsConnect;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  if (!fetchFn) {
    throw new Error('runEmpireSmoke: no fetch implementation available (Node <18?). Pass opts.fetch.');
  }

  const timestamp = new Date().toISOString();

  const probes = await Promise.all([
    runProbe('crontech-home', () => probeCrontechHome(fetchFn, urls.crontechHome), timeoutMs),
    runProbe('api-health', () => probeApiHealth(fetchFn, urls.apiHealth), timeoutMs),
    runProbe('gluecron-sub', () => probeGluecronSub(fetchFn, urls.gluecronSub), timeoutMs),
    runProbe('gluecron-apex', () => probeGluecronApex(fetchFn, resolveFn, urls.gluecronApex), timeoutMs),
    runProbe('cert-crontech', () => probeCert(tlsConnectFn, urls.certHost, urls.certPort), timeoutMs),
  ]);

  const status = rollup(probes);
  const markdown = renderMarkdown(status, timestamp, probes);

  return { status, timestamp, probes, markdown };
}

module.exports = {
  runEmpireSmoke,
  // exported for tests / downstream composition
  DEFAULT_URLS,
  rollup,
  renderMarkdown,
  probeCrontechHome,
  probeApiHealth,
  probeGluecronSub,
  probeGluecronApex,
  probeCert,
};
