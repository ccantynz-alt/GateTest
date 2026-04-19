# GateTest ↔ Gluecron v2 bridge

This directory contains the **TypeScript adapter** that lets the GateTest
engine scan, fix, and open PRs against repositories hosted on
[Gluecron](https://gluecron.com) exactly like it already does for GitHub.

The existing Node (`.js`) bridge at
[`src/core/gluecron-bridge.js`](../../src/core/gluecron-bridge.js) covers the
CLI path; this folder provides the same surface in typed, tree-shakeable
TypeScript for anything that imports from `integrations/` (the website,
Vercel functions, serverless workers). Both share the same wire contract —
Gluecron's v2 REST API added in [Gluecron PR #16](https://github.com/ccantynz-alt/Gluecron.com/pull/16).

## Files

| File | Purpose |
| ---- | ------- |
| `client.ts`  | Low-level typed HTTP client. One class, wraps every v2 endpoint GateTest needs. Retry, timeouts, Authorization-redaction baked in. |
| `adapter.ts` | High-level adapter mirroring the GitHub bridge's public API (`verifyAuth`, `getDefaultBranch`, `createBranch`, `readFile`, `writeFile`, `createPullRequest`, `addPrComment`, `setCommitStatus`, `reportResults`, ...). |
| `types.ts`   | Shared types for wire shapes and adapter options. |
| `index.ts`   | Barrel — re-exports everything. |

## Environment variables

| Name | Required | Default | Notes |
| ---- | -------- | ------- | ----- |
| `GLUECRON_API_URL`     | No  | `https://gluecron.com` | Base URL of the Gluecron deployment. Use `https://gluecron.crontech.ai` for the Crontech-hosted staging, or your own origin if self-hosted. The legacy name `GLUECRON_BASE_URL` is also honoured for backwards-compat with the JS bridge. |
| `GLUECRON_TOKEN`       | Yes | —                      | Personal access token (scope: `repo`). Format: `glc_<64hex>`. Create at `/settings/tokens` on your Gluecron instance. The legacy `GLUECRON_API_TOKEN` is also accepted. |
| `GIT_HOST`             | No  | unset                  | Set to `gluecron` to force the adapter registry to pick this bridge over the GitHub one. When unset, selection falls back to URL sniffing (see below). |

Tokens are never logged — the client redacts the `Authorization` header
(plus any `Cookie` / `X-*-Token` header) before emitting any debug object.
See `redactHeaders` in `client.ts`.

## Quick start

```ts
import { GluecronAdapter } from 'gatetest/integrations/gluecron';

const bridge = new GluecronAdapter({
  // Both pulled from env when omitted.
  baseUrl: process.env.GLUECRON_API_URL,
  token:   process.env.GLUECRON_TOKEN,
});

// 1. Confirm auth before spending compute on a paid scan.
const me = await bridge.verifyAuth();

// 2. Resolve default branch + tip SHA.
const { name: base, sha: baseSha } = await bridge.getDefaultBranch('ccantynz-alt', 'Gluecron.com');

// 3. Walk the tree.
const { tree } = await bridge.listRepoFiles('ccantynz-alt', 'Gluecron.com', base);

// 4. Read a file.
const file = await bridge.readFile('ccantynz-alt', 'Gluecron.com', 'package.json', base);

// 5. Fork-and-fix workflow: branch → write → PR → comment → status.
await bridge.createBranch('ccantynz-alt', 'Gluecron.com', 'gatetest/auto-fix-123', baseSha!);
await bridge.writeFile('ccantynz-alt', 'Gluecron.com', 'package.json', {
  branch:  'gatetest/auto-fix-123',
  message: 'fix(deps): bump foo',
  content: newFileBytes,
  sha:     file.sha,            // optimistic concurrency
});
const pr = await bridge.createPullRequest('ccantynz-alt', 'Gluecron.com', {
  title: 'GateTest: fix dep',
  body:  'Auto-fix applied by GateTest',
  head:  'gatetest/auto-fix-123', // accepts `head` alias for GitHub-compat
  base,
});
await bridge.addPrComment('ccantynz-alt', 'Gluecron.com', pr.number, 'Scanning…');
await bridge.setCommitStatus('ccantynz-alt', 'Gluecron.com', baseSha!, 'success', 'All checks passed');
```

## Endpoint map (Gluecron v2)

| Adapter method | Gluecron v2 endpoint |
| -------------- | -------------------- |
| `verifyAuth()`             | `GET  /api/v2/user` |
| `getDefaultBranch()`       | `GET  /api/v2/repos/:owner/:repo` (reads `defaultBranch` + `owner.login`) then `GET /api/v2/repos/:owner/:repo/tree/:ref?recursive=1` for the tip sha |
| `listRepoFiles(ref)`       | `GET  /api/v2/repos/:owner/:repo/tree/:ref?recursive=1` (server caps at 50 k entries) |
| `readFile(path, ref)`      | `GET  /api/v2/repos/:owner/:repo/contents/:path?encoding=base64` |
| `createBranch(name, sha)`  | `POST /api/v2/repos/:owner/:repo/git/refs` with body `{ ref: "refs/heads/<name>", sha }` |
| `writeFile(path, opts)`    | `PUT  /api/v2/repos/:owner/:repo/contents/:path` with `{ branch, message, content (base64), sha? }` |
| `createPullRequest()`      | `POST /api/v2/repos/:owner/:repo/pulls` with `{ title, body, headBranch, baseBranch }` (GitHub-style `head`/`base` aliases accepted) |
| `getPullRequest(n)`        | `GET  /api/v2/repos/:owner/:repo/pulls/:number` |
| `addPrComment(n, body)`    | `POST /api/v2/repos/:owner/:repo/pulls/:number/comments` |
| `setCommitStatus(sha,...)` | `POST /api/v2/repos/:owner/:repo/statuses/:sha` (v2 alias added in PR #16) |
| `getCommit(sha)`           | `GET  /api/v2/repos/:owner/:repo/commits/:sha` |

All calls authenticate with `Authorization: Bearer <GLUECRON_TOKEN>`.

## How it picks between GitHub & Gluecron

Use the `shouldUseGluecron` helper, or wire it into your own factory:

```ts
import { shouldUseGluecron, GluecronAdapter } from 'gatetest/integrations/gluecron';
// existing GitHub bridge is a Node CommonJS module; interop:
const { GitHubBridge } = require('gatetest/src/core/github-bridge');

export function pickBridge({ repoUrl }: { repoUrl?: string } = {}) {
  if (shouldUseGluecron({ repoUrl })) {
    return new GluecronAdapter();
  }
  return new GitHubBridge();
}
```

Selection order:

1. `GIT_HOST=gluecron` (explicit env) → Gluecron
2. `GIT_HOST=github` → GitHub
3. A Gluecron-origin repo URL (host matches `/(^|\.)gluecron\./`) → Gluecron
4. Otherwise GitHub (unchanged default).

## Failure handling

- **4xx** are surfaced immediately as `GluecronApiError` with the status
  code, operation name, and decoded error body.
- **5xx / 408 / 429** are retried up to 4 times with exponential backoff
  (2 s → 4 s → 8 s → 16 s, capped at 30 s). `Retry-After` is honoured on
  429 responses.
- **Network / timeout** throws wrap the underlying error with the HTTP
  verb and path for triage. The per-request timeout is 30 s by default
  (override via `options.timeoutMs`).

## Tests

The mocked-HTTP integration test lives at
[`tests/gluecron-adapter.test.js`](../../tests/gluecron-adapter.test.js)
and runs as part of `npm test` (`node --test tests/**/*.test.js`). It
stubs `fetch` and verifies every adapter method hits the correct URL,
method, and body shape.

## See also

- Gluecron PR #16 — the v2 endpoints this adapter consumes.
- `src/core/host-bridge.js` — the canonical `HostBridge` contract this
  adapter mirrors.
- `src/core/gluecron-bridge.js` — the long-standing Node bridge (kept for
  CLI-only callers). Both implementations share the Gluecron wire shape.
