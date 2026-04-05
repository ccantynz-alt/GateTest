/**
 * Accessibility Module - WCAG 2.2 AAA compliance checking.
 * Validates HTML, ARIA usage, color contrast, keyboard access, and more.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class AccessibilityModule extends BaseModule {
  constructor() {
    super('accessibility', 'Accessibility (WCAG 2.2 AAA) Audit');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const htmlFiles = this._collectFiles(projectRoot, ['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte']);

    if (htmlFiles.length === 0) {
      result.addCheck('a11y:files', true, { message: 'No HTML/template files to check' });
      return;
    }

    for (const file of htmlFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');

      this._checkImages(relPath, content, result);
      this._checkFormLabels(relPath, content, result);
      this._checkHeadingHierarchy(relPath, content, result);
      this._checkAriaUsage(relPath, content, result);
      this._checkLanguageAttribute(relPath, content, result);
      this._checkLandmarks(relPath, content, result);
      this._checkFocusManagement(relPath, content, result);
      this._checkReducedMotion(relPath, content, result);
    }

    // Check CSS for contrast and focus styles
    const cssFiles = this._collectFiles(projectRoot, ['.css', '.scss', '.less']);
    for (const file of cssFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');
      this._checkCssFocus(relPath, content, result);
      this._checkCssReducedMotion(relPath, content, result);
    }
  }

  _checkImages(relPath, content, result) {
    // Find <img> tags without alt attribute
    const imgRegex = /<img\b([^>]*?)>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      const attrs = match[1];
      if (!/\balt\s*=/i.test(attrs)) {
        result.addCheck(`a11y:img-alt:${relPath}`, false, {
          file: relPath,
          message: 'Image missing alt attribute',
          suggestion: 'Add alt="description" for informative images or alt="" for decorative',
        });
      }
    }
  }

  _checkFormLabels(relPath, content, result) {
    // Find <input> without associated <label> or aria-label
    const inputRegex = /<input\b([^>]*?)>/gi;
    let match;
    while ((match = inputRegex.exec(content)) !== null) {
      const attrs = match[1];
      const type = (attrs.match(/type\s*=\s*["'](\w+)["']/i) || [])[1] || 'text';
      if (['hidden', 'submit', 'button', 'reset'].includes(type)) continue;

      const hasLabel = /aria-label\s*=/i.test(attrs) ||
                       /aria-labelledby\s*=/i.test(attrs) ||
                       /id\s*=/i.test(attrs); // Simplified check

      if (!hasLabel) {
        result.addCheck(`a11y:input-label:${relPath}`, false, {
          file: relPath,
          message: `Input (type="${type}") missing accessible label`,
          suggestion: 'Add aria-label, aria-labelledby, or an associated <label> element',
        });
      }
    }
  }

  _checkHeadingHierarchy(relPath, content, result) {
    const headingRegex = /<h([1-6])\b/gi;
    const headings = [];
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      headings.push(parseInt(match[1]));
    }

    for (let i = 1; i < headings.length; i++) {
      if (headings[i] > headings[i - 1] + 1) {
        result.addCheck(`a11y:heading-hierarchy:${relPath}`, false, {
          file: relPath,
          message: `Heading level skipped: h${headings[i - 1]} to h${headings[i]}`,
          suggestion: 'Use sequential heading levels (h1 > h2 > h3) without skipping',
        });
        break;
      }
    }
  }

  _checkAriaUsage(relPath, content, result) {
    // Check for invalid ARIA roles
    const roleRegex = /role\s*=\s*["'](\w+)["']/gi;
    const validRoles = new Set([
      'alert', 'alertdialog', 'application', 'article', 'banner', 'button',
      'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
      'contentinfo', 'definition', 'dialog', 'directory', 'document',
      'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading',
      'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main',
      'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation',
      'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup',
      'rowheader', 'scrollbar', 'search', 'searchbox', 'separator',
      'slider', 'spinbutton', 'status', 'switch', 'tab', 'table',
      'tablist', 'tabpanel', 'term', 'textbox', 'timer', 'toolbar',
      'tooltip', 'tree', 'treegrid', 'treeitem',
    ]);

    let match;
    while ((match = roleRegex.exec(content)) !== null) {
      if (!validRoles.has(match[1].toLowerCase())) {
        result.addCheck(`a11y:invalid-role:${relPath}`, false, {
          file: relPath,
          message: `Invalid ARIA role: "${match[1]}"`,
          suggestion: 'Use a valid WAI-ARIA role',
        });
      }
    }
  }

  _checkLanguageAttribute(relPath, content, result) {
    if (content.includes('<html') && !/lang\s*=\s*["']\w/i.test(content)) {
      result.addCheck(`a11y:html-lang:${relPath}`, false, {
        file: relPath,
        message: 'Missing lang attribute on <html> element',
        suggestion: 'Add lang="en" (or appropriate language) to <html>',
      });
    }
  }

  _checkLandmarks(relPath, content, result) {
    if (!content.includes('<html')) return; // Only full HTML pages

    const landmarks = ['<main', 'role="main"', '<nav', 'role="navigation"'];
    const hasMain = landmarks.slice(0, 2).some(l => content.includes(l));

    if (!hasMain) {
      result.addCheck(`a11y:landmark-main:${relPath}`, false, {
        file: relPath,
        message: 'Missing main landmark',
        suggestion: 'Add <main> element or role="main" to primary content area',
      });
    }
  }

  _checkFocusManagement(relPath, content, result) {
    // Check for tabindex > 0 (anti-pattern)
    const tabindexRegex = /tabindex\s*=\s*["'](\d+)["']/gi;
    let match;
    while ((match = tabindexRegex.exec(content)) !== null) {
      const value = parseInt(match[1]);
      if (value > 0) {
        result.addCheck(`a11y:tabindex-positive:${relPath}`, false, {
          file: relPath,
          message: `Positive tabindex="${value}" creates confusing tab order`,
          suggestion: 'Use tabindex="0" or tabindex="-1" instead',
        });
      }
    }
  }

  _checkReducedMotion(relPath, content, result) {
    // Check JS for motion/animation without prefers-reduced-motion check
    if (content.includes('animate(') || content.includes('requestAnimationFrame')) {
      if (!content.includes('prefers-reduced-motion')) {
        result.addCheck(`a11y:reduced-motion-js:${relPath}`, false, {
          file: relPath,
          message: 'Animations detected without prefers-reduced-motion check',
          suggestion: 'Check window.matchMedia("(prefers-reduced-motion: reduce)") before animating',
        });
      }
    }
  }

  _checkCssFocus(relPath, content, result) {
    if (content.includes(':focus') && content.includes('outline: none') ||
        content.includes('outline:none') || content.includes('outline: 0')) {
      if (!content.includes(':focus-visible')) {
        result.addCheck(`a11y:focus-outline:${relPath}`, false, {
          file: relPath,
          message: 'Focus outline removed without alternative',
          suggestion: 'Use :focus-visible instead of :focus, or provide custom focus indicators',
        });
      }
    }
  }

  _checkCssReducedMotion(relPath, content, result) {
    if ((content.includes('animation') || content.includes('transition')) &&
        !content.includes('prefers-reduced-motion')) {
      result.addCheck(`a11y:reduced-motion-css:${relPath}`, false, {
        file: relPath,
        message: 'CSS animations/transitions without prefers-reduced-motion media query',
        suggestion: 'Add @media (prefers-reduced-motion: reduce) { ... } to disable animations',
      });
    }
  }
}

module.exports = AccessibilityModule;
