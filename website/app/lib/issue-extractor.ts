/**
 * Shared issue-extraction helpers for the customer scan-status page and the
 * admin Command Center.
 *
 * The extractor turns a raw module finding string (`details[]` entry) into a
 * structured `{ file, issue, line?, module }` shape that the auto-fixer at
 * `/api/scan/fix` can act on.
 *
 * Why this lives here (not inlined per-page):
 *   - Two surfaces parsed findings the same way and drifted apart.
 *   - The original regexes silently dropped 39% of findings because they:
 *       1. Required an extension on the filename (so `Dockerfile` failed).
 *       2. Anchored on the first character (so a leading `error: ` /
 *          `warning: ` prefix from the infra/security modules broke them).
 *       3. Had no path through for `package.json scripts.postinstall:` style
 *          findings where the filename is followed by a sub-key before the
 *          first `:`.
 *   - The filter `.filter((i) => i.file)` then quietly threw the unparseable
 *     ones on the floor instead of surfacing them to the customer.
 *
 * This helper:
 *   - Strips a leading severity prefix.
 *   - Recognises a curated allowlist of conventional extensionless filenames
 *     that scan-modules emit (`Dockerfile`, `Makefile`, `package.json`, etc.).
 *   - Splits on the first `:` after a recognised filename so sub-keys like
 *     `scripts.postinstall` stay attached to the issue text rather than being
 *     mistaken for the file boundary.
 *   - Returns BOTH the parsed issues AND the unparseable raw findings so the
 *     UI can honestly show "X issues need manual review" instead of dropping
 *     them on the floor.
 *
 * The helper is pure (no DOM, no React) so it tests cleanly under
 * `node:test`.
 */

export interface FixableIssue {
  file: string;
  issue: string;
  module: string;
  line?: number;
}

export interface UnparseableIssue {
  detail: string;
  module: string;
}

export interface ExtractionResult {
  fixable: FixableIssue[];
  unparseable: UnparseableIssue[];
}

export interface ModuleLike {
  name: string;
  status?: string;
  details?: string[];
}

/**
 * Conventional filenames that scan-modules emit findings against without an
 * extension, OR with a non-`.ext` shape that the original regexes wouldn't
 * recognise. Built by inspecting `website/app/lib/scan-modules/` —
 * iac.ts emits `Dockerfile:N`, supply-chain.ts emits `package.json scripts.X:`,
 * security-data.ts and infra.ts both reference `.env`/`.env.example`, etc.
 *
 * Match is case-insensitive on the basename for `Dockerfile`/`Makefile` style
 * names, exact for the dotfile family.
 */
const EXTENSIONLESS_FILENAMES = [
  // Container / infra
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "Procfile",
  "Vagrantfile",
  "Brewfile",
  "Justfile",
  "Rakefile",
  "Gemfile",
  "Berksfile",
  "Pipfile",
  "Caddyfile",
  // Common dotfiles surfaced by infra / config scans
  ".gitignore",
  ".dockerignore",
  ".eslintrc",
  ".prettierrc",
  ".babelrc",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".env",
  ".env.example",
  ".env.sample",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  // License / readme family (no extension)
  "LICENSE",
  "LICENCE",
  "COPYING",
  "NOTICE",
  "README",
  "CHANGELOG",
  "CONTRIBUTING",
  "AUTHORS",
];

/**
 * Returns true if `name` is a conventional extensionless filename emitted by
 * the scan modules. Case-insensitive for the Dockerfile/Makefile family,
 * permits `Dockerfile.dev`, `Dockerfile.prod`, etc. via the `.` suffix rule.
 */
function isKnownExtensionlessFilename(name: string): boolean {
  for (const known of EXTENSIONLESS_FILENAMES) {
    if (name === known) return true;
    // Case-insensitive for the file-style ones (`Dockerfile`, `Makefile`).
    if (!known.startsWith(".") && name.toLowerCase() === known.toLowerCase()) {
      return true;
    }
    // `Dockerfile.dev`, `.env.staging`, etc.
    if (name.startsWith(known + ".")) return true;
    if (
      !known.startsWith(".") &&
      name.toLowerCase().startsWith(known.toLowerCase() + ".")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Strip a leading severity prefix that infra.ts and friends prepend
 * (`error: `, `warning: `, `info: `). Case-insensitive, optional whitespace.
 */
function stripSeverityPrefix(detail: string): string {
  return detail.replace(/^(?:error|warning|info)\s*:\s*/i, "");
}

/**
 * Try to extract a leading filename from `text`. Returns the matched filename
 * and the remainder after the first `:` (or `—`/` - `) separator, or `null`
 * if no recognisable file is present.
 *
 * Recognises in order:
 *   1. Extensionless conventional filename (Dockerfile, package.json sub-key
 *      shape, etc.).
 *   2. Path with extension (the original `[\w./\-@+]+?\.[\w]{1,8}` shape,
 *      anchored after severity-strip).
 */
function matchLeadingFile(
  text: string
): { file: string; line?: number; rest: string } | null {
  // Pattern A: extensionless filename — `Dockerfile`, `Makefile`,
  // `package.json scripts.postinstall:`, `.env.example`, etc.
  // Match a candidate token first and then verify against the allowlist OR
  // against the with-extension shape.
  //
  // We accept these head shapes:
  //   <token>:<line>: <rest>            (e.g. Dockerfile:15: ...)
  //   <token>:<line> <rest>             (e.g. Dockerfile:15 ...)
  //   <token>: <rest>                   (e.g. Dockerfile: ...)
  //   <token> <subkey>: <rest>          (e.g. package.json scripts.postinstall: ...)
  //   <token>: <rest> with embedded `—`/`-` separator (legacy shape)
  //
  // The token character class allows path separators, dots, dashes, scopes:
  const TOKEN = /^([\w./@+\-]+)/;
  const m = TOKEN.exec(text);
  if (!m) return null;
  const candidate = m[1];

  // Has an extension? (.ts, .json, .yaml, etc.) — original behaviour.
  const hasExtension = /\.[\w]{1,8}$/.test(candidate);
  // Or a known extensionless name?
  const isKnown = isKnownExtensionlessFilename(candidate);
  if (!hasExtension && !isKnown) return null;

  // Now consume the trailing structure.
  const after = text.slice(candidate.length);

  // a) `:NN: rest`  or  `:NN  rest`
  const lineMatch = /^:(\d+)(?::\d+)?(?:\s*[-—:]\s*|\s+)(.+)$/.exec(after);
  if (lineMatch) {
    return { file: candidate, line: Number(lineMatch[1]), rest: lineMatch[2] };
  }

  // b) ` subkey.path: rest`  (e.g. "package.json scripts.postinstall: ...")
  //    The "subkey" piece is consumed back into `rest` so the customer keeps
  //    the context that says WHICH field in package.json broke.
  const subkeyMatch = /^\s+([\w.\-]+)\s*:\s*(.+)$/.exec(after);
  if (subkeyMatch && (hasExtension || isKnown)) {
    return { file: candidate, rest: `${subkeyMatch[1]}: ${subkeyMatch[2]}` };
  }

  // c) `: rest`  or  ` — rest`  or  ` - rest`
  const colonOnly = /^\s*[:—-]\s*(.+)$/.exec(after);
  if (colonOnly) {
    return { file: candidate, rest: colonOnly[1] };
  }

  return null;
}

/**
 * Extract a single fixable issue from a raw detail string. Returns `null`
 * when the detail can't be parsed — caller is responsible for surfacing
 * unparseable entries to the UI rather than dropping them.
 */
export function parseDetail(
  detail: string,
  moduleName: string
): FixableIssue | null {
  const stripped = stripSeverityPrefix(detail).trim();
  const head = matchLeadingFile(stripped);
  if (head) {
    return {
      file: head.file,
      issue: head.rest,
      module: moduleName,
      ...(head.line !== undefined ? { line: head.line } : {}),
    };
  }

  // Fallback: "missing X.json" / "no Y.yml" / "needs Z.toml" — older modules
  // emit these as advisory text. Keep the original CREATE_FILE pathway so
  // the auto-fixer can still act on them.
  const missingMatch = stripped.match(
    /(?:missing|no|needs)\s+([.\w/\-]+\.(?:md|json|yml|yaml|toml|gitignore|env|example))/i
  );
  if (missingMatch) {
    const file =
      missingMatch[1].toLowerCase() === "gitignore"
        ? ".gitignore"
        : missingMatch[1];
    return { file, issue: `CREATE_FILE: ${detail}`, module: moduleName };
  }

  return null;
}

/**
 * Walk a list of failed modules and return both the parseable issues
 * (eligible for `/api/scan/fix`) and the unparseable findings that need
 * manual review.
 *
 * `failedOnly` defaults to `true` — callers that already pre-filter to
 * failed modules can pass `false` to extract from anything in the list.
 */
export function extractIssuesFromModules(
  modules: ModuleLike[],
  options: { failedOnly?: boolean } = {}
): ExtractionResult {
  const { failedOnly = true } = options;
  const fixable: FixableIssue[] = [];
  const unparseable: UnparseableIssue[] = [];

  const targets = failedOnly
    ? modules.filter((m) => m.status === "failed")
    : modules;

  for (const m of targets) {
    const details = m.details || [];
    for (const d of details) {
      const parsed = parseDetail(d, m.name);
      if (parsed && parsed.file) {
        fixable.push(parsed);
      } else {
        unparseable.push({ detail: d, module: m.name });
      }
    }
  }

  return { fixable, unparseable };
}
