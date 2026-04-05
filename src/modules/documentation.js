/**
 * Documentation Module - Validates project documentation completeness.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class DocumentationModule extends BaseModule {
  constructor() {
    super('documentation', 'Documentation Validation');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;

    // Check README exists and has content
    this._checkReadme(projectRoot, result);

    // Check CHANGELOG
    this._checkChangelog(projectRoot, result);

    // Check for env documentation
    this._checkEnvDocs(projectRoot, result);
  }

  _checkReadme(projectRoot, result) {
    const readmePath = path.join(projectRoot, 'README.md');
    if (!fs.existsSync(readmePath)) {
      result.addCheck('docs:readme', false, {
        message: 'No README.md found',
        suggestion: 'Create a README.md with project description, setup, and usage instructions',
      });
      return;
    }

    const content = fs.readFileSync(readmePath, 'utf-8');
    const sections = ['install', 'setup', 'usage', 'getting started', 'quick start'];
    const hasSetup = sections.some(s => content.toLowerCase().includes(s));

    if (!hasSetup) {
      result.addCheck('docs:readme-setup', false, {
        file: 'README.md',
        message: 'README lacks installation/setup instructions',
        suggestion: 'Add installation and getting started sections to README.md',
      });
    } else {
      result.addCheck('docs:readme', true);
    }
  }

  _checkChangelog(projectRoot, result) {
    const changelogFiles = ['CHANGELOG.md', 'CHANGES.md', 'HISTORY.md'];
    const found = changelogFiles.some(f => fs.existsSync(path.join(projectRoot, f)));

    if (!found) {
      result.addCheck('docs:changelog', false, {
        message: 'No CHANGELOG.md found',
        suggestion: 'Create a CHANGELOG.md to track user-facing changes',
      });
    } else {
      result.addCheck('docs:changelog', true);
    }
  }

  _checkEnvDocs(projectRoot, result) {
    const envExample = ['.env.example', '.env.sample', '.env.template'];
    const hasEnv = fs.existsSync(path.join(projectRoot, '.env'));
    const hasExample = envExample.some(f => fs.existsSync(path.join(projectRoot, f)));

    if (hasEnv && !hasExample) {
      result.addCheck('docs:env-example', false, {
        message: '.env file exists but no .env.example for documentation',
        suggestion: 'Create .env.example with all required variables (without values)',
      });
    }
  }
}

module.exports = DocumentationModule;
