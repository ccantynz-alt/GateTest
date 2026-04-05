/**
 * Links Module - Broken link detection for internal and external links.
 * Crawls HTML files and validates all href/src references.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class LinksModule extends BaseModule {
  constructor() {
    super('links', 'Broken Link Detection');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const linksConfig = config.getModuleConfig('links');
    const htmlFiles = this._collectFiles(projectRoot, ['.html']);

    if (htmlFiles.length === 0) {
      result.addCheck('links:files', true, { message: 'No HTML files to check' });
      return;
    }

    const internalLinks = new Set();
    const externalLinks = new Set();
    const brokenInternal = [];

    for (const file of htmlFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');

      // Extract all links
      const hrefRegex = /(?:href|src)\s*=\s*["']([^"'#]+)/gi;
      let match;
      while ((match = hrefRegex.exec(content)) !== null) {
        const link = match[1].trim();

        if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('//')) {
          externalLinks.add(link);
        } else if (link.startsWith('mailto:') || link.startsWith('tel:') || link.startsWith('data:') || link.startsWith('javascript:')) {
          // Skip non-resource links
        } else {
          internalLinks.add({ href: link, source: relPath });
        }
      }
    }

    // Validate internal links
    for (const { href, source } of internalLinks) {
      const resolved = path.resolve(path.dirname(path.join(projectRoot, source)), href);
      if (!fs.existsSync(resolved)) {
        brokenInternal.push({ href, source });
      }
    }

    if (brokenInternal.length > 0) {
      result.addCheck('links:internal', false, {
        message: `${brokenInternal.length} broken internal link(s)`,
        details: brokenInternal.slice(0, 20),
        suggestion: 'Fix or remove broken internal links',
      });
    } else {
      result.addCheck('links:internal', true, {
        message: `${internalLinks.size} internal links verified`,
      });
    }

    // External links: report count (actual HTTP checks need network access)
    result.addCheck('links:external-count', true, {
      message: `${externalLinks.size} external links found — use "gatetest --check-external" to validate`,
    });

    // Check for javascript: links (security issue)
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (/href\s*=\s*["']javascript:/i.test(content)) {
        result.addCheck(`links:javascript-href:${path.relative(projectRoot, file)}`, false, {
          file: path.relative(projectRoot, file),
          message: 'javascript: protocol in href — security risk',
          suggestion: 'Replace javascript: links with proper event handlers',
        });
      }
    }
  }
}

module.exports = LinksModule;
