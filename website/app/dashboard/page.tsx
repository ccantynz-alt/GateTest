"use client";

import { useEffect, useState } from "react";

interface Repo {
  name: string;
  full_name: string;
  private: boolean;
  language: string | null;
  installation_id: number;
  default_branch: string;
}

interface ScanResult {
  repo: string;
  gateStatus: string;
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
  };
  issues: Array<{
    module: string;
    file: string;
    message: string;
    severity: string;
  }>;
  duration: number;
  filesScanned: number;
}

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetchRepos();
  }, []);

  async function fetchRepos() {
    try {
      const res = await fetch("/api/github/repos");
      const data = await res.json();

      if (res.status === 401) {
        setError("not_authenticated");
        setLoading(false);
        return;
      }

      if (data.connected) {
        setConnected(true);
        setRepos(data.repos || []);
      } else {
        setConnected(false);
      }
    } catch {
      setError("Failed to load repos");
    }
    setLoading(false);
  }

  async function scanRepo(repo: Repo) {
    setScanning(repo.full_name);
    setScanResult(null);
    try {
      const res = await fetch("/api/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.full_name.split("/")[0],
          repo: repo.name,
          branch: repo.default_branch,
          installation_id: repo.installation_id,
        }),
      });
      const data = await res.json();
      setScanResult(data);
    } catch {
      setScanResult(null);
    }
    setScanning(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  // Not logged in
  if (error === "not_authenticated" || !connected) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white p-8">
        <div className="max-w-xl mx-auto text-center space-y-8 pt-20">
          <h1 className="text-4xl font-bold">Connect GitHub</h1>
          <p className="text-gray-400 text-lg">
            Install GateTest on your repos to start scanning. Works with private
            repos. One click, permanent access.
          </p>
          <div className="space-y-4">
            <a
              href="/api/github/setup?action=install"
              className="inline-block bg-white text-black font-bold px-8 py-4 rounded-lg text-lg hover:bg-gray-200 transition"
            >
              Connect GitHub Repos
            </a>
            <p className="text-gray-500 text-sm">
              Already connected?{" "}
              <a
                href="/api/github/setup?action=login"
                className="text-cyan-400 underline"
              >
                Sign in with GitHub
              </a>
            </p>
          </div>
          <div className="bg-[#12121a] rounded-lg p-6 text-left space-y-3 text-sm">
            <h3 className="font-semibold text-base">How it works:</h3>
            <ol className="space-y-2 text-gray-400 list-decimal list-inside">
              <li>Click &quot;Connect GitHub Repos&quot; above</li>
              <li>Select which repos to give GateTest access to</li>
              <li>
                Every push and PR is automatically scanned — you never have to
                think about it again
              </li>
            </ol>
            <div className="border-t border-gray-800 pt-3 mt-3 flex gap-6 text-gray-500">
              <span>Private repos supported</span>
              <span>No tokens to manage</span>
              <span>Persistent access</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard with repos
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-gray-400 mt-1">
              {repos.length} repo{repos.length !== 1 ? "s" : ""} connected
            </p>
          </div>
          <a
            href="/api/github/setup?action=install"
            className="border border-gray-600 px-4 py-2 rounded-lg hover:border-white transition text-sm"
          >
            Add More Repos
          </a>
        </div>

        {/* Repo list */}
        <div className="space-y-3">
          {repos.map((repo) => (
            <div
              key={repo.full_name}
              className="bg-[#12121a] rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    repo.private ? "bg-yellow-500" : "bg-green-500"
                  }`}
                />
                <div>
                  <div className="font-semibold">{repo.full_name}</div>
                  <div className="text-gray-500 text-sm flex gap-3">
                    {repo.language && <span>{repo.language}</span>}
                    <span>{repo.private ? "Private" : "Public"}</span>
                    <span>{repo.default_branch}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => scanRepo(repo)}
                disabled={scanning === repo.full_name}
                className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded text-sm font-medium transition"
              >
                {scanning === repo.full_name ? "Scanning..." : "Scan Now"}
              </button>
            </div>
          ))}
        </div>

        {/* Scan results */}
        {scanResult && (
          <div className="mt-8 bg-[#12121a] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">
                Scan: {scanResult.repo}
              </h2>
              <span
                className={`px-3 py-1 rounded-full text-sm font-bold ${
                  scanResult.gateStatus === "PASSED"
                    ? "bg-green-900 text-green-400"
                    : "bg-red-900 text-red-400"
                }`}
              >
                {scanResult.gateStatus}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-black/30 rounded p-3 text-center">
                <div className="text-2xl font-bold">{scanResult.summary.totalChecks}</div>
                <div className="text-gray-500 text-xs">Checks</div>
              </div>
              <div className="bg-black/30 rounded p-3 text-center">
                <div className="text-2xl font-bold text-green-400">{scanResult.summary.passed}</div>
                <div className="text-gray-500 text-xs">Passed</div>
              </div>
              <div className="bg-black/30 rounded p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{scanResult.summary.errors}</div>
                <div className="text-gray-500 text-xs">Errors</div>
              </div>
              <div className="bg-black/30 rounded p-3 text-center">
                <div className="text-2xl font-bold text-yellow-400">{scanResult.summary.warnings}</div>
                <div className="text-gray-500 text-xs">Warnings</div>
              </div>
            </div>

            <div className="text-gray-500 text-sm mb-4">
              {scanResult.filesScanned} files scanned in {scanResult.duration}ms
            </div>

            {scanResult.issues.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">Issues</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {scanResult.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-3 p-2 rounded text-sm ${
                        issue.severity === "error"
                          ? "bg-red-900/20"
                          : "bg-yellow-900/20"
                      }`}
                    >
                      <span
                        className={`shrink-0 mt-0.5 w-2 h-2 rounded-full ${
                          issue.severity === "error"
                            ? "bg-red-500"
                            : "bg-yellow-500"
                        }`}
                      />
                      <div>
                        <span className="text-gray-400">[{issue.module}]</span>{" "}
                        <span className="text-gray-200">{issue.message}</span>
                        {issue.file && issue.file !== "/" && (
                          <div className="text-gray-500 text-xs mt-0.5">
                            {issue.file}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
