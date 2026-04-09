"use client";

import { useEffect } from "react";

export default function CheckoutSuccess() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    if (sessionId) {
      // Fetch session to get repo URL and tier, then redirect to scan
      fetch(`/api/scan/status?id=${sessionId}`)
        .then((res) => res.json())
        .then((data) => {
          const scanUrl = `/scan/status?session_id=${sessionId}&repo_url=${encodeURIComponent(data.repoUrl || "")}&tier=${data.tier || "quick"}`;
          window.location.href = scanUrl;
        })
        .catch(() => {
          // Fallback — redirect with just session ID
          window.location.href = `/scan/status?session_id=${sessionId}`;
        });
    }
  }, []);

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center px-6 py-24">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <span className="text-accent-light text-xl">&#9679;</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">Starting your scan...</h1>
        <p className="text-muted">Connecting to your repository.</p>
      </div>
    </div>
  );
}
