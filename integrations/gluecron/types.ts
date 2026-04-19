/**
 * GateTest ↔ Gluecron v2 — shared types.
 *
 * These types describe the wire shape of Gluecron's REST v2 responses
 * (see Gluecron PR #16) and the GateTest-side adapter contract.
 * They are intentionally permissive (fields typed narrowly only where
 * GateTest needs to read them) so upstream schema churn doesn't break
 * this adapter.
 */

// ─── Canonical commit-status vocabulary ─────────────────────────────────────
// Mirrors src/core/host-bridge.js. Subset GitHub uses.
export type CommitStatusState = 'pending' | 'success' | 'failure' | 'error';

// ─── Construction options ────────────────────────────────────────────────────

export interface GluecronClientOptions {
  /** Base URL of the Gluecron deployment (e.g. https://gluecron.crontech.ai). */
  baseUrl?: string;
  /** PAT with `repo` scope. Format: `glc_<64hex>`. */
  token?: string;
  /** Per-request timeout in ms (default 30_000). */
  timeoutMs?: number;
  /** Override fetch (for tests / custom transports). */
  fetchImpl?: typeof fetch;
  /** Redact Authorization headers when emitting debug logs (default true). */
  redactAuth?: boolean;
}

export interface GluecronAdapterOptions extends GluecronClientOptions {
  /** Filesystem root for any local-clone flows (unused by HTTP-only paths). */
  projectRoot?: string;
}

// ─── HTTP primitives ────────────────────────────────────────────────────────

export interface GluecronResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  data: T;
  /** Raw text body (for non-JSON / debugging). */
  raw: string;
}

export interface GluecronErrorBody {
  error?: string;
  message?: string;
  [k: string]: unknown;
}

// ─── Repo meta (GET /api/v2/repos/:owner/:repo) ─────────────────────────────

export interface GluecronRepoMeta {
  id: number | string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  defaultBranch: string;
  owner: {
    id: number | string;
    login: string;
  };
  [k: string]: unknown;
}

// ─── Tree / contents ────────────────────────────────────────────────────────

export interface GluecronTreeEntry {
  path: string;
  type: 'blob' | 'tree' | string;
  sha: string;
  size?: number;
  mode?: string;
}

export interface GluecronTreeResponse {
  sha?: string;
  tree: GluecronTreeEntry[];
  truncated?: boolean;
}

export interface GluecronContentsBase64 {
  path: string;
  size: number;
  sha: string;
  encoding: 'base64';
  content: string;
}

export interface GluecronContentsText {
  path: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  encoding: 'utf8' | null;
}

export type GluecronContents = GluecronContentsBase64 | GluecronContentsText;

// ─── Refs / file upserts ────────────────────────────────────────────────────

export interface GluecronRefCreateResult {
  ok: true;
  ref: string;
  sha: string;
}

export interface GluecronFileUpsertResult {
  ok: true;
  commit: { sha: string; message: string };
  content: { path: string; sha: string };
}

// ─── Pull requests ──────────────────────────────────────────────────────────

export interface GluecronPullRequest {
  id: number | string;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | string;
  baseBranch: string;
  headBranch: string;
  [k: string]: unknown;
}

export interface GluecronPrComment {
  id?: number | string;
  body: string;
  [k: string]: unknown;
}

// ─── Commit / status ────────────────────────────────────────────────────────

export interface GluecronCommit {
  sha: string;
  message?: string;
  author?: { name?: string; email?: string; date?: string };
  files?: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
  [k: string]: unknown;
}

export interface GluecronCommitStatusResult {
  ok: boolean;
  state: CommitStatusState;
  context: string;
  [k: string]: unknown;
}

// ─── Auth probe ─────────────────────────────────────────────────────────────

export interface GluecronUser {
  id: number | string;
  username: string;
  email?: string;
  displayName?: string | null;
  [k: string]: unknown;
}

// ─── Adapter surface — mirrors the GitHub bridge's HostBridge contract ──────

export interface ReportSummary {
  status: 'passed' | 'failed';
  totalChecks: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  modules?: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    checks?: number;
    duration: number;
  }>;
  failures?: Array<{
    module: string;
    check: string;
    expected?: unknown;
    actual?: unknown;
    file?: string;
    line?: number;
    message?: string;
    suggestion?: string;
  }>;
}

export interface CreatePullRequestOptions {
  title: string;
  body?: string;
  /** GitHub-compat alias for headBranch. */
  head?: string;
  /** GitHub-compat alias for baseBranch. */
  base?: string;
  headBranch?: string;
  baseBranch?: string;
  draft?: boolean;
}

export interface SetCommitStatusOptions {
  context?: string;
  targetUrl?: string;
}
