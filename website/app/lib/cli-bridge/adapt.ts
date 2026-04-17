/**
 * Adapt a CLI TestResult JSON into the website's ModuleResultEnvelope.
 *
 * Mapping:
 *   checks    → checks.length
 *   issues    → errorChecks + warningChecks
 *   status    → preserved ('passed' | 'failed' | 'skipped')
 *   duration  → preserved
 *   details   → top 20 failed check names + messages
 *   skipped   → result.error (string) when status === 'skipped'
 *
 * Honesty: a module with zero checks returns status="skipped" with reason
 * "no applicable files found" — NOT fake-passed.
 */

import type { ModuleResultEnvelope } from "../scan-modules";

export interface CliCheck {
  name: string;
  passed: boolean;
  severity: "error" | "warning" | "info";
  message?: string;
  fix?: string;
  line?: number;
  file?: string;
}

export interface CliResultJson {
  module: string;
  status: "passed" | "failed" | "skipped" | "pending" | "running";
  duration: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  errors: number;
  warnings: number;
  fixes: number;
  checks: CliCheck[];
  error: string | null;
}

export function adaptCliResult(publicName: string, cli: CliResultJson): ModuleResultEnvelope {
  // Skipped upstream (empty project, missing toolchain, etc.).
  if (cli.status === "skipped") {
    return {
      name: publicName,
      status: "skipped",
      checks: cli.totalChecks || 0,
      issues: 0,
      duration: cli.duration || 0,
      skipped: cli.error || "no applicable files found",
    };
  }

  const checks = cli.totalChecks || 0;
  const issues = (cli.errors || 0) + (cli.warnings || 0);

  // A module that ran but inspected nothing is honestly "skipped" — never
  // claim we ran 67 modules when 10 of them touched zero files.
  if (checks === 0) {
    return {
      name: publicName,
      status: "skipped",
      checks: 0,
      issues: 0,
      duration: cli.duration || 0,
      skipped: cli.error || "no applicable files for this module in the repo",
    };
  }

  const failedChecks = cli.checks.filter((c) => !c.passed);
  const details = failedChecks.slice(0, 20).map((c) => {
    const loc = c.file ? `${c.file}${c.line ? `:${c.line}` : ""}` : "";
    const bits = [c.name];
    if (loc) bits.push(`(${loc})`);
    if (c.message) bits.push(`— ${c.message}`);
    return bits.join(" ");
  });

  const status: "passed" | "failed" | "skipped" =
    cli.status === "passed" ? "passed" : cli.status === "failed" ? "failed" : "passed";

  return {
    name: publicName,
    status,
    checks,
    issues,
    duration: cli.duration || 0,
    details: details.length > 0 ? details : undefined,
  };
}

/**
 * Build a skipped envelope for a module that never ran (capability filtered).
 */
export function buildSkippedEnvelope(publicName: string, reason: string): ModuleResultEnvelope {
  return {
    name: publicName,
    status: "skipped",
    checks: 0,
    issues: 0,
    duration: 0,
    skipped: reason,
  };
}
