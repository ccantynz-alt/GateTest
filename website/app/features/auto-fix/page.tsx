import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI Auto-Fix — GateTest Creates the PR, You Just Merge",
  description:
    "GateTest finds issues and creates a pull request that fixes them. AI reads your code, writes the fix, opens the PR. You review and merge. Zero manual debugging.",
  keywords: [
    "AI auto-fix code",
    "automatic code fixes",
    "AI pull request",
    "automated bug fixes",
    "AI code repair",
    "auto-fix security issues",
    "GateTest auto-fix",
    "AI-powered code review fix",
  ],
  alternates: {
    canonical: "https://gatetest.ai/features/auto-fix",
  },
  openGraph: {
    title: "AI Auto-Fix — GateTest Creates the PR, You Just Merge",
    description:
      "GateTest finds issues and creates a pull request that fixes them. AI reads your code, writes the fix, opens the PR. You review and merge. Zero manual debugging.",
    url: "https://gatetest.ai/features/auto-fix",
    siteName: "GateTest",
    type: "website",
  },
};

const faqItems = [
  {
    q: "What kinds of issues can GateTest auto-fix?",
    a: "GateTest's AI auto-fix covers any issue it can detect: security misconfigurations (adding rejectUnauthorized: true back in, setting httpOnly: true on cookies, adding SSRF validation guards), code quality issues (restructuring N+1 queries into batched lookups, wrapping forEach(async) in Promise.all), TypeScript strictness (removing @ts-ignore with proper type fixes, replacing any casts with specific types), accessibility violations, and more. The AI reads your entire file for context before writing any fix.",
  },
  {
    q: "How does GateTest know the fix is correct?",
    a: "GateTest uses Claude to generate fixes — the same AI that powers the code review. Claude reads the surrounding code context, understands the intent, and writes a fix that preserves the existing logic while addressing the issue. The fix is submitted as a pull request — not applied automatically. You review the diff, run your tests, and merge only when satisfied. GateTest never merges automatically.",
  },
  {
    q: "Does auto-fix create one PR per issue or one PR for everything?",
    a: "Auto-fix creates a single pull request per scan that bundles all fixable issues into one reviewable diff. The PR description includes a per-module breakdown: which issues were found, which were auto-fixed, and which require manual attention (because the fix would require domain knowledge GateTest doesn't have, like choosing the right business logic for a race condition).",
  },
  {
    q: "What if the auto-fix is wrong?",
    a: "You never merge a fix you haven't reviewed. The PR is a proposal — read the diff, run your test suite against the branch, then decide whether to merge, modify, or close it. GateTest's terms are clear: you are solely responsible for reviewing, testing, and approving all auto-fix changes before merging. The AI is very good, but code review is still your job.",
  },
  {
    q: "Which pricing tier includes auto-fix?",
    a: "Auto-fix is available in the Scan + Fix tier ($199 per scan) and the Nuclear tier ($399). The Full Scan ($99) finds issues and delivers a detailed report. The Scan + Fix tier runs the same 67-module scan and also creates the fix PR. The Continuous plan ($49/month) includes scan-on-every-push but not auto-fix — add auto-fix on-demand when needed.",
  },
  {
    q: "Can GateTest auto-fix issues across multiple files?",
    a: "Yes. When an issue spans multiple files — like an import cycle requiring restructuring, or an N+1 query requiring a new batch-fetch utility function — GateTest creates a multi-file diff in the same PR. All changes are visible in the PR diff for review before merge.",
  },
];

const fixExamples = [
  {
    title: "SSRF vulnerability auto-fix",
    module: "ssrf",
    before: `// ❌ Before: user-controlled URL\nasync function fetchWebhook(req: Request) {\n  const url = req.body.webhookUrl;\n  const data = await fetch(url).then(r => r.json());\n  return data;\n}`,
    after: `// ✓ After: GateTest adds validation\nimport { isValidUrl, ALLOWED_HOSTS } from '@/lib/url-validator';\n\nasync function fetchWebhook(req: Request) {\n  const url = req.body.webhookUrl;\n  if (!isValidUrl(url, ALLOWED_HOSTS)) {\n    throw new Error('Invalid webhook URL');\n  }\n  const data = await fetch(url).then(r => r.json());\n  return data;\n}`,
    severity: "error",
  },
  {
    title: "N+1 query auto-fix",
    module: "nPlusOne",
    before: `// ❌ Before: N queries inside a loop\nconst users = await prisma.user.findMany();\nfor (const user of users) {\n  user.orders = await prisma.order.findMany({\n    where: { userId: user.id },\n  });\n}`,
    after: `// ✓ After: single batched query\nconst users = await prisma.user.findMany({\n  include: {\n    orders: true,\n  },\n});`,
    severity: "error",
  },
  {
    title: "TypeScript strict mode fix",
    module: "typescriptStrictness",
    before: `// tsconfig.json — ❌ Before\n{\n  "compilerOptions": {\n    "strict": false,\n    "skipLibCheck": true\n  }\n}`,
    after: `// tsconfig.json — ✓ After\n{\n  "compilerOptions": {\n    "strict": true\n    // removed skipLibCheck: fix the upstream types instead\n  }\n}`,
    severity: "error",
  },
  {
    title: "Cookie security config fix",
    module: "cookieSecurity",
    before: `// ❌ Before: XSS-readable session cookie\napp.use(session({\n  secret: 'changeme',\n  cookie: {\n    httpOnly: false,\n    secure: false,\n  }\n}));`,
    after: `// ✓ After: hardened session config\napp.use(session({\n  secret: process.env.SESSION_SECRET,  // strong secret from env\n  cookie: {\n    httpOnly: true,   // XSS cannot read\n    secure: true,     // HTTPS only\n    sameSite: 'lax',  // CSRF protection\n  }\n}));`,
    severity: "error",
  },
];

export default function AutoFixPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "GateTest Auto-Fix",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    url: "https://gatetest.ai/features/auto-fix",
    description:
      "AI-powered auto-fix: GateTest finds code issues and creates a pull request with the fixes. Security misconfigs, N+1 queries, TypeScript strictness, accessibility violations — fixed automatically.",
    offers: {
      "@type": "Offer",
      name: "Scan + Fix",
      price: "199.00",
      priceCurrency: "USD",
      description: "67-module scan + AI auto-fix pull request",
    },
  };

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <div className="min-h-screen" style={{ background: "#0a0a12" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* Nav */}
      <nav className="border-b border-white/[0.06] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm font-mono">G</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              Gate<span className="text-teal-400">Test</span>
            </span>
          </Link>
          <Link href="/" className="text-sm text-white/50 hover:text-white transition-colors">
            &larr; Back to GateTest
          </Link>
        </div>
      </nav>

      <main className="px-6 py-16 max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-white/40 mb-10">
          <Link href="/" className="hover:text-white/70 transition-colors">GateTest</Link>
          <span>/</span>
          <span className="text-white/60">Features</span>
          <span>/</span>
          <span className="text-white/60">Auto-Fix</span>
        </nav>

        {/* Hero */}
        <div className="mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-xs text-teal-400 font-medium mb-6">
            Feature: AI Auto-Fix
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
            GateTest Creates the PR.
            <br />
            <span className="text-teal-400">You Just Merge.</span>
          </h1>
          <p className="text-lg text-white/60 max-w-2xl leading-relaxed">
            Every other code quality tool stops at the report. GateTest goes further: after finding
            issues, it uses Claude to write the fix and opens a pull request. You review the diff,
            run your tests, and merge. Zero manual debugging. Zero time spent hunting the right fix.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold text-sm"
              style={{ background: "#2dd4bf", color: "#0a0a12" }}
            >
              Scan + Fix — $199
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold text-sm border border-white/15 text-white/70 hover:border-white/30 hover:text-white transition-colors"
            >
              Start with a Full Scan — $99
            </Link>
          </div>
        </div>

        {/* How it works */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-8">How auto-fix works</h2>
          <div className="grid sm:grid-cols-4 gap-4">
            {[
              {
                step: "1",
                title: "You pay, we scan",
                body: "Paste your repo URL. We hold your card, run all 67 modules, and identify every issue across security, quality, performance, and accessibility.",
              },
              {
                step: "2",
                title: "AI writes the fixes",
                body: "Claude reads each flagged file with full context. It writes code changes that address the root cause — not a patch, not a workaround, a real fix.",
              },
              {
                step: "3",
                title: "PR opened automatically",
                body: "A pull request is created on your repo with all the fixes as a single reviewable diff. Each change is commented with the issue it addresses.",
              },
              {
                step: "4",
                title: "You review and merge",
                body: "Read the diff, run your test suite on the branch, approve or modify. GateTest never merges automatically. Merge when you're satisfied.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-xl p-5 border border-white/[0.08]"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="w-8 h-8 rounded-full bg-teal-500/15 border border-teal-500/25 flex items-center justify-center text-teal-400 font-bold text-sm mb-3">
                  {s.step}
                </div>
                <h3 className="text-white font-semibold text-sm mb-2">{s.title}</h3>
                <p className="text-white/50 text-xs leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Fix examples */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-4">Auto-fix examples</h2>
          <p className="text-white/50 text-sm mb-8">
            Real before/after diffs from GateTest&rsquo;s auto-fix. These are actual code changes the AI generates.
          </p>
          <div className="space-y-6">
            {fixExamples.map((ex) => (
              <div
                key={ex.title}
                className="rounded-xl border border-white/[0.08] overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                    ex.severity === "error"
                      ? "text-red-400 bg-red-500/10 border-red-500/20"
                      : "text-amber-400 bg-amber-500/10 border-amber-500/20"
                  }`}>{ex.severity}</span>
                  <code className="text-teal-400/70 text-xs">{ex.module}</code>
                  <span className="text-white/60 text-sm font-medium">{ex.title}</span>
                </div>
                <div className="grid sm:grid-cols-2">
                  <div className="p-5 border-b sm:border-b-0 sm:border-r border-white/[0.06]">
                    <div className="text-red-400 text-xs font-medium mb-2">Before</div>
                    <pre className="text-red-300/60 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">{ex.before}</pre>
                  </div>
                  <div className="p-5">
                    <div className="text-emerald-400 text-xs font-medium mb-2">After (auto-fix PR)</div>
                    <pre className="text-emerald-300/60 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">{ex.after}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Safety callout */}
        <section className="mb-16 rounded-xl border border-amber-500/20 p-6" style={{ background: "rgba(245,158,11,0.05)" }}>
          <h2 className="text-lg font-semibold text-amber-300 mb-3">You are always in control</h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {[
              { title: "We never merge automatically", body: "The PR is always a proposal. You review, test on the branch, and merge only when satisfied. GateTest has no merge permissions." },
              { title: "We never push to main", body: "Auto-fix creates a new branch (gatetest/fix-YYYY-MM-DD). Your main branch is never touched without your explicit merge action." },
              { title: "You own the fix", body: "The PR diff is yours to modify. Adjust the AI's fix, remove specific changes, or close the PR entirely — full control, always." },
            ].map((item) => (
              <div key={item.title}>
                <div className="text-white/80 text-sm font-semibold mb-1.5">{item.title}</div>
                <p className="text-white/50 text-xs leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison vs just a report */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-6">The cost of reports without fixes</h2>
          <div className="rounded-xl border border-white/[0.08] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08]" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <th className="text-left px-5 py-4 text-white/50 font-medium">Workflow</th>
                  <th className="text-center px-5 py-4 text-teal-400 font-semibold">GateTest Scan + Fix</th>
                  <th className="text-center px-5 py-4 text-white/40 font-medium">Report-only tool</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Time to discover issue", "< 60 seconds (scan)", "< 60 seconds (scan)"],
                  ["Time to understand the fix", "Read the diff", "Research the issue, read docs, understand context"],
                  ["Time to write the fix", "Zero — AI wrote it", "30 min – 4 hours per issue"],
                  ["Time to verify", "Run test suite on PR branch", "Write fix, run tests, iterate"],
                  ["Risk of wrong fix", "AI fix is reviewable — low", "Human writes fix tired at 11pm — high"],
                  ["Issues fixed in a session", "All fixable issues in one PR", "1–3 if developer has time"],
                ].map(([label, ours, theirs]) => (
                  <tr key={label} className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5 text-white/70">{label}</td>
                    <td className="px-5 py-3.5 text-center text-emerald-400 text-xs">{ours}</td>
                    <td className="px-5 py-3.5 text-center text-white/40 text-xs">{theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-8">Frequently asked questions</h2>
          <div className="space-y-4">
            {faqItems.map((item) => (
              <div
                key={item.q}
                className="rounded-xl border border-white/[0.08] p-5"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <h3 className="text-white font-semibold mb-3 leading-snug">{item.q}</h3>
                <p className="text-white/55 text-sm leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-2xl border border-teal-500/20 p-10 text-center" style={{ background: "rgba(20,184,166,0.05)" }}>
          <h2 className="text-3xl font-bold text-white mb-4">
            Stop reading reports. Start merging fixes.
          </h2>
          <p className="text-white/60 mb-8 max-w-xl mx-auto">
            67 modules find the issues. Claude writes the fixes. One PR to review. Pay only when results are delivered.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl font-semibold"
              style={{ background: "#2dd4bf", color: "#0a0a12" }}
            >
              Scan + Fix — $199
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl font-semibold border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
            >
              Full Scan Only — $99
            </Link>
          </div>
          <p className="text-white/30 text-xs mt-6">
            Card hold only. Charged after successful scan delivery. GateTest never merges PRs automatically.
          </p>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] px-6 py-8 mt-16">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/30">
          <span>GateTest &copy; 2026</span>
          <div className="flex items-center gap-6">
            <Link href="/compare/sonarqube" className="hover:text-white/60 transition-colors">vs SonarQube</Link>
            <Link href="/compare/snyk" className="hover:text-white/60 transition-colors">vs Snyk</Link>
            <Link href="/for/nextjs" className="hover:text-white/60 transition-colors">For Next.js</Link>
            <Link href="/for/typescript" className="hover:text-white/60 transition-colors">For TypeScript</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
