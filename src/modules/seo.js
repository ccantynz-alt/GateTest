/**
 * SEO Module - Search engine optimization validation.
 * Checks meta tags, structured data, sitemaps, canonical URLs, and more.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class SeoModule extends BaseModule {
  constructor() {
    super('seo', 'SEO & Metadata Validation');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const seoConfig = config.getModuleConfig('seo');
    const htmlFiles = this._collectFiles(projectRoot, ['.html']);

    // Static dev fixtures (e.g. website/public/logos.html — logo grid for
    // screenshots, not a customer-facing route) shouldn't be checked for
    // customer-facing SEO metadata.
    const INTERNAL_PATH_RE = /(?:^|\/)(?:website\/public\/)/;

    // Only FULL DOCUMENTS are pages. Measured 2026-08-18 across 9 real
    // repos: 59 of 69 flagged .html files were server-template fragments
    // (Thymeleaf/Jinja/swig partials, layouts, includes, email bodies) or
    // test fixtures with no <html>+<head> of their own — the metadata this
    // module looks for lives in the layout that wraps them, and 12 error
    // checks per fragment produced 446 blocking errors on repos that were
    // not even websites. A fragment is skipped, counted, and reported once
    // as info; it is never a finding.
    let fragmentsSkipped = 0;
    let pagesChecked = 0;
    for (const file of htmlFiles) {
      const relPath = path.relative(projectRoot, file);
      const normalised = relPath.replace(/\\/g, '/');
      if (INTERNAL_PATH_RE.test('/' + normalised)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      if (!SeoModule.isFullDocument(normalised, content)) {
        fragmentsSkipped++;
        continue;
      }
      pagesChecked++;

      this._checkTitle(relPath, content, seoConfig, result);
      this._checkMetaDescription(relPath, content, seoConfig, result);
      this._checkOpenGraph(relPath, content, result);
      this._checkTwitterCards(relPath, content, result);
      this._checkCanonical(relPath, content, result);
      this._checkStructuredData(relPath, content, result);
      this._checkHeadingSeo(relPath, content, result);
    }

    // Sitemap / robots only make sense for something that IS a deployed
    // site: a full-document page at a public root, or a framework app dir.
    // A library, CLI or API repo has neither and must not be told it is
    // missing a sitemap (this fired on express, flask, gin and sinatra).
    if (pagesChecked > 0 || SeoModule.looksLikeWebsite(projectRoot)) {
      this._checkSitemap(projectRoot, result);
      this._checkRobotsTxt(projectRoot, result);
    } else {
      result.addCheck('seo:site-files', true, {
        message: 'Not a deployable website (no full HTML documents or app router) — sitemap/robots checks not applicable',
      });
    }

    if (fragmentsSkipped > 0) {
      result.addCheck('seo:fragments', true, {
        message: `${fragmentsSkipped} HTML fragment/template file(s) skipped — metadata is checked on full documents only`,
      });
    }
    if (htmlFiles.length === 0) {
      result.addCheck('seo:files', true, { message: 'No HTML files to check' });
    }
  }

  /**
   * A file is a page (worth SEO checks) only when it is a complete document
   * that carries its own <html> and <head>. Template fragments, partials,
   * layouts-with-inheritance and fixtures are not pages.
   */
  static isFullDocument(normalisedPath, content) {
    const p = normalisedPath.toLowerCase();
    if (/(^|\/)(templates?|views?|partials?|fragments?|includes?|_includes|_layouts|layouts?|emails?|mail|components?|snippets?|__tests__|tests?|spec|fixtures?|test_apps?|testdata|__snapshots__|examples?|docs?_src|node_modules)\//.test(p)) {
      return false;
    }
    if (!/<html[\s>]/i.test(content) || !/<head[\s>]/i.test(content)) return false;
    // Template inheritance: the child declares extends/replace and inherits its head.
    if (/\{%\s*extends\b|th:replace=|th:insert=|<%-?\s*(layout|extends)\b|\{\{>\s*layout/i.test(content)) return false;
    return true;
  }

  /** Signals that this repository is (or contains) a deployable website. */
  static looksLikeWebsite(projectRoot) {
    const markers = [
      'index.html', 'public/index.html', 'static/index.html', 'dist/index.html',
      'app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'src/app/layout.tsx', 'website/app/layout.tsx',
      'pages/index.tsx', 'pages/index.jsx', 'pages/index.js', 'src/pages/index.tsx',
      'nuxt.config.ts', 'nuxt.config.js', 'svelte.config.js', 'astro.config.mjs', 'gatsby-config.js',
      '_config.yml', 'mkdocs.yml', 'docusaurus.config.js', 'docusaurus.config.ts', 'hugo.toml',
    ];
    return markers.some((m) => fs.existsSync(path.join(projectRoot, m)));
  }

  _checkTitle(relPath, content, config, result) {
    const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
    if (!titleMatch) {
      result.addCheck(`seo:title:${relPath}`, false, {
        file: relPath,
        message: 'Missing <title> tag',
        suggestion: 'Add a unique, descriptive <title> (50-60 characters)',
      });
      return;
    }

    const title = titleMatch[1].trim();
    const maxLength = config.maxTitleLength || 60;

    if (title.length === 0) {
      result.addCheck(`seo:title-empty:${relPath}`, false, {
        file: relPath,
        message: 'Empty <title> tag',
        suggestion: 'Add descriptive page title',
      });
    } else if (title.length > maxLength) {
      result.addCheck(`seo:title-length:${relPath}`, false, {
        file: relPath,
        expected: `<= ${maxLength} characters`,
        actual: `${title.length} characters`,
        message: 'Title too long — may be truncated in search results',
        suggestion: `Shorten title to ${maxLength} characters or less`,
      });
    } else {
      result.addCheck(`seo:title:${relPath}`, true);
    }
  }

  _checkMetaDescription(relPath, content, config, result) {
    const descMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) ||
                      content.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i);

    if (!descMatch) {
      result.addCheck(`seo:description:${relPath}`, false, {
        file: relPath,
        message: 'Missing meta description',
        suggestion: 'Add <meta name="description" content="..."> (150-160 characters)',
      });
      return;
    }

    const desc = descMatch[1].trim();
    const maxLength = config.maxDescriptionLength || 160;

    if (desc.length > maxLength) {
      result.addCheck(`seo:description-length:${relPath}`, false, {
        file: relPath,
        expected: `<= ${maxLength} characters`,
        actual: `${desc.length} characters`,
        suggestion: `Shorten description to ${maxLength} characters`,
      });
    } else {
      result.addCheck(`seo:description:${relPath}`, true);
    }
  }

  _checkOpenGraph(relPath, content, result) {
    const ogTags = ['og:title', 'og:description', 'og:image', 'og:url'];
    for (const tag of ogTags) {
      const hasTag = new RegExp(`property=["']${tag}["']`, 'i').test(content) ||
                     new RegExp(`name=["']${tag}["']`, 'i').test(content);
      if (!hasTag) {
        result.addCheck(`seo:${tag}:${relPath}`, false, {
          file: relPath,
          message: `Missing Open Graph tag: ${tag}`,
          suggestion: `Add <meta property="${tag}" content="...">`,
        });
      }
    }
  }

  _checkTwitterCards(relPath, content, result) {
    const twitterTags = ['twitter:card', 'twitter:title', 'twitter:description'];
    for (const tag of twitterTags) {
      if (!content.includes(tag)) {
        result.addCheck(`seo:${tag}:${relPath}`, false, {
          file: relPath,
          message: `Missing Twitter Card tag: ${tag}`,
          suggestion: `Add <meta name="${tag}" content="...">`,
        });
      }
    }
  }

  _checkCanonical(relPath, content, result) {
    if (!/<link\s+[^>]*rel=["']canonical["']/i.test(content)) {
      result.addCheck(`seo:canonical:${relPath}`, false, {
        file: relPath,
        message: 'Missing canonical URL',
        suggestion: 'Add <link rel="canonical" href="...">',
      });
    }
  }

  _checkStructuredData(relPath, content, result) {
    const hasJsonLd = content.includes('application/ld+json');
    const hasMicrodata = content.includes('itemscope') || content.includes('itemtype');

    if (!hasJsonLd && !hasMicrodata) {
      result.addCheck(`seo:structured-data:${relPath}`, false, {
        file: relPath,
        message: 'No structured data (JSON-LD or microdata) found',
        suggestion: 'Add JSON-LD structured data for rich search results',
      });
    }
  }

  _checkHeadingSeo(relPath, content, result) {
    const h1Count = (content.match(/<h1\b/gi) || []).length;
    if (h1Count === 0) {
      result.addCheck(`seo:h1-missing:${relPath}`, false, {
        file: relPath,
        message: 'No <h1> tag found',
        suggestion: 'Add a single <h1> tag with the primary page topic',
      });
    } else if (h1Count > 1) {
      result.addCheck(`seo:h1-multiple:${relPath}`, false, {
        file: relPath,
        message: `${h1Count} <h1> tags found — should have exactly one`,
        suggestion: 'Use a single <h1> and structure with h2-h6',
      });
    }
  }

  _checkSitemap(projectRoot, result) {
    // Accept static files OR Next.js App Router / Nuxt / SvelteKit route-based generation
    const sitemapPaths = [
      'sitemap.xml', 'public/sitemap.xml', 'static/sitemap.xml',
      'app/sitemap.ts', 'app/sitemap.js', 'app/sitemap.tsx',
      'website/app/sitemap.ts', 'website/app/sitemap.js',
      'src/app/sitemap.ts', 'src/app/sitemap.js',
      'pages/sitemap.xml.ts', 'pages/sitemap.xml.js',
    ];
    const found = sitemapPaths.some(p => fs.existsSync(path.join(projectRoot, p)));

    if (!found) {
      result.addCheck('seo:sitemap', false, {
        severity: 'warning',
        message: 'No sitemap.xml found',
        suggestion: 'Generate a sitemap.xml for search engine discovery',
      });
    } else {
      result.addCheck('seo:sitemap', true);
    }
  }

  _checkRobotsTxt(projectRoot, result) {
    // Accept static files OR Next.js App Router / Nuxt / SvelteKit route-based generation
    const robotsPaths = [
      'robots.txt', 'public/robots.txt', 'static/robots.txt',
      'app/robots.ts', 'app/robots.js', 'app/robots.tsx',
      'website/app/robots.ts', 'website/app/robots.js',
      'src/app/robots.ts', 'src/app/robots.js',
      'pages/robots.txt.ts', 'pages/robots.txt.js',
    ];
    const found = robotsPaths.some(p => fs.existsSync(path.join(projectRoot, p)));

    if (!found) {
      result.addCheck('seo:robots-txt', false, {
        severity: 'warning',
        message: 'No robots.txt found',
        suggestion: 'Create a robots.txt to guide search engine crawlers',
      });
    } else {
      result.addCheck('seo:robots-txt', true);
    }
  }
}

module.exports = SeoModule;
