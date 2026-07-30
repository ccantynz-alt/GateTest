#!/usr/bin/env node
/**
 * gatetest-reliability — CLI entry for the continuous reliability sweep.
 *
 * Loads the corpus under `--corpus <path>` (default
 * `reliability-corpus/`), runs every case through the scanner adapter,
 * prints the report.
 *
 * Painkiller (Bible Forbidden #25): NEVER exits non-zero on case
 * failures. The nightly workflow opens a PR with the drift report
 * when regressions land; the CLI exit code is reserved for argument
 * errors or outright crashes.
 *
 * Examples:
 *   gatetest-reliability
 *   gatetest-reliability --corpus reliability-corpus --url-only
 *   gatetest-reliability --json > report.json
 */

"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { runReliabilityCli } = require(path.join(ROOT, "src/core/reliability/cli-runner.js"));

const USAGE = `
Usage: gatetest-reliability [flags]

Flags:
  --corpus <path>         Corpus root (default: reliability-corpus/)
  --gatetest-bin <path>   Path to gatetest CLI (default: bin/gatetest.js)
  --category <name>       Only run this category (repeatable)
  --url-only              Only run url-* cases
  --code-only             Only run code-target cases
  --determinism           Run each scan twice and verify identical output
  --capture-baselines     After the run, write per-case baselines to
                          reliability-corpus/baselines/<name>.json.
                          Use after accepting drift to lock in new shape.
  --compare-baselines     Compare each case's result to its stored baseline
                          and report drift. Cases with no baseline are
                          flagged so you can run --capture-baselines.
  --json                  Emit JSON instead of markdown
  --strict                Exit 1 if any case fails, any manifest is invalid,
                          or any case drifts from its baseline. Use in CI.
  --help, -h              Show this usage

Painkiller by default: without --strict this CLI never exits non-zero on
case failures — the run is informational, and a customer is never blocked
by it. Hard non-zero exit only on argument errors or outright crashes.

With --strict it becomes a gate. That is how CI uses it: a known-good case
that starts producing findings is a false-positive regression, and it fails
the build. On a known-good case the ceiling for BOTH errors and warnings
defaults to zero, because any finding on code asserted to be clean is by
definition a false positive.
`.trim();

function parseArgs(argv) {
  const out = {
    corpusRoot: path.join(ROOT, "reliability-corpus"),
    gatetestBin: path.join(ROOT, "bin/gatetest.js"),
    includeCategories: [],
    urlOnly: false,
    codeOnly: false,
    repeatForDeterminism: false,
    captureBaselines: false,
    compareBaselines: false,
    strict: false,
    json: false,
    help: false,
    errors: [],
  };
  const args = argv.slice();
  while (args.length > 0) {
    const a = args.shift();
    switch (a) {
      case "--corpus": out.corpusRoot = args.shift() || out.corpusRoot; break;
      case "--gatetest-bin": out.gatetestBin = args.shift() || out.gatetestBin; break;
      case "--category": {
        const v = args.shift();
        if (v) out.includeCategories.push(v);
        break;
      }
      case "--url-only": out.urlOnly = true; break;
      case "--code-only": out.codeOnly = true; break;
      case "--determinism": out.repeatForDeterminism = true; break;
      case "--capture-baselines": out.captureBaselines = true; break;
      case "--compare-baselines": out.compareBaselines = true; break;
      case "--strict": out.strict = true; break;
      case "--json": out.json = true; break;
      case "--help":
      case "-h": out.help = true; break;
      default:
        if (a && a.startsWith("--")) out.errors.push(`unknown flag: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    return 0;
  }
  if (args.errors.length > 0) {
    process.stderr.write(`[gatetest-reliability] argument errors:\n`);
    for (const e of args.errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write(`\n${USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = await runReliabilityCli({
      corpusRoot: args.corpusRoot,
      gatetestBin: args.gatetestBin,
      includeCategories: args.includeCategories,
      repeatForDeterminism: args.repeatForDeterminism,
      urlOnly: args.urlOnly,
      codeOnly: args.codeOnly,
      json: args.json,
      captureBaselines: args.captureBaselines,
      compareBaselines: args.compareBaselines,
      strict: args.strict,
    });
  } catch (err) {
    process.stderr.write(`[gatetest-reliability] fatal: ${err && err.stack ? err.stack : String(err)}\n`);
    return 2;
  }
  process.stdout.write(result.output + "\n");
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[gatetest-reliability] crash: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(2);
  });
