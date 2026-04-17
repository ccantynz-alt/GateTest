/**
 * Bridge entry point — runs all 67 CLI modules against a materialized
 * /tmp repo and adapts results to the website's envelope shape.
 *
 * Honesty contract:
 *   - Every module in the registry appears in the output.
 *   - Modules classified as needs-toolchain / needs-browser are skipped
 *     with the specific reason declared in capabilities.ts.
 *   - Modules that exceed the 20s per-module budget are recorded as
 *     "failed" with a timeout message — NEVER silently "passed".
 *   - Modules that throw are recorded as failed with the error message.
 *   - Any bridge-level crash throws through — the caller (/api/scan/run)
 *     is responsible for the ts-fallback path.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { ModuleContext } from "../scan-modules/types";
import type { ModuleResultEnvelope } from "../scan-modules";
import { materializeRepo } from "./materialize";
import { isBridgeCompatible, MODULE_CAPABILITIES } from "./capabilities";
import { ALL_MODULE_NAMES, getModule } from "./static-registry";
import { adaptCliResult, buildSkippedEnvelope, type CliResultJson } from "./adapt";

const PER_MODULE_TIMEOUT_MS = 20000;

// Loaded via CommonJS from the CLI core. Static require so bundler traces it.
const { TestResult } = require("../../../../src/core/runner.js") as {
  TestResult: new (name: string) => {
    start(): void;
    pass(): void;
    fail(err: unknown): void;
    skip(reason: string): void;
    addCheck(name: string, passed: boolean, details?: Record<string, unknown>): void;
    toJSON(): CliResultJson;
    errorChecks: unknown[];
  };
};

export interface BridgeTierSummary {
  modules: ModuleResultEnvelope[];
  totalIssues: number;
  materialized: { filesWritten: number; filesSkipped: number; truncated: number };
}

/**
 * Names to run for each tier. Mirrors the Bible's tier definitions — every
 * paying customer on "full" gets all 67 modules represented in the output.
 */
export const BRIDGE_TIERS: Record<string, string[]> = {
  quick: ["syntax", "lint", "secrets", "codeQuality"],
  full: ALL_MODULE_NAMES,
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms budget`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export async function runBridgeTier(tier: string, ctx: ModuleContext): Promise<BridgeTierSummary> {
  const names = BRIDGE_TIERS[tier] || BRIDGE_TIERS.quick;

  // Materialize once; modules share the same projectRoot.
  const mat = await materializeRepo(ctx.fileContents);

  const envelopes: ModuleResultEnvelope[] = [];

  try {
    for (const name of names) {
      const cap = MODULE_CAPABILITIES[name];

      // Up-front honest skip for browser / toolchain modules.
      if (!cap || !isBridgeCompatible(name)) {
        const reason =
          cap?.skipReason ||
          (cap?.capability === "needs-browser"
            ? "Requires a browser runtime — not runnable in Vercel serverless."
            : cap?.capability === "needs-toolchain"
            ? "Requires project dev-deps + test toolchain — run via the GateTest CLI."
            : "Not yet runnable in the serverless scanner.");
        envelopes.push(buildSkippedEnvelope(name, reason));
        continue;
      }

      const Ctor = getModule(name);
      if (!Ctor) {
        envelopes.push(buildSkippedEnvelope(name, `Module "${name}" missing from static registry`));
        continue;
      }

      const result = new TestResult(name);
      const started = Date.now();
      try {
        result.start();
        const instance = new Ctor();
        const config = {
          projectRoot: mat.projectRoot,
          // Let memory-using modules write under the scratch dir safely.
          disableNetwork: true,
        };
        await withTimeout(instance.run(result, config), PER_MODULE_TIMEOUT_MS, `Module ${name}`);
        if (result.errorChecks.length > 0) {
          result.fail(`${result.errorChecks.length} error(s)`);
        } else {
          result.pass();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.fail(msg);
      }
      // Ensure duration is captured even on failure paths that didn't set it.
      const json = result.toJSON();
      if (!json.duration) json.duration = Date.now() - started;

      envelopes.push(adaptCliResult(name, json));
    }
  } finally {
    await mat.cleanup();
  }

  const totalIssues = envelopes.reduce((s, m) => s + m.issues, 0);
  return {
    modules: envelopes,
    totalIssues,
    materialized: {
      filesWritten: mat.filesWritten,
      filesSkipped: mat.filesSkipped,
      truncated: mat.truncated,
    },
  };
}
