/**
 * GateTest Module Registry - Discovers and loads all test modules.
 */

const path = require('path');
const fs = require('fs');

const BUILT_IN_MODULES = {
  syntax: '../modules/syntax.js',
  lint: '../modules/lint.js',
  secrets: '../modules/secrets.js',
  codeQuality: '../modules/code-quality.js',
  unitTests: '../modules/unit-tests.js',
  integrationTests: '../modules/integration-tests.js',
  e2e: '../modules/e2e.js',
  visual: '../modules/visual.js',
  accessibility: '../modules/accessibility.js',
  performance: '../modules/performance.js',
  security: '../modules/security.js',
  seo: '../modules/seo.js',
  links: '../modules/links.js',
  compatibility: '../modules/compatibility.js',
  codeQuality: '../modules/code-quality.js',
  dataIntegrity: '../modules/data-integrity.js',
  documentation: '../modules/documentation.js',
  liveCrawler: '../modules/live-crawler.js',
  explorer: '../modules/explorer.js',
  chaos: '../modules/chaos.js',
  mutation: '../modules/mutation.js',
};

class ModuleRegistry {
  constructor() {
    this.modules = new Map();
  }

  loadBuiltIn() {
    for (const [name, relativePath] of Object.entries(BUILT_IN_MODULES)) {
      try {
        const modulePath = path.resolve(__dirname, relativePath);
        if (fs.existsSync(modulePath)) {
          const ModuleClass = require(modulePath);
          this.modules.set(name, new ModuleClass());
        }
      } catch (err) {
        console.warn(`[GateTest] Warning: Could not load module "${name}": ${err.message}`);
      }
    }
    return this;
  }

  loadCustom(modulesDir) {
    if (!fs.existsSync(modulesDir)) return this;

    const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      try {
        const ModuleClass = require(path.join(modulesDir, file));
        const name = path.basename(file, '.js');
        this.modules.set(name, new ModuleClass());
      } catch (err) {
        console.warn(`[GateTest] Warning: Could not load custom module "${file}": ${err.message}`);
      }
    }
    return this;
  }

  get(name) {
    return this.modules.get(name);
  }

  getAll() {
    return this.modules;
  }

  list() {
    return Array.from(this.modules.keys());
  }
}

module.exports = { ModuleRegistry, BUILT_IN_MODULES };
