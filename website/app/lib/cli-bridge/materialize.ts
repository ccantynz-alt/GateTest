/**
 * Materialize RepoFile[] into /tmp/gatetest-scan-<id>/ so the CLI modules
 * in src/modules/*.js can read via fs against a real projectRoot.
 *
 * Guards:
 *   - Path traversal: every relative path is normalized and rejected if it
 *     escapes projectRoot (startsWith("..") or contains null bytes).
 *   - Per-file cap: 2 MB. Larger files are silently truncated — honest
 *     scanning is still possible on the first 2 MB.
 *   - Per-scan cap: 400 MB. Hitting the cap stops writes; remaining files
 *     are dropped and the caller is told how many were skipped.
 *
 * Cleanup is the caller's responsibility — always run `await cleanup()`
 * in a finally block so /tmp doesn't fill across cold starts.
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { RepoFile } from "../scan-modules/types";

const PER_FILE_CAP = 2 * 1024 * 1024; // 2 MB
const PER_SCAN_CAP = 400 * 1024 * 1024; // 400 MB

export interface MaterializeResult {
  projectRoot: string;
  filesWritten: number;
  filesSkipped: number;
  bytesWritten: number;
  truncated: number;
  cleanup: () => Promise<void>;
}

export async function materializeRepo(files: RepoFile[]): Promise<MaterializeResult> {
  const scanId = crypto.randomBytes(8).toString("hex");
  const projectRoot = path.join(os.tmpdir(), `gatetest-scan-${scanId}`);
  await fs.mkdir(projectRoot, { recursive: true });

  let filesWritten = 0;
  let filesSkipped = 0;
  let bytesWritten = 0;
  let truncated = 0;

  for (const file of files) {
    if (bytesWritten >= PER_SCAN_CAP) {
      filesSkipped++;
      continue;
    }

    // Path-traversal guard. Reject anything with nulls, absolute paths, or
    // a normalized form that escapes projectRoot.
    if (!file.path || file.path.includes("\0")) {
      filesSkipped++;
      continue;
    }
    const normalized = path.normalize(file.path).replace(/^[\\/]+/, "");
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      filesSkipped++;
      continue;
    }
    const dest = path.join(projectRoot, normalized);
    const resolved = path.resolve(dest);
    if (!resolved.startsWith(path.resolve(projectRoot) + path.sep) && resolved !== path.resolve(projectRoot)) {
      filesSkipped++;
      continue;
    }

    let content = file.content || "";
    if (Buffer.byteLength(content, "utf8") > PER_FILE_CAP) {
      content = content.slice(0, PER_FILE_CAP);
      truncated++;
    }

    const remaining = PER_SCAN_CAP - bytesWritten;
    const size = Buffer.byteLength(content, "utf8");
    if (size > remaining) {
      content = content.slice(0, remaining);
    }

    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content, "utf8");
      filesWritten++;
      bytesWritten += Buffer.byteLength(content, "utf8");
    } catch {
      filesSkipped++;
    }
  }

  const cleanup = async () => {
    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
    } catch {
      // Best-effort — /tmp is ephemeral anyway.
    }
  };

  return { projectRoot, filesWritten, filesSkipped, bytesWritten, truncated, cleanup };
}
