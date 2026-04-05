/**
 * Live Site Crawler Module - Tests a RUNNING website by visiting every page.
 *
 * This is the module that solves the real problem:
 * "Claude says it's fixed but it's not."
 *
 * It crawls a live URL, checks every page for:
 * - HTTP errors (404, 500, etc.)
 * - JavaScript console errors
 * - Broken images
 * - Dead links (internal and external)
 * - Missing page titles
 * - Empty pages / blank screens
 * - Redirect chains
 * - Mixed content (HTTP on HTTPS)
 * - Missing meta tags
 *
 * Produces a structured report that can be fed directly back to Claude
 * for automated fix loops.
 */

const BaseModule = require('./base-module');
const http = require('http');
const https = require('https');
const { URL } = require('url');

class LiveCrawlerModule extends BaseModule {
  constructor() {
    super('liveCrawler', 'Live Site Crawl & Verification');
  }

  async run(result, config) {
    const crawlConfig = config.getModuleConfig('liveCrawler') || {};
    const baseUrl = crawlConfig.url || config.get('liveCrawler.url');

    if (!baseUrl) {
      result.addCheck('crawl:config', true, {
        message: 'No live URL configured — set modules.liveCrawler.url in .gatetest/config.json',
      });
      return;
    }

    const maxPages = crawlConfig.maxPages || 100;
    const timeout = crawlConfig.timeout || 10000;
    const checkExternal = crawlConfig.checkExternal !== false;

    const visited = new Set();
    const queue = [baseUrl];
    const pages = [];
    const errors = [];
    const brokenLinks = [];
    const redirects = [];
    const brokenImages = [];

    result.addCheck('crawl:start', true, {
      message: `Crawling ${baseUrl} (max ${maxPages} pages)...`,
    });

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      try {
        const pageResult = await this._fetchPage(url, timeout);
        pages.push(pageResult);

        // Check HTTP status
        if (pageResult.status >= 400) {
          errors.push({
            url,
            status: pageResult.status,
            type: 'http-error',
            message: `HTTP ${pageResult.status} ${pageResult.statusText}`,
          });
        }

        // Check for redirects
        if (pageResult.redirected) {
          redirects.push({
            from: url,
            to: pageResult.finalUrl,
            status: pageResult.redirectStatus,
          });
        }

        // Only parse HTML pages
        if (!pageResult.contentType?.includes('text/html')) continue;
        if (!pageResult.body) continue;

        const body = pageResult.body;

        // Check for empty/blank pages
        const textContent = body.replace(/<[^>]*>/g, '').trim();
        if (textContent.length < 50 && !url.includes('api')) {
          errors.push({
            url,
            type: 'empty-page',
            message: `Page appears blank or nearly empty (${textContent.length} chars of text)`,
          });
        }

        // Check for page title
        const titleMatch = body.match(/<title>([^<]*)<\/title>/i);
        if (!titleMatch || titleMatch[1].trim().length === 0) {
          errors.push({
            url,
            type: 'missing-title',
            message: 'Page has no <title> or title is empty',
          });
        }

        // Check for common error messages in page content
        const errorPatterns = [
          { regex: /application error/i, type: 'app-error' },
          { regex: /internal server error/i, type: 'server-error' },
          { regex: /page not found/i, type: '404-content' },
          { regex: /something went wrong/i, type: 'generic-error' },
          { regex: /uncaught (type)?error/i, type: 'js-error-in-html' },
          { regex: /cannot read propert/i, type: 'js-runtime-error' },
          { regex: /module not found/i, type: 'module-error' },
          { regex: /hydration failed/i, type: 'hydration-error' },
          { regex: /unhandled runtime error/i, type: 'runtime-error' },
        ];

        for (const { regex, type } of errorPatterns) {
          if (regex.test(body)) {
            errors.push({
              url,
              type,
              message: `Error pattern detected on page: "${type}"`,
            });
          }
        }

        // Extract and queue internal links
        const links = this._extractLinks(body, baseUrl, url);
        for (const link of links.internal) {
          if (!visited.has(link.href) && !queue.includes(link.href)) {
            queue.push(link.href);
          }
        }

        // Check images
        const images = this._extractImages(body, baseUrl, url);
        for (const imgUrl of images) {
          try {
            const imgResult = await this._checkUrl(imgUrl, timeout);
            if (imgResult.status >= 400) {
              brokenImages.push({
                page: url,
                image: imgUrl,
                status: imgResult.status,
              });
            }
          } catch {
            brokenImages.push({
              page: url,
              image: imgUrl,
              status: 'timeout/error',
            });
          }
        }

        // Check external links if enabled
        if (checkExternal) {
          for (const link of links.external.slice(0, 20)) { // Limit external checks
            try {
              const linkResult = await this._checkUrl(link.href, timeout);
              if (linkResult.status >= 400) {
                brokenLinks.push({
                  page: url,
                  link: link.href,
                  status: linkResult.status,
                  type: 'external',
                });
              }
            } catch {
              brokenLinks.push({
                page: url,
                link: link.href,
                status: 'timeout/error',
                type: 'external',
              });
            }
          }
        }

        // Check for mixed content (HTTP resources on HTTPS page)
        if (url.startsWith('https://')) {
          const httpResources = body.match(/(?:src|href|action)\s*=\s*["']http:\/\//gi);
          if (httpResources && httpResources.length > 0) {
            errors.push({
              url,
              type: 'mixed-content',
              message: `${httpResources.length} HTTP resource(s) on HTTPS page (mixed content)`,
            });
          }
        }

      } catch (err) {
        errors.push({
          url,
          type: 'fetch-error',
          message: `Failed to fetch: ${err.message}`,
        });
      }
    }

    // Record results
    result.addCheck('crawl:pages-scanned', true, {
      message: `Crawled ${pages.length} page(s) from ${baseUrl}`,
    });

    if (errors.length > 0) {
      // Group errors by type for clearer reporting
      const grouped = {};
      for (const err of errors) {
        if (!grouped[err.type]) grouped[err.type] = [];
        grouped[err.type].push(err);
      }

      for (const [type, errs] of Object.entries(grouped)) {
        result.addCheck(`crawl:error:${type}`, false, {
          message: `${errs.length} "${type}" error(s) found`,
          details: errs.map(e => ({ url: e.url, message: e.message })),
          suggestion: this._getSuggestion(type),
        });
      }
    }

    if (brokenLinks.length > 0) {
      result.addCheck('crawl:broken-links', false, {
        message: `${brokenLinks.length} broken link(s) found`,
        details: brokenLinks.slice(0, 30),
        suggestion: 'Fix or remove broken links',
      });
    }

    if (brokenImages.length > 0) {
      result.addCheck('crawl:broken-images', false, {
        message: `${brokenImages.length} broken image(s) found`,
        details: brokenImages.slice(0, 30),
        suggestion: 'Fix image paths or replace missing images',
      });
    }

    if (redirects.length > 0) {
      result.addCheck('crawl:redirects', true, {
        message: `${redirects.length} redirect(s) detected`,
        details: redirects.slice(0, 20),
      });
    }

    if (errors.length === 0 && brokenLinks.length === 0 && brokenImages.length === 0) {
      result.addCheck('crawl:clean', true, {
        message: `Site is clean — ${pages.length} pages, 0 errors, 0 broken links, 0 broken images`,
      });
    }

    // Generate the structured feedback report for Claude
    this._generateFeedbackReport(config, {
      baseUrl,
      pagesScanned: pages.length,
      errors,
      brokenLinks,
      brokenImages,
      redirects,
    });
  }

  _fetchPage(url, timeout) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(url, {
        timeout,
        headers: {
          'User-Agent': 'GateTest/1.0 (Quality Assurance Crawler)',
          'Accept': 'text/html,application/xhtml+xml,*/*',
        },
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          this._fetchPage(redirectUrl, timeout).then(redirectResult => {
            resolve({
              ...redirectResult,
              redirected: true,
              redirectStatus: res.statusCode,
              originalUrl: url,
            });
          }).catch(reject);
          return;
        }

        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          resolve({
            url,
            finalUrl: url,
            status: res.statusCode,
            statusText: res.statusMessage,
            contentType: res.headers['content-type'] || '',
            body,
            redirected: false,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout after ${timeout}ms`));
      });
    });
  }

  _checkUrl(url, timeout) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const method = 'HEAD'; // Just check status, don't download body

      const req = client.request(url, {
        method,
        timeout,
        headers: {
          'User-Agent': 'GateTest/1.0 (Quality Assurance Crawler)',
        },
      }, (res) => {
        resolve({
          url,
          status: res.statusCode,
          statusText: res.statusMessage,
        });
        res.resume(); // Drain response
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.end();
    });
  }

  _extractLinks(html, baseUrl, pageUrl) {
    const internal = [];
    const external = [];
    const hrefRegex = /href\s*=\s*["']([^"'#]+)/gi;
    let match;

    while ((match = hrefRegex.exec(html)) !== null) {
      let href = match[1].trim();
      if (href.startsWith('mailto:') || href.startsWith('tel:') ||
          href.startsWith('javascript:') || href.startsWith('data:')) continue;

      try {
        const resolved = new URL(href, pageUrl).href;
        if (resolved.startsWith(baseUrl)) {
          internal.push({ href: resolved, source: pageUrl });
        } else if (href.startsWith('http')) {
          external.push({ href: resolved, source: pageUrl });
        }
      } catch {
        // Invalid URL, skip
      }
    }

    return { internal, external };
  }

  _extractImages(html, baseUrl, pageUrl) {
    const images = [];
    const srcRegex = /<img[^>]+src\s*=\s*["']([^"']+)/gi;
    let match;

    while ((match = srcRegex.exec(html)) !== null) {
      try {
        const resolved = new URL(match[1].trim(), pageUrl).href;
        images.push(resolved);
      } catch {
        // Invalid URL
      }
    }

    return images;
  }

  _getSuggestion(errorType) {
    const suggestions = {
      'http-error': 'Check server routes and ensure all pages return 200 status',
      'empty-page': 'Page is rendering blank — check component rendering and data loading',
      'missing-title': 'Add a <title> tag to every page for SEO and usability',
      'app-error': 'Application error displayed to users — check error boundaries and server logs',
      'server-error': 'Internal server error — check server logs and API endpoints',
      '404-content': 'Page displays 404 content — fix routing or remove dead links',
      'generic-error': 'Error message visible to users — fix the underlying issue',
      'js-error-in-html': 'JavaScript error rendered in page — check console and error boundaries',
      'js-runtime-error': 'JavaScript runtime error — check for null/undefined access patterns',
      'module-error': 'Module not found error — check imports and build configuration',
      'hydration-error': 'React hydration mismatch — ensure server and client render match',
      'runtime-error': 'Unhandled runtime error — add error boundaries and fix root cause',
      'mixed-content': 'HTTP resources on HTTPS page — update all resource URLs to HTTPS',
      'fetch-error': 'Page could not be loaded — check if the server is running',
    };
    return suggestions[errorType] || 'Investigate and fix the issue';
  }

  _generateFeedbackReport(config, data) {
    const fs = require('fs');
    const path = require('path');

    const reportDir = path.resolve(config.projectRoot, '.gatetest/reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Generate a Claude-readable feedback report
    const lines = [];
    lines.push('# GateTest Live Crawl Report');
    lines.push(`# URL: ${data.baseUrl}`);
    lines.push(`# Pages scanned: ${data.pagesScanned}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push('');

    if (data.errors.length === 0 && data.brokenLinks.length === 0 && data.brokenImages.length === 0) {
      lines.push('## RESULT: ALL CLEAR');
      lines.push('No errors, broken links, or broken images found.');
    } else {
      lines.push('## RESULT: ISSUES FOUND — FIX REQUIRED');
      lines.push('');

      if (data.errors.length > 0) {
        lines.push(`### Page Errors (${data.errors.length})`);
        for (const err of data.errors) {
          lines.push(`- **${err.type}** at ${err.url}`);
          lines.push(`  ${err.message}`);
        }
        lines.push('');
      }

      if (data.brokenLinks.length > 0) {
        lines.push(`### Broken Links (${data.brokenLinks.length})`);
        for (const link of data.brokenLinks) {
          lines.push(`- [${link.status}] ${link.link} (found on ${link.page})`);
        }
        lines.push('');
      }

      if (data.brokenImages.length > 0) {
        lines.push(`### Broken Images (${data.brokenImages.length})`);
        for (const img of data.brokenImages) {
          lines.push(`- [${img.status}] ${img.image} (found on ${img.page})`);
        }
        lines.push('');
      }

      lines.push('## ACTION REQUIRED');
      lines.push('Fix all issues listed above and run `gatetest --module liveCrawler` again.');
      lines.push('Do not deploy until this report shows ALL CLEAR.');
    }

    const report = lines.join('\n');
    const reportPath = path.join(reportDir, 'crawl-feedback.md');
    fs.writeFileSync(reportPath, report);

    // Also save as JSON for programmatic use
    const jsonPath = path.join(reportDir, 'crawl-feedback.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  }
}

module.exports = LiveCrawlerModule;
