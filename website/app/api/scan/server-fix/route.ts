/**
 * Server Fix Generator — produce ready-to-paste configs for server scan issues.
 *
 * POST /api/scan/server-fix
 * Body: { hostname: string, modules: ModuleResult[] }
 *
 * Returns config snippets the user can paste into their server setup.
 * Covers: security headers, HSTS, CSP, DMARC, SPF, compression, redirects.
 */

import { NextRequest, NextResponse } from "next/server";

interface ModResult {
  name: string;
  label?: string;
  status: string;
  details: string[];
}

interface FixSnippet {
  platform: string;
  title: string;
  code: string;
  instructions: string;
}

function generateHeaderFixes(details: string[]): FixSnippet[] {
  const missing = new Set<string>();
  for (const d of details) {
    if (d.includes("Missing HSTS") || d.toLowerCase().includes("missing strict-transport")) missing.add("hsts");
    if (d.includes("Missing X-Content-Type-Options")) missing.add("xcontent");
    if (d.includes("Missing X-Frame-Options")) missing.add("xframe");
    if (d.includes("Missing CSP") || d.includes("Missing Content-Security-Policy")) missing.add("csp");
    if (d.includes("Missing Referrer-Policy")) missing.add("referrer");
    if (d.includes("Missing Permissions-Policy")) missing.add("permissions");
    if (d.includes("HSTS missing includeSubDomains")) missing.add("hsts-subdomains");
  }

  if (missing.size === 0) return [];

  const nextHeaders: string[] = [];
  const vercelHeaders: Array<{ key: string; value: string }> = [];
  const nginxLines: string[] = [];
  const netlifyLines: string[] = [];

  if (missing.has("hsts") || missing.has("hsts-subdomains")) {
    const value = "max-age=63072000; includeSubDomains; preload";
    nextHeaders.push(`{ key: "Strict-Transport-Security", value: "${value}" }`);
    vercelHeaders.push({ key: "Strict-Transport-Security", value });
    nginxLines.push(`add_header Strict-Transport-Security "${value}" always;`);
    netlifyLines.push(`  Strict-Transport-Security: ${value}`);
  }
  if (missing.has("xcontent")) {
    nextHeaders.push(`{ key: "X-Content-Type-Options", value: "nosniff" }`);
    vercelHeaders.push({ key: "X-Content-Type-Options", value: "nosniff" });
    nginxLines.push(`add_header X-Content-Type-Options "nosniff" always;`);
    netlifyLines.push(`  X-Content-Type-Options: nosniff`);
  }
  if (missing.has("xframe")) {
    nextHeaders.push(`{ key: "X-Frame-Options", value: "SAMEORIGIN" }`);
    vercelHeaders.push({ key: "X-Frame-Options", value: "SAMEORIGIN" });
    nginxLines.push(`add_header X-Frame-Options "SAMEORIGIN" always;`);
    netlifyLines.push(`  X-Frame-Options: SAMEORIGIN`);
  }
  if (missing.has("csp")) {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none';";
    nextHeaders.push(`{ key: "Content-Security-Policy", value: "${csp}" }`);
    vercelHeaders.push({ key: "Content-Security-Policy", value: csp });
    nginxLines.push(`add_header Content-Security-Policy "${csp}" always;`);
    netlifyLines.push(`  Content-Security-Policy: ${csp}`);
  }
  if (missing.has("referrer")) {
    nextHeaders.push(`{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }`);
    vercelHeaders.push({ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" });
    nginxLines.push(`add_header Referrer-Policy "strict-origin-when-cross-origin" always;`);
    netlifyLines.push(`  Referrer-Policy: strict-origin-when-cross-origin`);
  }
  if (missing.has("permissions")) {
    const perms = "camera=(), microphone=(), geolocation=(), interest-cohort=()";
    nextHeaders.push(`{ key: "Permissions-Policy", value: "${perms}" }`);
    vercelHeaders.push({ key: "Permissions-Policy", value: perms });
    nginxLines.push(`add_header Permissions-Policy "${perms}" always;`);
    netlifyLines.push(`  Permissions-Policy: ${perms}`);
  }

  const fixes: FixSnippet[] = [];

  fixes.push({
    platform: "Next.js (next.config.ts)",
    title: "Add to next.config.ts headers() function",
    code: `async headers() {
  return [
    {
      source: "/:path*",
      headers: [
${nextHeaders.map(h => "        " + h + ",").join("\n")}
      ],
    },
  ];
},`,
    instructions: "Add this headers() function inside your nextConfig object, then redeploy.",
  });

  fixes.push({
    platform: "Vercel (vercel.json)",
    title: "Add to vercel.json",
    code: JSON.stringify({
      headers: [{
        source: "/(.*)",
        headers: vercelHeaders,
      }],
    }, null, 2),
    instructions: "Add this to vercel.json in your project root, commit, and redeploy.",
  });

  fixes.push({
    platform: "Nginx",
    title: "Add to your nginx server block",
    code: nginxLines.join("\n"),
    instructions: "Add these lines inside your server { } block, then run: sudo nginx -t && sudo systemctl reload nginx",
  });

  fixes.push({
    platform: "Netlify (_headers file)",
    title: "Create/update public/_headers",
    code: `/*\n${netlifyLines.join("\n")}`,
    instructions: "Create a file at public/_headers (or your publish directory) with this content.",
  });

  return fixes;
}

function generateDnsFixes(details: string[], hostname: string): FixSnippet[] {
  const fixes: FixSnippet[] = [];

  if (details.some(d => d.includes("No SPF"))) {
    fixes.push({
      platform: "DNS (SPF)",
      title: `Add TXT record for ${hostname}`,
      code: `Type:  TXT\nHost:  @ (or ${hostname})\nValue: "v=spf1 -all"\nTTL:   3600`,
      instructions: "Add this TXT record to your DNS. 'v=spf1 -all' rejects all email forgeries (use if you don't send email from this domain). If you DO send email, replace -all with include:yourprovider.com -all.",
    });
  }

  if (details.some(d => d.includes("No DMARC"))) {
    fixes.push({
      platform: "DNS (DMARC)",
      title: `Add TXT record for _dmarc.${hostname}`,
      code: `Type:  TXT\nHost:  _dmarc (or _dmarc.${hostname})\nValue: "v=DMARC1; p=reject; rua=mailto:dmarc@${hostname}"\nTTL:   3600`,
      instructions: "Add this TXT record at the _dmarc subdomain. This rejects all unauthenticated email claiming to be from your domain.",
    });
  }

  return fixes;
}

function generatePerformanceFixes(details: string[]): FixSnippet[] {
  const fixes: FixSnippet[] = [];

  if (details.some(d => d.includes("No compression"))) {
    fixes.push({
      platform: "Nginx (gzip)",
      title: "Enable gzip compression",
      code: `gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript
           application/x-javascript application/javascript
           application/json application/xml+rss
           application/atom+xml image/svg+xml;`,
      instructions: "Add to your nginx.conf http { } block, then run: sudo nginx -t && sudo systemctl reload nginx",
    });

    fixes.push({
      platform: "Vercel / Next.js",
      title: "Already handled automatically",
      code: "// Vercel enables gzip + brotli automatically for all responses.\n// If you're seeing 'No compression' on Vercel, check your next.config headers() isn't overriding Content-Encoding.",
      instructions: "No action needed on Vercel. If deployed and still missing, this is a Vercel-side issue to report.",
    });

    fixes.push({
      platform: "Apache (mod_deflate)",
      title: "Enable compression in .htaccess",
      code: `<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css
  AddOutputFilterByType DEFLATE application/javascript application/json
  AddOutputFilterByType DEFLATE image/svg+xml
</IfModule>`,
      instructions: "Add to your .htaccess or Apache config. Ensure mod_deflate is enabled: sudo a2enmod deflate",
    });
  }

  if (details.some(d => d.includes("TTFB"))) {
    fixes.push({
      platform: "Server-side optimization",
      title: "TTFB optimization checklist",
      code: `# TTFB > 800ms means your server is slow to start responding.
# Common causes and fixes:

1. Cold starts (serverless)
   → Use Edge runtime where possible (Next.js: export const runtime = 'edge')
   → Keep functions warm with a cron ping every 5 min

2. Slow database queries
   → Add indexes on frequently queried columns
   → Use a connection pool (don't create new DB connections per request)
   → Cache read-heavy queries (Redis, Vercel KV)

3. Unoptimized rendering
   → Convert to Static Generation (getStaticProps / generateStaticParams)
   → Use ISR with revalidate for semi-static content

4. Geographic distance
   → Use a CDN in front of your origin
   → Deploy to multiple regions`,
      instructions: "These are systemic optimizations, not config snippets. Review each area.",
    });
  }

  return fixes;
}

function generateAvailabilityFixes(details: string[], hostname: string): FixSnippet[] {
  const fixes: FixSnippet[] = [];

  if (details.some(d => d.includes("HTTP does not redirect to HTTPS"))) {
    fixes.push({
      platform: "Nginx",
      title: "Force HTTPS redirect",
      code: `server {
    listen 80;
    server_name ${hostname};
    return 301 https://$host$request_uri;
}`,
      instructions: "Add this server block to your nginx config. All HTTP traffic will 301 to HTTPS.",
    });

    fixes.push({
      platform: "Apache (.htaccess)",
      title: "Force HTTPS redirect",
      code: `RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]`,
      instructions: "Add to your .htaccess file.",
    });
  }

  return fixes;
}

export async function POST(req: NextRequest) {
  let body: { hostname?: string; modules?: ModResult[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const hostname = body.hostname || "your-domain.com";
  const modules = body.modules || [];

  const allFixes: Record<string, FixSnippet[]> = {};

  for (const mod of modules) {
    const details = mod.details || [];
    if (mod.status === "passed") continue;

    if (mod.name === "headers") {
      const headerFixes = generateHeaderFixes(details);
      if (headerFixes.length > 0) allFixes["Security Headers"] = headerFixes;
    } else if (mod.name === "dns") {
      const dnsFixes = generateDnsFixes(details, hostname);
      if (dnsFixes.length > 0) allFixes["DNS / Email Security"] = dnsFixes;
    } else if (mod.name === "performance") {
      const perfFixes = generatePerformanceFixes(details);
      if (perfFixes.length > 0) allFixes["Performance"] = perfFixes;
    } else if (mod.name === "availability") {
      const availFixes = generateAvailabilityFixes(details, hostname);
      if (availFixes.length > 0) allFixes["Availability"] = availFixes;
    } else if (mod.name === "ssl") {
      allFixes["SSL / TLS"] = [{
        platform: "Let's Encrypt (certbot)",
        title: "Install/renew SSL certificate",
        code: `sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d ${hostname} -d www.${hostname}
sudo systemctl enable certbot.timer`,
        instructions: "Free SSL via Let's Encrypt. Auto-renews every 90 days. Requires nginx to already be running.",
      }];
    }
  }

  return NextResponse.json({
    hostname,
    categories: Object.keys(allFixes).length,
    totalFixes: Object.values(allFixes).reduce((s, f) => s + f.length, 0),
    fixes: allFixes,
  });
}
