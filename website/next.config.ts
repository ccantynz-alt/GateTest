import type { NextConfig } from "next";
import path from "path";

// The scan API materializes a repo into /tmp and runs the 67-module CLI
// engine living in ../src/**. Next/Webpack does not trace requires that
// cross the project root, so we pin the tracing root to the repo root
// and declare an explicit include for the scan route. Without this the
// serverless bundle silently ships zero CLI modules.
const REPO_ROOT = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingRoot: REPO_ROOT,
  outputFileTracingIncludes: {
    "/api/scan/run": ["../src/**/*.js", "../src/**/*.json"],
  },
};

export default nextConfig;
