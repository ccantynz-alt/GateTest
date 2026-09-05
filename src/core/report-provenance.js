'use strict';

/**
 * Report provenance — what produced this report, over what, and a way to
 * prove it has not been edited since.
 *
 * The Fifty, move 21. An enterprise auditor's first questions about a scan
 * report are not about the findings: which engine version, which modules
 * actually ran, what was skipped or deferred, what was suppressed, and can
 * the file be trusted as-is. Until 2026-09-05 the JSON report answered
 * "version" and nothing else.
 *
 * Two parts, both derived, neither typed:
 *   provenance — engine, runtime, module coverage, gate settings, and a
 *                SHA-256 digest of the canonical finding set (the same
 *                fingerprint the determinism gate uses, so "same digest"
 *                means "same findings").
 *   signature  — HMAC-SHA256 over the canonical provenance + digest, keyed
 *                by GATETEST_REPORT_SIGNING_KEY when set. Absent the key the
 *                report says so, rather than carrying a decorative field.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PKG_VERSION = require('../../package.json').version;

/**
 * The canonical identity of every failing check in a run — order-independent
 * and free of anything allowed to differ between two runs of the same tree
 * (timestamps, durations). Shared with scripts/determinism-check.js.
 * @param {Array<{module:string, checks?:Array}>} results
 * @returns {string[]}
 */
function fingerprintFindings(results) {
  const out = [];
  for (const m of results || []) {
    for (const c of m.checks || []) {
      if (!c || c.passed) continue;
      out.push([
        m.module,
        c.name,
        c.file || '',
        c.line || '',
        c.severity || '',
        typeof c.confidence === 'number' ? c.confidence.toFixed(4) : '',
        c.suppressed ? 'suppressed' : '',
        String(c.message || '').slice(0, 200),
      ].join('|'));
    }
  }
  return out.sort();
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** JSON with keys sorted at every level, so the same object always signs the same. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * @param {object} summary        the runner's suite:end summary
 * @param {{projectRoot?:string, env?:NodeJS.ProcessEnv}} [opts]
 */
function buildProvenance(summary, opts = {}) {
  const env = opts.env || process.env;
  const results = Array.isArray(summary.results) ? summary.results : [];
  const ran = results.filter((r) => r && r.status !== 'skipped').map((r) => r.module);
  const skipped = results.filter((r) => r && r.status === 'skipped').map((r) => r.module);
  const deferred = (summary.deferred || []).map((d) => ({ module: d.module, reason: d.reason || null, runsIn: d.runsIn || null }));

  let ignoreFile = null;
  if (opts.projectRoot) {
    const p = path.join(opts.projectRoot, '.gatetestignore');
    if (fs.existsSync(p)) {
      try { ignoreFile = { present: true, sha256: sha256(fs.readFileSync(p, 'utf8')) }; } catch { ignoreFile = { present: true, sha256: null }; }
    } else {
      ignoreFile = { present: false, sha256: null };
    }
  }

  const fingerprints = fingerprintFindings(results);
  return {
    engine: {
      name: 'gatetest',
      version: PKG_VERSION,
      // A git checkout knows its commit; an npm install does not. Only a
      // value the build stamped is trustworthy, so it is env-only.
      commit: env.GATETEST_BUILD_COMMIT || env.GIT_COMMIT || null,
    },
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}` },
    timestamp: summary.timestamp || null,
    gateStatus: summary.gateStatus || null,
    confidenceThreshold: typeof summary.confidenceThreshold === 'number' ? summary.confidenceThreshold : null,
    scope: {
      diffOnly: summary.diffOnly === true,
      changedFiles: Array.isArray(summary.changedFiles) ? summary.changedFiles.length : null,
      baseline: summary.baseline || null,
    },
    modules: { ran, skipped, deferred },
    suppression: { ignoreFile, suppressedRules: summary.suppressedRules || null },
    findings: { count: fingerprints.length, sha256: sha256(fingerprints.join('\n')) },
  };
}

/**
 * HMAC-SHA256 over the canonical provenance. `keyId` lets a verifier pick
 * the right key without the key ever appearing in the report.
 * @param {object} provenance
 * @param {string} key
 */
function signProvenance(provenance, key) {
  const canonical = canonicalJson(provenance);
  return {
    algorithm: 'HMAC-SHA256',
    keyId: sha256(key).slice(0, 12),
    signature: crypto.createHmac('sha256', key).update(canonical).digest('hex'),
  };
}

/**
 * Sign when a key is present; otherwise say plainly that the report is
 * unsigned and why. A missing field would read as "signing is not a thing".
 */
function signatureFor(provenance, env = process.env) {
  const key = env.GATETEST_REPORT_SIGNING_KEY;
  if (typeof key === 'string' && key.length >= 16) return signProvenance(provenance, key);
  return {
    algorithm: null,
    keyId: null,
    signature: null,
    unsigned: 'GATETEST_REPORT_SIGNING_KEY not set (or shorter than 16 characters)',
  };
}

/**
 * Verify a report: the signature must match the provenance under `key`,
 * and the provenance's findings digest must match the findings actually in
 * the file — so neither block can be edited without the other noticing.
 * @param {object} report  a parsed gatetest-report JSON
 * @param {string} key
 * @returns {{ok:boolean, reason:string}}
 */
function verifyReport(report, key) {
  if (!report || !report.provenance) return { ok: false, reason: 'report has no provenance block' };
  if (!report.signature || !report.signature.signature) return { ok: false, reason: 'report is unsigned' };
  const expected = signProvenance(report.provenance, key);
  if (expected.keyId !== report.signature.keyId) return { ok: false, reason: `signed with a different key (keyId ${report.signature.keyId})` };
  const a = Buffer.from(expected.signature, 'hex');
  const b = Buffer.from(String(report.signature.signature), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature does not match the provenance — the provenance block was edited' };
  const digest = sha256(fingerprintFindings(report.results).join('\n'));
  if (digest !== report.provenance.findings.sha256) return { ok: false, reason: 'findings digest does not match the results — the findings were edited' };
  return { ok: true, reason: 'signature and findings digest verified' };
}

module.exports = { fingerprintFindings, buildProvenance, signProvenance, signatureFor, verifyReport, canonicalJson };
