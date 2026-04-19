/**
 * GateTest ↔ Gluecron — adapter implementing the same public API that
 * the existing GitHub adapter (src/core/github-bridge.js) exposes.
 *
 * Public surface mirrors the `HostBridge` contract:
 *
 *   verifyAuth(), healthCheck(), getAccessStatus()
 *   getDefaultBranch(owner, repo)
 *   createBranch(owner, repo, name, baseSha)
 *   getPullRequest / createPullRequest / addPrComment
 *   setCommitStatus / getCommit
 *   listRepoFiles(owner, repo, ref)       — recursive tree
 *   readFile(owner, repo, path, ref)      — base64 decode to Uint8Array
 *   writeFile(owner, repo, path, opts)    — create/update via PUT /contents
 *   postGateResult, reportResults         — host-agnostic report helpers
 *
 * The adapter is a thin object — all HTTP lives in {@link GluecronClient}.
 */

import {
  GluecronApiError,
  GluecronClient,
  redactHeaders,
} from './client';
import type {
  CommitStatusState,
  CreatePullRequestOptions,
  GluecronAdapterOptions,
  GluecronCommit,
  GluecronCommitStatusResult,
  GluecronPrComment,
  GluecronPullRequest,
  GluecronRefCreateResult,
  GluecronRepoMeta,
  GluecronTreeResponse,
  GluecronUser,
  ReportSummary,
  SetCommitStatusOptions,
} from './types';

const MARKDOWN_FOOTER_VERSION = 'v1.5.0';
const CANONICAL_COMMIT_STATES: readonly CommitStatusState[] = [
  'pending',
  'success',
  'failure',
  'error',
];

export interface DefaultBranchInfo {
  name: string;
  sha: string | null;
}

export interface ReadFileResult {
  path: string;
  sha: string;
  size: number;
  /** Raw bytes (base64-decoded). */
  bytes: Uint8Array;
  /** Convenience text view; lossy for binary blobs. */
  text: string;
}

export interface WriteFileOptions {
  branch: string;
  message: string;
  /** Raw content — bytes or utf-8 string. Encoded to base64 on the wire. */
  content: string | Uint8Array | Buffer;
  /** Prior blob SHA for optimistic concurrency when updating. */
  sha?: string | null;
}

export class GluecronAdapter {
  static readonly hostName = 'gluecron';
  readonly hostName = GluecronAdapter.hostName;
  readonly client: GluecronClient;
  readonly projectRoot: string;

  constructor(options: GluecronAdapterOptions = {}) {
    this.client = new GluecronClient(options);
    this.projectRoot = options.projectRoot ?? process.cwd();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Identity / health
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Verify the configured PAT. Returns the authenticated user or throws.
   */
  async verifyAuth(): Promise<GluecronUser> {
    if (!this.client.token) {
      throw new Error(
        '[GateTest] No Gluecron token configured. Set GLUECRON_TOKEN ' +
          '(PAT, scope: repo).',
      );
    }
    const res = await this.client.getAuthenticatedUser();
    return res.data;
  }

  /**
   * Ping the public `/api/hooks/ping` endpoint AND (if a token is
   * configured) probe `/api/v2/user` for auth. Never throws.
   */
  async healthCheck(): Promise<{
    available: boolean;
    authenticated: boolean;
    latencyMs: number;
    statusCode?: number;
    authError?: string;
    error?: string;
  }> {
    const started = Date.now();
    try {
      const ping = await this.client.ping();
      let authenticated = false;
      let authError: string | undefined;
      if (this.client.token) {
        try {
          const user = await this.client.getAuthenticatedUser();
          authenticated = user.statusCode === 200;
          if (!authenticated) authError = `auth probe returned HTTP ${user.statusCode}`;
        } catch (err) {
          authError = (err as Error).message;
        }
      }
      return {
        available: ping.statusCode === 200,
        authenticated,
        latencyMs: Date.now() - started,
        statusCode: ping.statusCode,
        authError,
      };
    } catch (err) {
      return {
        available: false,
        authenticated: false,
        latencyMs: Date.now() - started,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Diagnostic snapshot mirroring GitHubBridge.getAccessStatus().
   */
  getAccessStatus(): { host: string; baseUrl: string; authorized: boolean } {
    return {
      host: this.hostName,
      baseUrl: this.client.baseUrl,
      authorized: Boolean(this.client.token),
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Repo operations
  // ────────────────────────────────────────────────────────────────────────

  /** Returns `{ name, sha }` of the default branch tip. */
  async getDefaultBranch(owner: string, repo: string): Promise<DefaultBranchInfo> {
    const meta = (await this.client.getRepo(owner, repo)).data as GluecronRepoMeta & {
      default_branch?: string;
    };
    const name = meta.defaultBranch ?? meta.default_branch;
    if (!name) {
      throw new Error(`[GateTest] Gluecron repo ${owner}/${repo} did not return a default branch`);
    }
    const treeRes = await this.client.getTreeRecursive(owner, repo, name);
    const tree = treeRes.data;
    const sha = tree.sha ?? tree.tree?.[0]?.sha ?? null;
    return { name, sha };
  }

  /** Create a branch pointing at `baseSha`. */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
  ): Promise<GluecronRefCreateResult> {
    const res = await this.client.createRef(
      owner,
      repo,
      `refs/heads/${branchName}`,
      baseSha,
    );
    return res.data;
  }

  /** Recursive tree listing (cap 50k enforced server-side). */
  async listRepoFiles(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<GluecronTreeResponse> {
    const res = await this.client.getTreeRecursive(owner, repo, ref);
    return res.data;
  }

  /** Read a file — bytes + utf8 view + sha. */
  async readFile(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ): Promise<ReadFileResult> {
    const res = await this.client.getFileBase64(owner, repo, filePath, ref);
    const data = res.data;
    const bytes = base64Decode(data.content);
    return {
      path: data.path,
      sha: data.sha,
      size: data.size,
      bytes,
      text: bytesToString(bytes),
    };
  }

  /**
   * Create or update a file on `branch`. Content is base64-encoded on the
   * wire. Pass `sha` when updating for optimistic concurrency.
   */
  async writeFile(
    owner: string,
    repo: string,
    filePath: string,
    options: WriteFileOptions,
  ): Promise<{ commitSha: string; blobSha: string }> {
    const contentBase64 = toBase64(options.content);
    const res = await this.client.upsertFile(owner, repo, filePath, {
      branch: options.branch,
      message: options.message,
      contentBase64,
      sha: options.sha ?? null,
    });
    return {
      commitSha: res.data.commit.sha,
      blobSha: res.data.content.sha,
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pull requests
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Open a PR. Accepts both the GitHub-style (`head`/`base`) and Gluecron
   * native (`headBranch`/`baseBranch`) option shapes.
   */
  async createPullRequest(
    owner: string,
    repo: string,
    options: CreatePullRequestOptions,
  ): Promise<GluecronPullRequest> {
    const headBranch = options.headBranch ?? options.head;
    const baseBranch = options.baseBranch ?? options.base;
    if (!headBranch || !baseBranch) {
      throw new Error(
        '[GateTest] createPullRequest requires both head/headBranch and base/baseBranch',
      );
    }
    const res = await this.client.createPullRequest(owner, repo, {
      title: options.title,
      body: options.body ?? '',
      headBranch,
      baseBranch,
    });
    return res.data;
  }

  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GluecronPullRequest> {
    const res = await this.client.getPullRequest(owner, repo, prNumber);
    return res.data;
  }

  /** Post a comment on a PR. Equivalent to GitHub's `issues/:n/comments`. */
  async addPrComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<GluecronPrComment> {
    const res = await this.client.addPullRequestComment(owner, repo, prNumber, body);
    return res.data.comment;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Commits & statuses
  // ────────────────────────────────────────────────────────────────────────

  async getCommit(owner: string, repo: string, sha: string): Promise<GluecronCommit> {
    const res = await this.client.getCommit(owner, repo, sha);
    return res.data;
  }

  async setCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    state: CommitStatusState,
    description: string,
    options: SetCommitStatusOptions = {},
  ): Promise<GluecronCommitStatusResult> {
    this._validateCommitState(state);
    const res = await this.client.setCommitStatus(owner, repo, sha, {
      state,
      description,
      context: options.context,
      targetUrl: options.targetUrl,
    });
    return res.data;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Reporting — host-agnostic helpers, copied from HostBridge shape so the
  // TS adapter is self-sufficient.
  // ────────────────────────────────────────────────────────────────────────

  async postGateResult(
    owner: string,
    repo: string,
    prNumber: number,
    summary: ReportSummary,
  ): Promise<GluecronPrComment> {
    const body = this._formatGateResultMarkdown(summary);
    return this.addPrComment(owner, repo, prNumber, body);
  }

  async reportResults(
    owner: string,
    repo: string,
    prNumber: number,
    sha: string,
    summary: ReportSummary,
  ): Promise<{ status: GluecronCommitStatusResult; comment: GluecronPrComment }> {
    const state: CommitStatusState = summary.status === 'passed' ? 'success' : 'failure';
    const description =
      summary.status === 'passed'
        ? `All ${summary.totalChecks} checks passed`
        : `${summary.failed} of ${summary.totalChecks} checks failed`;

    const [status, comment] = await Promise.all([
      this.setCommitStatus(owner, repo, sha, state, description),
      this.postGateResult(owner, repo, prNumber, summary),
    ]);
    return { status, comment };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────────────────

  /** Used by tests — verifies canonical state vocabulary. */
  _validateCommitState(state: string): void {
    if (!CANONICAL_COMMIT_STATES.includes(state as CommitStatusState)) {
      throw new Error(
        `[HostBridge] Invalid commit status state "${state}". ` +
          `Must be one of: ${CANONICAL_COMMIT_STATES.join(', ')}`,
      );
    }
  }

  _formatGateResultMarkdown(summary: ReportSummary): string {
    const icon = summary.status === 'passed' ? ':white_check_mark:' : ':x:';
    const title =
      summary.status === 'passed'
        ? 'GateTest Quality Gate — PASSED'
        : 'GateTest Quality Gate — FAILED';
    const duration =
      summary.duration >= 1000
        ? `${(summary.duration / 1000).toFixed(1)}s`
        : `${summary.duration}ms`;

    const lines: string[] = [];
    lines.push(`## ${icon} ${title}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| **Total Checks** | ${summary.totalChecks} |`);
    lines.push(`| **Passed** | ${summary.passed} |`);
    lines.push(`| **Failed** | ${summary.failed} |`);
    lines.push(`| **Skipped** | ${summary.skipped} |`);
    lines.push(`| **Duration** | ${duration} |`);
    lines.push('');

    if (summary.modules && summary.modules.length > 0) {
      lines.push('### Module Results');
      lines.push('');
      lines.push('| Module | Status | Checks | Duration |');
      lines.push('|--------|--------|--------|----------|');
      for (const mod of summary.modules) {
        const modIcon =
          mod.status === 'passed'
            ? ':white_check_mark:'
            : mod.status === 'failed'
              ? ':x:'
              : ':fast_forward:';
        const modDuration =
          mod.duration >= 1000
            ? `${(mod.duration / 1000).toFixed(1)}s`
            : `${mod.duration}ms`;
        const checkCount = mod.checks !== undefined ? mod.checks : '-';
        lines.push(`| ${modIcon} ${mod.name} | ${mod.status} | ${checkCount} | ${modDuration} |`);
      }
      lines.push('');
    }

    if (summary.failures && summary.failures.length > 0) {
      lines.push('### Failures');
      lines.push('');
      for (const failure of summary.failures) {
        lines.push(`<details>`);
        lines.push(`<summary><b>${failure.module}</b>: ${failure.check}</summary>`);
        lines.push('');
        if (failure.expected !== undefined && failure.actual !== undefined) {
          lines.push(`- **Expected:** ${failure.expected}`);
          lines.push(`- **Actual:** ${failure.actual}`);
        }
        if (failure.file) {
          lines.push(
            `- **File:** \`${failure.file}\`${failure.line ? `:${failure.line}` : ''}`,
          );
        }
        if (failure.message) lines.push(`- **Details:** ${failure.message}`);
        if (failure.suggestion) lines.push(`- **Suggested fix:** ${failure.suggestion}`);
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }

    lines.push('---');
    lines.push(
      `<sub>Generated by <b>GateTest ${MARKDOWN_FOOTER_VERSION}</b> at ${new Date().toISOString()}</sub>`,
    );
    return lines.join('\n');
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Detect whether the current environment wants the Gluecron adapter.
 *
 * Priority:
 *   1. Explicit arg `gitHost` (from a caller)
 *   2. `GIT_HOST=gluecron` env var
 *   3. Presence of `GLUECRON_TOKEN`/`GLUECRON_API_TOKEN` + `GLUECRON_API_URL`
 *      signalling Gluecron intent.
 *   4. A Gluecron repo URL — e.g. `https://gluecron.com/<owner>/<repo>`.
 */
export function shouldUseGluecron(opts?: { gitHost?: string; repoUrl?: string }): boolean {
  const host = (opts?.gitHost ?? process.env.GIT_HOST ?? '').toLowerCase();
  if (host === 'gluecron') return true;
  if (host === 'github') return false;
  if (opts?.repoUrl && /(^|\.)gluecron\./i.test(opts.repoUrl)) return true;
  return false;
}

/** Convenience factory — respects env-driven selection. */
export function createGluecronAdapter(options: GluecronAdapterOptions = {}): GluecronAdapter {
  return new GluecronAdapter(options);
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { GluecronClient, GluecronApiError, redactHeaders };
export type {
  CommitStatusState,
  CreatePullRequestOptions,
  GluecronAdapterOptions,
  GluecronCommit,
  GluecronCommitStatusResult,
  GluecronPrComment,
  GluecronPullRequest,
  GluecronRefCreateResult,
  GluecronRepoMeta,
  GluecronTreeResponse,
  GluecronUser,
  ReportSummary,
  SetCommitStatusOptions,
} from './types';

// ─── Base64 / text helpers (isomorphic) ─────────────────────────────────────

function base64Decode(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64(content: string | Uint8Array | Buffer): string {
  if (typeof Buffer !== 'undefined') {
    if (typeof content === 'string') return Buffer.from(content, 'utf-8').toString('base64');
    return Buffer.from(content as Uint8Array).toString('base64');
  }
  if (typeof content === 'string') {
    return btoa(unescape(encodeURIComponent(content)));
  }
  let binary = '';
  const bytes = content as Uint8Array;
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesToString(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf-8');
  }
  return new TextDecoder('utf-8').decode(bytes);
}
