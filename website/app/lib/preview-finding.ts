/**
 * Shaping helpers for the free preview scan (`POST /api/scan/preview`).
 *
 * These live here rather than inside the route because a Next.js `route.ts`
 * may only export HTTP handlers and route config — so anything defined there
 * is, by construction, untestable. That is precisely how the bug below
 * survived: the route carried a private, unexercised copy of a shared parser.
 *
 * THE BUG (found 2026-08-29 against live production):
 *   Every finding in the live `/api/scan/preview` response came back with
 *   `"file": null, "line": null`, with the path still glued to the front of
 *   the message:
 *
 *     { "file": null, "line": null,
 *       "message": "examples/error/index.js: contains console.log/debug/info call" }
 *
 *   Root cause: the route's private `parseDetail` required a `:<line>`
 *   segment (`path:42: msg`) before it would attribute a file. Measured
 *   across `website/app/lib/scan-modules/*.ts`: of 86 detail templates only
 *   15 emit a line number, while 57 emit `path: message` with none. So the
 *   regex structurally could not attribute the overwhelming majority of real
 *   findings, and the structured fields the API contract advertises were
 *   dead weight for every consumer (the MCP upsell pitch, any client trying
 *   to deep-link a finding).
 *
 *   Meanwhile `@/app/lib/issue-extractor` — the canonical extractor used by
 *   the scan-status page and the admin Command Center — had already solved
 *   exactly this, including extensionless names (`Dockerfile`) and the
 *   `package.json scripts.postinstall:` sub-key shape. It was fixed in one
 *   call site and not the other.
 *
 * This is the KI #77 `TEST_PATH_RE` pattern again: a shared concern
 * re-implemented per call site, then corrected in only one copy. File
 * attribution now has exactly ONE definition in the codebase.
 */

import { parseDetail as extractFile } from "./issue-extractor";

export interface PreviewFinding {
  module: string;
  severity: "error" | "warning" | "info";
  file: string | null;
  line: number | null;
  message: string;
}

/**
 * Classify a raw detail string into a display severity.
 *
 * Deliberately reads the RAW string, before any prefix is stripped — the
 * leading `error:` / `warning:` marker some modules emit is the strongest
 * signal available, and stripping it first would throw that away.
 */
export function classifySeverity(raw: string): PreviewFinding["severity"] {
  if (typeof raw !== "string") return "warning";
  if (/^(error|err|critical|high)\b[:]/i.test(raw)) return "error";
  if (/^(warning|warn|medium)\b[:]/i.test(raw)) return "warning";
  if (/^(info|note|low|summary)\b[:]/i.test(raw)) return "info";
  if (/\b(error|fail|vulnerab|exploit|injection|secret|credential|api[_\- ]?key|hardcoded)\b/i.test(raw))
    return "error";
  return "warning";
}

/**
 * Split a raw module detail into `{ module, severity, file, line, message }`.
 *
 * File/line attribution is delegated to the canonical extractor. Do NOT
 * reintroduce a local filename regex here — `tests/preview-finding.test.js`
 * has a ratchet that fails the build if one reappears.
 */
export function parseDetail(raw: string, moduleName: string): PreviewFinding {
  const safeRaw = typeof raw === "string" ? raw : String(raw ?? "");

  // Strip the prefixes the canonical extractor does not: a `[tag]` prefix and
  // the `note:` / `summary:` severities. The severity words it already strips
  // are included too, so both helpers agree on where the filename starts.
  const stripped = safeRaw
    .replace(/^(?:\[[^\]]+\]\s*|(?:error|warn(?:ing)?|info|note|summary)\s*:\s*)/i, "")
    .trim();

  const parsed = extractFile(stripped, moduleName);
  let file: string | null = null;
  let line: number | null = null;
  let message = stripped;

  if (parsed?.file) {
    file = parsed.file;
    line = typeof parsed.line === "number" ? parsed.line : null;
    // The extractor tags create-a-missing-file findings with a `CREATE_FILE:`
    // marker for the auto-fixer. That is an internal instruction, not
    // something to show a customer in a free preview.
    const issue = parsed.issue.replace(/^CREATE_FILE:\s*/, "").trim();
    if (issue) message = issue;
  }

  return {
    module: moduleName,
    severity: classifySeverity(safeRaw),
    file,
    line,
    message: message.trim(),
  };
}
