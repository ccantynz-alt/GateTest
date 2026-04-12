"use client";

import { useState } from "react";

interface ScanRecord {
  id: string;
  session_id: string;
  repo_url: string;
  tier: string;
  status: string;
  score: number | null;
  duration_ms: number | null;
  tier_price_usd: string | null;
  summary: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CustomerRecord {
  email: string;
  github_login: string | null;
  total_scans: number;
  total_spent_usd: string;
  created_at: string;
}

interface DashboardData {
  scans: ScanRecord[];
  customer: CustomerRecord | null;
  note?: string;
}

export default function Dashboard() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);

  async function lookup() {
    if (!email || !email.includes("@")) {
      setError("Enter the email you used at checkout");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Failed to fetch scans");
        return;
      }

      setData(json);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <a href="/" className="text-sm text-muted hover:text-foreground">
            &larr; Back to GateTest
          </a>
          <h1 className="text-3xl font-bold mt-4">Your Scans</h1>
          <p className="text-muted mt-2">
            Enter the email you used at checkout to view your scan history and results.
          </p>
        </div>

        {/* Email lookup */}
        <div className="card p-6 mb-8">
          <label htmlFor="dash-email" className="block text-sm font-medium mb-2">
            Email address
          </label>
          <div className="flex gap-3">
            <input
              id="dash-email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") lookup(); }}
              placeholder="you@example.com"
              className="flex-1 px-4 py-3 rounded-lg border border-border bg-white text-foreground text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={lookup}
              disabled={loading}
              className="btn-primary px-6 py-3 text-sm disabled:opacity-50"
            >
              {loading ? "Looking up..." : "View Scans"}
            </button>
          </div>
          {error && <p className="text-danger text-sm mt-2">{error}</p>}
          {data?.note && (
            <p className="text-sm text-muted mt-2">{data.note}</p>
          )}
        </div>

        {/* Customer summary */}
        {data?.customer && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">{data.customer.total_scans}</p>
              <p className="text-xs text-muted">Total Scans</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold">
                ${Number(data.customer.total_spent_usd || 0).toFixed(0)}
              </p>
              <p className="text-xs text-muted">Total Spent</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-sm font-mono break-all">
                {data.customer.github_login || "—"}
              </p>
              <p className="text-xs text-muted">GitHub</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-sm">
                {data.customer.created_at
                  ? new Date(data.customer.created_at).toLocaleDateString()
                  : "—"}
              </p>
              <p className="text-xs text-muted">Customer Since</p>
            </div>
          </div>
        )}

        {/* Scan list */}
        {data && data.scans.length === 0 && (
          <div className="card p-8 text-center">
            <p className="text-muted">No scans found for this email.</p>
            <p className="text-sm text-muted mt-2">
              Make sure you&apos;re using the same email you entered at Stripe checkout.
            </p>
            <a href="/#pricing" className="btn-primary px-6 py-3 text-sm inline-block mt-4">
              Run Your First Scan
            </a>
          </div>
        )}

        {data && data.scans.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold mb-2">
              {data.scans.length} Scan{data.scans.length !== 1 ? "s" : ""}
            </h2>
            {data.scans.map((scan) => (
              <a
                key={scan.id}
                href={`/scan/status?session_id=${scan.session_id}&repo_url=${encodeURIComponent(scan.repo_url)}&tier=${scan.tier}`}
                className="card p-5 block hover:border-accent/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm font-medium truncate max-w-[60%]">
                    {scan.repo_url.replace("https://github.com/", "")}
                  </span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    scan.status === "completed"
                      ? "bg-green-50 text-success"
                      : scan.status === "failed"
                        ? "bg-red-50 text-danger"
                        : "bg-yellow-50 text-warning"
                  }`}>
                    {scan.status}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <span>{scan.tier} scan</span>
                  {scan.score !== null && <span>Score: {scan.score}</span>}
                  {scan.duration_ms && <span>{(scan.duration_ms / 1000).toFixed(1)}s</span>}
                  {scan.tier_price_usd && <span>${Number(scan.tier_price_usd).toFixed(0)}</span>}
                  <span className="ml-auto">
                    {scan.created_at ? new Date(scan.created_at).toLocaleDateString() : ""}
                  </span>
                </div>
                {scan.summary && (
                  <p className="text-xs text-muted mt-2 truncate">{scan.summary}</p>
                )}
              </a>
            ))}
          </div>
        )}

        {/* Not looked up yet */}
        {!data && !loading && (
          <div className="text-center text-sm text-muted mt-12">
            <p>Your scan results are stored securely and linked to your checkout email.</p>
          </div>
        )}
      </div>
    </div>
  );
}
