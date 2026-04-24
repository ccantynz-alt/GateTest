import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Python Code Quality & Security — GateTest",
  description:
    "GateTest scans Python for naive datetime bugs, PII in logs, float-money anti-patterns, TLS bypass, and Django/Flask/FastAPI security misconfigs. Multi-language in one tool.",
  keywords: [
    "Python code quality",
    "Python security scanning",
    "Django security",
    "Flask security",
    "FastAPI security",
    "Python naive datetime",
    "Python PII logs",
    "Python CI quality gate",
    "Python static analysis",
  ],
  alternates: {
    canonical: "https://gatetest.ai/for/python",
  },
  openGraph: {
    title: "Python Code Quality & Security — GateTest",
    description:
      "GateTest scans Python for naive datetime bugs, PII in logs, float-money anti-patterns, TLS bypass, and Django/Flask/FastAPI security misconfigs. Multi-language in one tool.",
    url: "https://gatetest.ai/for/python",
    siteName: "GateTest",
    type: "website",
  },
};

const faqItems = [
  {
    q: "What Python-specific bugs does GateTest find?",
    a: "GateTest has deep Python support across multiple modules: datetime.now() without tz= argument (naive datetime — CI and prod use different timezones), datetime.utcnow() (deprecated in Python 3.12+, returns naive), float() on money-named variables (float precision drift), verify=False / ssl._create_unverified_context() (TLS bypass), print(password) / logger.info(user) (PII in logs), SESSION_COOKIE_SECURE=False / SESSION_COOKIE_HTTPONLY=False (Django/Flask config misconfigs), and more.",
  },
  {
    q: "Does GateTest scan Django, Flask, and FastAPI security configs?",
    a: "Yes. The cookieSecurity module catches Django SESSION_COOKIE_SECURE=False, SESSION_COOKIE_HTTPONLY=False, CSRF_COOKIE_SECURE=False, CSRF_COOKIE_HTTPONLY=False. For Flask and FastAPI, it catches response.set_cookie() / Starlette cookie helpers with httponly=False as a keyword argument (regex requires a [,( prefix to ensure it's an argument, not a type annotation). The tlsSecurity module catches Python requests.get(url, verify=False), httpx verify_ssl=False, aiohttp ssl=False, and urllib3 CERT_NONE.",
  },
  {
    q: "How does GateTest detect naive datetime bugs in Python?",
    a: "The datetimeBug module catches two Python-specific patterns: datetime.now() without a tz= argument (error — returns a naive datetime that silently uses the local timezone, which differs between CI runners, Docker containers, and production) and datetime.utcnow() (error — deprecated in Python 3.12+, still returns naive even though the name suggests UTC, and anything that checks tzinfo is None will silently treat it as local time). The fix in both cases is datetime.now(timezone.utc).",
  },
  {
    q: "Does GateTest catch PII leaking into Python logs?",
    a: "Yes. The logPii module detects logger calls across print(), logging.info()/debug()/warning()/error(), logger.*, log.*, and structlog with sensitive identifiers: password, passwd, token, apiKey, secret, credential, authorization, accessToken, jwt, cookie, ssn, creditCard, cvv, pin, privateKey (error: py-print-sensitive) and object-dump identifiers: req, request, body, payload, user, member, account, headers, cookies, session, formData (warning: py-object-dump). Triple-quoted Python docstrings are stripped before matching so documentation examples don't false-positive.",
  },
  {
    q: "Does GateTest find float-money bugs in Python?",
    a: "Yes. The moneyFloat module catches money-named variables (price, total, amount, tax, fee, subtotal, balance, discount, and ISO currency codes usd/eur/gbp/jpy etc.) assigned from float() in Python. Safe if the file imports Python's decimal stdlib (from decimal import Decimal / import decimal). The fix is to use Decimal('0.10') instead of float(0.10) — Decimal stores exactly, float does not.",
  },
  {
    q: "Does GateTest scan Python dependency files?",
    a: "Yes. The dependencies module covers pip's requirements.txt, Pipenv's Pipfile, Poetry's pyproject.toml, and Conda environment.yml. It flags wildcard version pins (requests>=2.0,<3.0 is fine, requests>=2.0 with no upper bound warns), == pinning without a lockfile (warn — reproducibility risk), and packages marked deprecated in the Python ecosystem. All checks run with zero network calls against bundled data.",
  },
];

const pythonChecks = [
  {
    module: "datetimeBug",
    label: "Naive Datetime Detection",
    examples: [
      { bad: "datetime.now()", good: "datetime.now(timezone.utc)", why: "CI and prod use different timezones" },
      { bad: "datetime.utcnow()", good: "datetime.now(timezone.utc)", why: "Deprecated Python 3.12+, still naive" },
    ],
  },
  {
    module: "tlsSecurity",
    label: "TLS Bypass Detection",
    examples: [
      { bad: "requests.get(url, verify=False)", good: "requests.get(url)  # uses system certs", why: "MITM-vulnerable in production" },
      { bad: "ssl._create_unverified_context()", good: "ssl.create_default_context()", why: "Nuclear disable of cert validation" },
    ],
  },
  {
    module: "moneyFloat",
    label: "Float Money Anti-Pattern",
    examples: [
      { bad: "price = float(request.data['amount'])", good: "from decimal import Decimal\nprice = Decimal(request.data['amount'])", why: "IEEE-754 float loses cents at scale" },
    ],
  },
  {
    module: "cookieSecurity",
    label: "Django/Flask Cookie Misconfigs",
    examples: [
      { bad: "SESSION_COOKIE_SECURE = False", good: "SESSION_COOKIE_SECURE = True", why: "Cookie rides over HTTP, interceptable" },
      { bad: "SESSION_COOKIE_HTTPONLY = False", good: "SESSION_COOKIE_HTTPONLY = True", why: "XSS can read session cookie" },
    ],
  },
];

export default function PythonPage() {
  const jsonLd = {
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
          <span className="text-white/60">For</span>
          <span>/</span>
          <span className="text-white/60">Python</span>
        </nav>

        {/* Hero */}
        <div className="mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-xs text-teal-400 font-medium mb-6">
            Language-specific scanning
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-6">
            Python Code Quality
            <br />
            <span className="text-teal-400">& Security Scanning</span>
          </h1>
          <p className="text-lg text-white/60 max-w-2xl leading-relaxed">
            Python has a specific failure-mode profile: naive datetime objects that silently use the
            wrong timezone, float money that drifts under regulatory scrutiny, TLS bypasses left in
            from staging, and Django/Flask/FastAPI security flags that default to insecure.
            GateTest catches all of it — in the same scan as your JS, TS, and infrastructure.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold text-sm"
              style={{ background: "#2dd4bf", color: "#0a0a12" }}
            >
              Scan My Python App — From $29
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold text-sm border border-white/15 text-white/70 hover:border-white/30 hover:text-white transition-colors"
            >
              See All 67 Modules
            </Link>
          </div>
        </div>

        {/* Python-specific checks with before/after */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-white mb-8">Python-specific patterns GateTest catches</h2>
          <div className="space-y-6">
            {pythonChecks.map((check) => (
              <div
                key={check.module}
                className="rounded-xl border border-white/[0.08] p-5"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <code className="text-teal-400 text-xs font-mono">{check.module}</code>
                  <span className="text-white/70 text-sm font-semibold">{check.label}</span>
                </div>
                <div className="space-y-3">
                  {check.examples.map((ex) => (
                    <div key={ex.bad} className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-red-400 text-xs font-medium mb-1.5">&#10007; Flagged</div>
                        <pre className="text-red-300/70 text-xs font-mono bg-red-500/5 border border-red-500/15 rounded-lg p-3 overflow-x-auto">{ex.bad}</pre>
                        <p className="text-white/35 text-xs mt-1.5">{ex.why}</p>
                      </div>
                      <div>
                        <div className="text-emerald-400 text-xs font-medium mb-1.5">&#10003; Fixed</div>
                        <pre className="text-emerald-300/70 text-xs font-mono bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-3 overflow-x-auto">{ex.good}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Multi-language advantage */}
        <section className="mb-16 rounded-xl border border-teal-500/20 p-6" style={{ background: "rgba(20,184,166,0.04)" }}>
          <h2 className="text-xl font-bold text-white mb-4">One scan — all your languages</h2>
          <p className="text-white/60 text-sm leading-relaxed mb-4">
            Most Python security tools (Bandit, Semgrep community rules, Pylint) are Python-only.
            If your stack is Django backend + Next.js frontend + GitHub Actions CI, you need
            three separate tools. GateTest scans all of them in one pass:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["Python (Django/Flask/FastAPI)", "JavaScript / TypeScript", "GitHub Actions CI", "Dockerfile + Docker Compose", "Terraform / Kubernetes", "Shell scripts", "SQL migrations", "Env var contracts"].map((lang) => (
              <div key={lang} className="flex items-center gap-2 text-xs text-white/55">
                <span className="text-teal-400 shrink-0">&#10003;</span>
                {lang}
              </div>
            ))}
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
            One gate. All your languages.
          </h2>
          <p className="text-white/60 mb-8 max-w-xl mx-auto">
            Python, TypeScript, Go, Rust, Java — GateTest covers your full stack in one scan. Pay only when results are delivered.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-8 py-4 rounded-xl font-semibold"
            style={{ background: "#2dd4bf", color: "#0a0a12" }}
          >
            Scan My Python App — From $29
          </Link>
          <p className="text-white/30 text-xs mt-6">
            Card hold only. Charged after successful scan delivery.
          </p>
        </section>
      </main>

      <footer className="border-t border-white/[0.06] px-6 py-8 mt-16">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-white/30">
          <span>GateTest &copy; 2026</span>
          <div className="flex items-center gap-6">
            <Link href="/for/nextjs" className="hover:text-white/60 transition-colors">Next.js</Link>
            <Link href="/for/typescript" className="hover:text-white/60 transition-colors">TypeScript</Link>
            <Link href="/for/nodejs" className="hover:text-white/60 transition-colors">Node.js</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
