"use client";

import { useState } from "react";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-lg bg-accent/20 pulse-glow" />
            <div className="absolute inset-1 rounded-md bg-accent flex items-center justify-center">
              <span className="text-white font-bold text-sm font-[var(--font-mono)]">G</span>
            </div>
          </div>
          <span className="text-xl font-bold tracking-tight">
            Gate<span className="text-accent-light">Test</span>
          </span>
        </a>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-muted hover:text-foreground transition-colors">
            Features
          </a>
          <a href="#modules" className="text-sm text-muted hover:text-foreground transition-colors">
            Modules
          </a>
          <a href="#comparison" className="text-sm text-muted hover:text-foreground transition-colors">
            Compare
          </a>
          <a href="#integrations" className="text-sm text-muted hover:text-foreground transition-colors">
            Integrations
          </a>
          <a href="#pricing" className="text-sm text-muted hover:text-foreground transition-colors">
            Pricing
          </a>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <a
            href="/github/setup"
            className="px-5 py-2.5 text-sm font-medium rounded-lg border border-border hover:border-accent/50 text-foreground transition-colors"
          >
            Install GitHub App
          </a>
          <a
            href="#pricing"
            className="px-5 py-2.5 text-sm font-medium rounded-lg bg-accent hover:bg-accent-light text-white transition-colors pulse-glow"
          >
            Scan My Repo
          </a>
        </div>

        <button
          className="md:hidden text-muted hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M3 12h18M3 6h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-xl px-6 py-4 space-y-4">
          <a href="#features" className="block text-sm text-muted hover:text-foreground" onClick={() => setMobileOpen(false)}>Features</a>
          <a href="#modules" className="block text-sm text-muted hover:text-foreground" onClick={() => setMobileOpen(false)}>Modules</a>
          <a href="#comparison" className="block text-sm text-muted hover:text-foreground" onClick={() => setMobileOpen(false)}>Compare</a>
          <a href="#integrations" className="block text-sm text-muted hover:text-foreground" onClick={() => setMobileOpen(false)}>Integrations</a>
          <a href="#pricing" className="block text-sm text-muted hover:text-foreground" onClick={() => setMobileOpen(false)}>Pricing</a>
          <a href="#pricing" className="block px-5 py-2.5 text-sm font-medium rounded-lg bg-accent text-white text-center" onClick={() => setMobileOpen(false)}>
            Scan My Repo
          </a>
        </div>
      )}
    </nav>
  );
}
