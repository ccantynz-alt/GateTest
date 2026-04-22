"use client";

import { useState, useEffect } from "react";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 50);
      // Active-section detection — find the section whose top is closest to
      // (but still above) the viewport's 120px mark, matching nav scroll-padding.
      const sections = ["features", "modules", "comparison", "integrations", "pricing"];
      const anchor = window.scrollY + 120;
      let best = "";
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= anchor) {
          best = id;
        }
      }
      setActiveSection(best);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled
        ? "bg-white/90 backdrop-blur-2xl backdrop-saturate-150 border-b border-border shadow-[0_1px_20px_rgba(0,0,0,0.04)]"
        : "bg-transparent border-b border-white/8"
    }`}>
      {/* Dual-layer glass: subtle accent line on scrolled state */}
      {scrolled && (
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" aria-hidden="true" />
      )}
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <span className="text-white font-bold text-sm font-[var(--font-mono)]">G</span>
          </div>
          <span className={`text-xl font-bold tracking-tight ${scrolled ? "text-foreground" : "text-white"}`}>
            Gate<span className="text-teal-400">Test</span>
          </span>
        </a>

        <div className="hidden md:flex items-center gap-1">
          {["Features", "Modules", "Compare", "Integrations", "Pricing"].map((item) => {
            const id = item.toLowerCase() === "compare" ? "comparison" : item.toLowerCase();
            const isActive = activeSection === id;
            return (
              <a
                key={item}
                href={`#${id}`}
                className={`relative px-3 py-1.5 text-sm font-medium transition-all ${
                  scrolled
                    ? isActive ? "text-accent" : "text-muted hover:text-foreground"
                    : isActive ? "text-white" : "text-white/50 hover:text-white"
                }`}
              >
                {item}
                {/* Active underline pill */}
                {isActive && (
                  <span
                    className={`absolute left-3 right-3 -bottom-1 h-0.5 rounded-full ${scrolled ? "bg-accent" : "bg-teal-400"} shadow-[0_0_8px_rgba(20,184,166,0.5)]`}
                    aria-hidden="true"
                  />
                )}
              </a>
            );
          })}
        </div>

        <div className="hidden md:flex items-center gap-4">
          <a
            href="/dashboard"
            className={`text-sm transition-colors ${
              scrolled ? "text-muted hover:text-foreground" : "text-white/50 hover:text-white"
            }`}
          >
            My Scans
          </a>
          <a
            href="/github/setup"
            className={`px-5 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
              scrolled
                ? "border-border text-foreground hover:border-accent/50"
                : "border-white/15 text-white/70 hover:text-white hover:border-white/30"
            }`}
          >
            Install GitHub App
          </a>
          <a
            href="#pricing"
            className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-all ${
              scrolled
                ? "btn-cta"
                : "hero-cta"
            }`}
          >
            Scan My Repo
          </a>
        </div>

        <button
          className={`md:hidden ${scrolled ? "text-muted" : "text-white/60"} hover:text-white`}
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
        <div className={`md:hidden border-t px-6 py-4 space-y-4 ${
          scrolled
            ? "border-border bg-white/95 backdrop-blur-xl"
            : "border-white/10 bg-[#0a0a12]/95 backdrop-blur-xl"
        }`}>
          {["Features", "Modules", "Compare", "Integrations", "Pricing"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase() === "compare" ? "comparison" : item.toLowerCase()}`}
              className={`block text-sm ${scrolled ? "text-muted hover:text-foreground" : "text-white/60 hover:text-white"}`}
              onClick={() => setMobileOpen(false)}
            >
              {item}
            </a>
          ))}
          <a
            href="/dashboard"
            className={`block text-sm ${scrolled ? "text-muted hover:text-foreground" : "text-white/60 hover:text-white"}`}
            onClick={() => setMobileOpen(false)}
          >
            My Scans
          </a>
          <a
            href="#pricing"
            className={`block px-5 py-2.5 text-sm text-center rounded-lg font-semibold ${scrolled ? "btn-cta" : "hero-cta"}`}
            onClick={() => setMobileOpen(false)}
          >
            Scan My Repo
          </a>
        </div>
      )}
    </nav>
  );
}
