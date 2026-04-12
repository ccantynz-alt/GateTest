/**
 * Secrets Module - Scans for hardcoded secrets, API keys, tokens, and passwords.
 * Zero tolerance for secrets in source code or git history.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class SecretsModule extends BaseModule {
  constructor() {
    super('secrets', 'Secret & Credential Detection');
    this.patterns = [
      { regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}/gi, type: 'API Key' },
      { regex: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/gi, type: 'Password/Secret' },
      { regex: /(?:token|bearer)\s*[:=]\s*['"][^'"]{8,}/gi, type: 'Token' },
      { regex: /(?:aws|amazon).{0,20}(?:key|secret|token).{0,20}['"][A-Za-z0-9/+=]{20,}/gi, type: 'AWS Credential' },
      { regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, type: 'Private Key' },
      { regex: /ghp_[A-Za-z0-9_]{36,}/g, type: 'GitHub PAT' },
      { regex: /gho_[A-Za-z0-9_]{36,}/g, type: 'GitHub OAuth Token' },
      { regex: /github_pat_[A-Za-z0-9_]{22,}/g, type: 'GitHub Fine-Grained Token' },
      { regex: /sk-[A-Za-z0-9]{32,}/g, type: 'OpenAI/Stripe Key' },
      { regex: /sk_live_[A-Za-z0-9]{24,}/g, type: 'Stripe Live Key' },
      { regex: /xox[bprs]-[A-Za-z0-9-]{10,}/g, type: 'Slack Token' },
      { regex: /(?:mongodb|postgres|mysql|redis):\/\/[^'"\s]{10,}/gi, type: 'Database URL' },
      { regex: /AKIA[A-Z0-9]{16}/g, type: 'AWS Access Key ID' },
      { regex: /(?:sendgrid|mailgun|twilio).{0,20}['"][A-Za-z0-9.]{20,}/gi, type: 'Service API Key' },
    ];
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const sourceExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs',
      '.java', '.env', '.yml', '.yaml', '.json', '.toml', '.cfg', '.ini', '.conf',
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd'];

    const files = this._collectFiles(projectRoot, sourceExtensions);
    let totalSecrets = 0;

    for (const file of files) {
      const relPath = path.relative(projectRoot, file);

      // Skip test fixtures and example files
      if (relPath.includes('fixture') || relPath.includes('example') || relPath.includes('mock')) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      const found = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of this.patterns) {
          // Reset regex lastIndex for global regexes
          pattern.regex.lastIndex = 0;
          if (pattern.regex.test(line)) {
            found.push({
              type: pattern.type,
              line: i + 1,
              preview: line.substring(0, 80).trim() + (line.length > 80 ? '...' : ''),
            });
          }
        }
      }

      if (found.length > 0) {
        totalSecrets += found.length;
        result.addCheck(`secrets:${relPath}`, false, {
          file: relPath,
          message: `${found.length} potential secret(s) found`,
          details: found,
          suggestion: 'Move secrets to environment variables and add file to .gitignore',
        });
      }
    }

    // Check for .env files committed to git
    this._checkEnvFiles(projectRoot, result);

    // Check .gitignore for secret file patterns
    this._checkGitignore(projectRoot, result);

    if (totalSecrets === 0) {
      result.addCheck('secrets-scan', true, { message: `Scanned ${files.length} files, no secrets found` });
    }
  }

  _checkEnvFiles(projectRoot, result) {
    const dangerousFiles = ['.env', '.env.local', '.env.production', 'credentials.json',
      'service-account.json', 'key.pem', 'id_rsa', '.npmrc'];

    for (const filename of dangerousFiles) {
      const filePath = path.join(projectRoot, filename);
      if (fs.existsSync(filePath)) {
        // Check if it's tracked by git
        const { exitCode } = this._exec(`git ls-files --error-unmatch "${filename}" 2>/dev/null`, {
          cwd: projectRoot,
        });
        if (exitCode === 0) {
          result.addCheck(`secrets:tracked-${filename}`, false, {
            file: filename,
            message: `${filename} is tracked by git — this file likely contains secrets`,
            suggestion: `Add "${filename}" to .gitignore and remove from git tracking`,
          });
        }
      }
    }
  }

  _checkGitignore(projectRoot, result) {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      result.addCheck('secrets:gitignore-exists', false, {
        message: 'No .gitignore file found',
        suggestion: 'Create a .gitignore that excludes .env, credentials, and key files',
        autoFix: () => {
          try {
            const template = 'node_modules/\n.env\n.env.*\n*.pem\n*.key\ncredentials.json\n.DS_Store\n';
            fs.writeFileSync(gitignorePath, template, 'utf-8');
            return { fixed: true, description: 'Created .gitignore with standard secret exclusions', filesChanged: ['.gitignore'] };
          } catch { return { fixed: false }; }
        },
      });
      return;
    }

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const requiredPatterns = ['.env', '*.pem', '*.key'];

    for (const pat of requiredPatterns) {
      if (!content.includes(pat)) {
        const gitignore = gitignorePath;
        const patToAdd = pat;
        result.addCheck(`secrets:gitignore-${pat}`, false, {
          message: `.gitignore missing pattern: ${pat}`,
          suggestion: `Add "${pat}" to .gitignore`,
          autoFix: () => {
            try {
              fs.appendFileSync(gitignore, `\n${patToAdd}\n`);
              return { fixed: true, description: `Added "${patToAdd}" to .gitignore`, filesChanged: ['.gitignore'] };
            } catch { return { fixed: false }; }
          },
        });
      }
    }
  }
}

module.exports = SecretsModule;
