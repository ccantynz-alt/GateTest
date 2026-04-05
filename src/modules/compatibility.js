/**
 * Compatibility Module - Browser and platform compatibility checks.
 * Validates CSS/JS features against target browser matrix.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class CompatibilityModule extends BaseModule {
  constructor() {
    super('compatibility', 'Browser Compatibility Checks');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Check for browserslist config
    this._checkBrowserslist(projectRoot, result);

    // Check CSS for vendor prefix issues
    const cssFiles = this._collectFiles(projectRoot, ['.css', '.scss']);
    for (const file of cssFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');
      this._checkCssCompat(relPath, content, result);
    }

    // Check JS for modern API usage without polyfills
    const jsFiles = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);
    for (const file of jsFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');
      this._checkJsCompat(relPath, content, result);
    }
  }

  _checkBrowserslist(projectRoot, result) {
    const hasConfig =
      fs.existsSync(path.join(projectRoot, '.browserslistrc')) ||
      (() => {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (!fs.existsSync(pkgPath)) return false;
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          return !!pkg.browserslist;
        } catch { return false; }
      })();

    if (!hasConfig) {
      result.addCheck('compat:browserslist', false, {
        message: 'No browserslist configuration found',
        suggestion: 'Add a .browserslistrc or "browserslist" field in package.json',
      });
    } else {
      result.addCheck('compat:browserslist', true);
    }
  }

  _checkCssCompat(relPath, content, result) {
    // Check for vendor-prefix-only properties
    const vendorOnlyPatterns = [
      { regex: /-webkit-(?!.*(?:^[^-]|\n[^-]))/g, prefix: '-webkit-' },
    ];

    // Check for modern CSS that may need fallbacks
    const modernCss = [
      { feature: 'container queries', regex: /@container\b/g },
      { feature: 'CSS nesting', regex: /&\s*{/g },
      { feature: 'CSS layers', regex: /@layer\b/g },
      { feature: 'subgrid', regex: /subgrid/g },
      { feature: 'color-mix()', regex: /color-mix\s*\(/g },
    ];

    for (const { feature, regex } of modernCss) {
      regex.lastIndex = 0;
      if (regex.test(content)) {
        result.addCheck(`compat:css:${feature}:${relPath}`, false, {
          file: relPath,
          message: `Modern CSS feature "${feature}" may not work in all target browsers`,
          suggestion: `Verify "${feature}" browser support or add fallbacks`,
        });
      }
    }
  }

  _checkJsCompat(relPath, content, result) {
    // Modern JS APIs that may need polyfills
    const modernApis = [
      { api: 'structuredClone', regex: /\bstructuredClone\s*\(/g },
      { api: 'Array.at()', regex: /\.at\s*\(\s*-/g },
      { api: 'Object.hasOwn', regex: /Object\.hasOwn\s*\(/g },
      { api: 'AbortSignal.timeout', regex: /AbortSignal\.timeout\s*\(/g },
      { api: 'navigator.share', regex: /navigator\.share\s*\(/g },
    ];

    for (const { api, regex } of modernApis) {
      regex.lastIndex = 0;
      if (regex.test(content)) {
        result.addCheck(`compat:js:${api}:${relPath}`, false, {
          file: relPath,
          message: `API "${api}" may not be available in all target browsers`,
          suggestion: `Check caniuse.com for "${api}" and add polyfill if needed`,
        });
      }
    }
  }
}

module.exports = CompatibilityModule;
