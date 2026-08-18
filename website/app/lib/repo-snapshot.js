"use strict";

/**
 * Public-repo snapshot — read a whole public GitHub repository with ONE
 * unauthenticated HTTPS request, no git-host credential involved.
 *
 * WHY THIS EXISTS (KI #100 / #101, 2026-08-18): the free-scan funnel read a
 * PUBLIC repo through `git/trees` + up to 60 Contents-API calls, every one of
 * them authenticated with the box's PAT. When that PAT went 401 the whole top
 * of the funnel died — for every repo on earth — even though nothing about a
 * public repository requires a credential to read. A credential must never be
 * a single point of failure for reading data that is public by definition.
 *
 * `https://codeload.github.com/{owner}/{repo}/tar.gz/{ref}` serves the archive
 * anonymously (it is what "Download ZIP" and `gh repo clone` fall back to),
 * is NOT metered against the 60-req/hour anonymous API budget the way
 * `api.github.com` calls are, and hands back paths AND contents together —
 * so a caller gets the ENTIRE tree in one round-trip instead of a 60-file
 * sample. Faster, more complete, and credential-free.
 *
 * Node has gzip built in (`zlib`) and tar is a 512-byte-block format simple
 * enough to read in ~40 lines, so this adds no dependency (Boss Rule #2).
 *
 * Bounded on purpose: `maxBytes` caps the compressed download, `maxFileBytes`
 * skips single huge files, `maxFiles` caps the number of text files kept, and
 * `deadlineMs` bounds wall-clock. Binary files (NUL byte in the first 8 KiB)
 * are recorded in `paths` but not in `contents`, exactly like the Contents-API
 * path which returned "" for them. When a cap is hit `truncated` is set and
 * `warning` says so — never silent partial coverage (Bible Forbidden #16).
 */

const zlib = require("node:zlib");

const DEFAULT_MAX_BYTES = 40 * 1024 * 1024; // compressed archive cap
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024; // single-file cap (matches GitHub Contents API's 1 MB)
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_DEADLINE_MS = 20_000;
const BLOCK = 512;

function tarballUrl(owner, repo, ref) {
  return `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${encodeURIComponent(ref || "HEAD")}`;
}

/** Read a NUL-terminated ASCII field from a tar header. */
function field(buf, off, len) {
  const end = buf.indexOf(0, off);
  const stop = end === -1 || end > off + len ? off + len : end;
  return buf.toString("utf8", off, stop);
}

function octal(buf, off, len) {
  const raw = field(buf, off, len).trim();
  if (!raw) return 0;
  const n = parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}

function looksBinary(buf) {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  return probe.indexOf(0) !== -1;
}

/**
 * Parse a POSIX/GNU tar buffer into { path → Buffer } for regular files.
 * Handles ustar `prefix`, GNU long names (`L`), and PAX extended headers
 * (`x`) well enough for GitHub archives, which use the latter for long paths.
 * Strips the leading `{repo}-{sha}/` component GitHub adds to every entry.
 */
function parseTar(buf, { maxFileBytes, maxFiles }) {
  const entries = new Map();
  const allPaths = [];
  let truncated = false;
  let off = 0;
  let pendingLongName = null;
  let paxPath = null;

  while (off + BLOCK <= buf.length) {
    const header = buf.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive marker
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    let name = field(header, 0, 100);
    const magic = field(header, 257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = field(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const dataStart = off + BLOCK;
    const dataEnd = dataStart + size;
    const data = buf.subarray(dataStart, Math.min(dataEnd, buf.length));
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "L") { pendingLongName = data.toString("utf8").replace(/\0+$/, ""); continue; }
    if (type === "x" || type === "g") {
      // PAX: records of the form "<len> key=value\n"
      const text = data.toString("utf8");
      const m = /(?:^|\n)\d+ path=([^\n]*)/.exec(text);
      if (m && type === "x") paxPath = m[1];
      continue;
    }
    if (pendingLongName) { name = pendingLongName; pendingLongName = null; }
    if (paxPath) { name = paxPath; paxPath = null; }
    if (type !== "0" && type !== "\0" && type !== "7") continue; // dirs, links, etc.

    // Drop the archive's top-level "{repo}-{ref}/" directory.
    const slash = name.indexOf("/");
    const rel = slash === -1 ? name : name.slice(slash + 1);
    if (!rel) continue;
    allPaths.push(rel);
    if (size > maxFileBytes) continue;
    if (looksBinary(data)) continue;
    if (entries.size >= maxFiles) { truncated = true; continue; }
    entries.set(rel, Buffer.from(data));
  }
  return { entries, allPaths, truncated };
}

/**
 * Download + parse a public repo snapshot.
 *
 * @returns {Promise<{ paths: string[], contents: Map<string,string>, truncated: boolean, warning: string|null, source: 'tarball' }>}
 * @throws Error with a caller-facing message when the archive is unavailable
 *   (private repo / no such repo → 404; upstream outage; caps exceeded).
 */
async function fetchPublicRepoSnapshot(owner, repo, ref = "HEAD", opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxFiles = DEFAULT_MAX_FILES,
    deadlineMs = DEFAULT_DEADLINE_MS,
  } = opts;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`invalid repository name ${owner}/${repo}`);
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deadlineMs);
  let res;
  try {
    res = await fetchImpl(tarballUrl(owner, repo, ref), {
      headers: { "User-Agent": "GateTest", Accept: "application/octet-stream" },
      redirect: "follow",
      signal: ac.signal,
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`public archive for ${owner}/${repo}@${ref} not found (404) — the repository is private, does not exist, or the ref is wrong`);
      }
      throw new Error(`public archive for ${owner}/${repo}@${ref} unavailable (HTTP ${res.status})`);
    }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) {
      throw new Error(`public archive for ${owner}/${repo} is ${declared} bytes compressed — over the ${maxBytes}-byte snapshot cap`);
    }
    // Stream so an oversize body without content-length is stopped early.
    const chunks = [];
    let total = 0;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          ac.abort();
          throw new Error(`public archive for ${owner}/${repo} exceeded the ${maxBytes}-byte snapshot cap`);
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const ab = await res.arrayBuffer();
      total = ab.byteLength;
      if (total > maxBytes) throw new Error(`public archive for ${owner}/${repo} exceeded the ${maxBytes}-byte snapshot cap`);
      chunks.push(Buffer.from(ab));
    }
    const gz = Buffer.concat(chunks, total);
    let tar;
    try {
      tar = zlib.gunzipSync(gz, { maxOutputLength: maxBytes * 8 });
    } catch (err) {
      throw new Error(`public archive for ${owner}/${repo} could not be decompressed (${err && err.message ? err.message : "gunzip failed"})`);
    }
    const { entries, allPaths, truncated } = parseTar(tar, { maxFileBytes, maxFiles });
    const contents = new Map();
    for (const [p, b] of entries) contents.set(p, b.toString("utf8"));
    const warning = truncated
      ? `Repository has more than ${maxFiles} text files — snapshot kept the first ${maxFiles}; scans may miss findings in the remainder.`
      : null;
    return { paths: allPaths, contents, truncated, warning, source: "tarball" };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  fetchPublicRepoSnapshot,
  parseTar,
  tarballUrl,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
};
