/**
 * Cache Headers Module — validates that cache configuration is set correctly
 * across Next.js, Vercel, Netlify, nginx, Express/Fastify source.
 * Flags missing Cache-Control on static assets and API routes,
 * misconfigured CDN settings, and stale-while-revalidate opportunities.
 */

const BaseModule = require('./base-module');
const fs   = require('fs');
const path = require('path');

class CacheHeadersModule extends BaseModule {
  constructor() { super('cacheHeaders', 'Cache Headers & CDN Configuration'); }

  async run(result, config) {
    const root = config.projectRoot;

    this._checkNextConfig(root, result);
    this._checkVercelJson(root, result);
    this._checkNetlifyToml(root, result);
    this._checkNginxConf(root, result);
    this._checkExpressSource(root, result);
    this._checkApiRoutes(root, result);
  }

  _checkNextConfig(root, result) {
    const candidates = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
    const file = candidates.map(f => path.join(root, f)).find(f => fs.existsSync(f));
    if (!file) return;

    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);

    // Check headers() function exists
    if (!content.includes('headers')) {
      result.addCheck('nextjs-no-headers', false, {
        severity: 'warning',
        file,
        fix: `${rel}: No headers() config found. Static assets and API routes may not set Cache-Control.\nAdd:\n  async headers() { return [{ source: '/_next/static/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }] }`,
      });
    } else {
      // Look for cache-control in headers config
      if (!content.match(/cache-control/i) && !content.match(/max-age/i)) {
        result.addCheck('nextjs-empty-cache-headers', false, {
          severity: 'warning',
          file,
          fix: `${rel}: headers() found but no Cache-Control values set. Add Cache-Control for static assets.`,
        });
      } else {
        result.addCheck('nextjs-cache-headers', true, { severity: 'info', fix: 'next.config has Cache-Control headers configured' });
      }
    }

    // Check for stale-while-revalidate on ISR pages
    if (content.includes('revalidate') && !content.includes('stale-while-revalidate')) {
      result.addCheck('nextjs-missing-swr', false, {
        severity: 'info',
        file,
        fix: `${rel}: ISR revalidate found but no stale-while-revalidate header. Add s-maxage + stale-while-revalidate for better CDN behaviour.`,
      });
    }
  }

  _checkVercelJson(root, result) {
    const file = path.join(root, 'vercel.json');
    if (!fs.existsSync(file)) return;

    let config;
    try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }

    const headers = config.headers || [];
    const hasStaticCache = headers.some(h =>
      (h.source || '').includes('_next/static') || (h.source || '').includes('.css') || (h.source || '').includes('.js')
    );

    if (!hasStaticCache) {
      result.addCheck('vercel-no-static-cache', false, {
        severity: 'warning',
        file,
        fix: `vercel.json: No cache headers for static assets. Add:\n  { "source": "/_next/static/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }`,
      });
    } else {
      result.addCheck('vercel-static-cache', true, { severity: 'info', fix: 'vercel.json has static asset cache headers' });
    }

    // Check for cache control on API routes (should be no-store or short max-age)
    const apiHeaders = headers.find(h => (h.source || '').includes('/api/'));
    if (!apiHeaders) {
      result.addCheck('vercel-api-cache', false, {
        severity: 'info',
        file,
        fix: `vercel.json: No cache headers for /api/* routes. Add no-store for dynamic data or short max-age for cacheable endpoints.`,
      });
    }
  }

  _checkNetlifyToml(root, result) {
    const file = path.join(root, 'netlify.toml');
    if (!fs.existsSync(file)) return;

    const content = fs.readFileSync(file, 'utf8');
    if (!content.match(/cache-control/i)) {
      result.addCheck('netlify-no-cache-headers', false, {
        severity: 'warning',
        file,
        fix: `netlify.toml: No Cache-Control headers configured. Add [[headers]] sections for static assets.`,
      });
    } else {
      result.addCheck('netlify-cache-headers', true, { severity: 'info', fix: 'netlify.toml has cache headers configured' });
    }
  }

  _checkNginxConf(root, result) {
    const candidates = ['nginx.conf', 'nginx/nginx.conf', 'config/nginx.conf', 'deploy/nginx.conf'];
    const file = candidates.map(f => path.join(root, f)).find(f => fs.existsSync(f));
    if (!file) return;

    const content = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);

    if (!content.match(/expires|cache-control/i)) {
      result.addCheck('nginx-no-cache', false, {
        severity: 'warning',
        file,
        fix: `${rel}: No cache headers (expires / add_header Cache-Control) found in nginx config.`,
      });
    } else {
      result.addCheck('nginx-cache', true, { severity: 'info', fix: 'nginx.conf has cache headers' });
    }

    // Check for proxy_cache_valid
    if (content.includes('proxy_pass') && !content.includes('proxy_cache')) {
      result.addCheck('nginx-no-proxy-cache', false, {
        severity: 'info',
        file,
        fix: `${rel}: proxy_pass found but no proxy_cache configured. Consider adding Nginx proxy cache for upstream responses.`,
      });
    }
  }

  _checkExpressSource(root, result) {
    const sourceFiles = this._glob(root, /\.(js|ts|mjs)$/, ['node_modules', '.next', 'dist', '.git', 'tests', '__tests__']);
    let foundExpressStatic = false;
    let foundCacheHeader = false;

    for (const file of sourceFiles) {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (content.includes('express.static') || content.includes('serveStatic')) foundExpressStatic = true;
      if (content.match(/Cache-Control/i) && content.match(/max-age/i)) foundCacheHeader = true;
    }

    if (foundExpressStatic && !foundCacheHeader) {
      result.addCheck('express-static-no-cache', false, {
        severity: 'warning',
        fix: `express.static() found but no Cache-Control header set. Add: express.static('public', { maxAge: '1y' }) for versioned assets.`,
      });
    }
  }

  _checkApiRoutes(root, result) {
    const routeFiles = this._glob(root, /app\/api\/.+\/route\.[jt]sx?$/, ['node_modules']);
    let uncachedCount = 0;

    for (const file of routeFiles) {
      let content;
      try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (!content.match(/Cache-Control|no-store|max-age/i)) uncachedCount++;
    }

    if (uncachedCount > 3) {
      result.addCheck('api-routes-no-cache', false, {
        severity: 'info',
        fix: `${uncachedCount} API route files have no Cache-Control header. Dynamic routes should set "Cache-Control: no-store". Cacheable routes should set "Cache-Control: max-age=N, s-maxage=N".`,
      });
    } else if (routeFiles.length > 0) {
      result.addCheck('api-routes-cache', true, { severity: 'info', fix: 'API routes have cache headers configured' });
    }
  }

  _glob(root, pattern, excludes = []) {
    const results = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (excludes.some(x => e.name === x || dir.includes(x))) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (pattern.test(full.replace(/\\/g, '/'))) results.push(full);
      }
    };
    walk(root);
    return results;
  }
}

module.exports = CacheHeadersModule;
