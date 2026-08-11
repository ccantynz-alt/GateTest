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

  /**
   * True when the quoted value in a `key: 'value'` match reads as English
   * prose rather than a credential.
   *
   * Why this exists: the pattern rules key off the IDENTIFIER (`secret`,
   * `token`, `api_key`), so any object that maps env-var names to
   * human-readable descriptions trips them — a documentation map, not a
   * leak. Found by GateTest's own self-scan on
   * scripts/marketplace-preflight.js (`CRON_SECRET: 'the scan queue is
   * never drained ...'`).
   *
   * The test is deliberately conservative — a value only counts as prose
   * when it has 4+ whitespace-separated words AND contains no contiguous
   * 12-char run mixing letters with digits/`+/=` (the signature of a real
   * key). A multi-word passphrase like `'correct horse battery staple'`
   * is the one shape this could mask, so the token test stays strict and
   * anything with key-like entropy is still reported.
   *
   * @param {string} match - full regex match, e.g. `SECRET: 'some words'`
   * @returns {boolean}
   */
  _looksLikeProse(match) {
    const q = match.match(/['"]([^'"]*)$/);
    if (!q) return false;
    const value = q[1];
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.length < 4) return false;
    // Any contiguous 12+ char run that mixes letters with digits or base64
    // padding is key-shaped — never treat that as prose. Checked per-run so
    // a sentence that merely happens to contain a digit elsewhere is safe.
    const runs = value.match(/[A-Za-z0-9+/=_-]{12,}/g) || [];
    if (runs.some((r) => /[A-Za-z]/.test(r) && /[0-9+/=]/.test(r))) return false;
    // Every word must be plain language: letters, digits, and ordinary
    // sentence punctuation. Underscores, braces, brackets and backslashes
    // signal code, so a value containing them is not treated as prose.
    return words.every((w) => /^[A-Za-z0-9''""«»,.;:!?()\-—–/&%]+$/.test(w));
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

      // Skip module source files — they contain detection pattern strings
      // that match the very rules they implement (e.g. cookie-security.js
      // has "changeme" as a weak-secret pattern, not an actual secret).
      const relUnix = relPath.replace(/\\/g, '/');
      if (/(?:^|\/)src[\\/]modules[\\/]/.test(relUnix)) continue;

      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split(/\r?\n/);
      const found = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // `// secrets-ok` on this line or the previous line suppresses
        const prevLine = i > 0 ? lines[i - 1] : '';
        if (/\bsecrets-ok\b/.test(line) || /\bsecrets-ok\b/.test(prevLine)) continue;

        // Skip comparison/sentinel context — `if (password === 'REJECTED_VALUE')` is not a secret assignment
        if (/===|!==/.test(line)) continue;

        // Skip env-var fallback pattern — `secret = process.env.X || 'default'`
        if (/process\.env\b/.test(line)) continue;

        // Skip comment lines
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue;

        for (const pattern of this.patterns) {
          // Reset regex lastIndex for global regexes
          pattern.regex.lastIndex = 0;
          if (pattern.regex.test(line)) {
            // Re-anchor before exec. `test()` above ADVANCED lastIndex on
            // these /g regexes, so the exec used to resume past the match it
            // had just found and return null — which silently disabled every
            // value-based suppression below (placeholders included) for as
            // long as this module has shipped. Reset, exec, reset again.
            pattern.regex.lastIndex = 0;
            // Skip known placeholder / sentinel values that are intentionally visible
            const m = pattern.regex.exec(line);
            pattern.regex.lastIndex = 0;
            if (m) {
              const val = m[0].toLowerCase();
              // `your[_-]?(?:\w+[_-])?` so the extremely common
              // `your_api_key_here` / `your-github-token` shapes are covered,
              // not just the bare `your_key`.
              // `example` is bounded so it only suppresses a standalone
              // placeholder word (`example_secret`, `"example"`). Left
              // unbounded it swallows any high-entropy value that merely
              // contains the substring — including AWS's canonical
              // AKIAIOSFODNN7EXAMPLE — and a secrets module must fail
              // toward detection, never toward silence.
              if (/(?:changeme|placeholder|your[_-]?(?:\w+[_-])?(?:secret|key|password|token)|replace[_-]?me|(?<![a-z0-9])example(?![a-z0-9])|default[_-]?(?:secret|key|password|token)|xxx+|insert[_-]?here|todo)/.test(val)) continue;
              // Skip prose values. `CRON_SECRET: 'the scan queue is never
              // drained'` is a docs/description map keyed by env-var NAME —
              // the name matches the rule, the value is an English sentence.
              // Credentials are contiguous high-entropy strings; sentences
              // are not. See _looksLikeProse for the exact test.
              if (this._looksLikeProse(m[0])) continue;
            }
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
        const isTest = /(?:^|\/)(?:tests?|__tests__|spec|fixtures?|e2e)[\\/]|\.(?:test|spec)\.[a-z]+$/i.test(relUnix);
        result.addCheck(`secrets:${relPath}`, false, {
          severity: isTest ? 'warning' : 'error',
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

  /**
   * Does a file the given .gitignore pattern would have covered actually
   * exist in the tree? Decides whether a missing pattern is a live exposure
   * (error) or a hygiene advisory (warning).
   *
   * Deliberately narrow: handles the three patterns this module requires
   * (`.env`, `*.pem`, `*.key`) rather than implementing gitignore globbing.
   * `.env` matches `.env` and any `.env.*`, mirroring how the pattern behaves
   * in practice. Bounded walk — skips vendor/build dirs and stops at depth 6
   * so a huge monorepo cannot make the secrets module the slow one.
   *
   * @param {string} projectRoot
   * @param {string} pattern - one of `.env`, `*.pem`, `*.key`
   * @returns {boolean}
   */
  _matchingFileExists(projectRoot, pattern) {
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'vendor', '.gatetest']);
    const matches = (name) => (
      pattern === '.env'
        ? (name === '.env' || name.startsWith('.env.'))
        : name.endsWith(pattern.slice(1))
    );

    const walk = (dir, depth) => {
      if (depth > 6) return false;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false; // unreadable dir is not evidence of a secret
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP.has(entry.name)) continue;
          if (walk(path.join(dir, entry.name), depth + 1)) return true;
        } else if (matches(entry.name)) {
          return true;
        }
      }
      return false;
    };

    return walk(projectRoot, 0);
  }

  _checkGitignore(projectRoot, result) {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      result.addCheck('secrets:gitignore-exists', false, {
        // Warning, not error: missing setup files are hygiene advisories.
        // Actually-committed secrets still block (the scanner checks the
        // real file contents); a brand-new repo's first scan shouldn't be
        // BLOCKED over a file it hasn't created yet (first-run audit
        // 2026-07-23 — same rationale as lint:eslint-config and
        // security:gitignore-missing).
        severity: 'warning',
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
        // Only an ERROR when the risk is live — i.e. a file this pattern
        // would have covered actually exists in the tree. Otherwise it is a
        // hygiene advisory about a file the repo does not have.
        //
        // Why (neutral-repo audit 2026-08-12): scanning expressjs/express —
        // which contains no .env, .pem or .key file anywhere — produced three
        // of these at full confidence and they were 3 of the 5 findings that
        // BLOCKED the gate. Every blocking line on a healthy repo was noise,
        // which is precisely how a gate teaches its customer to bypass it.
        //
        // Same rationale as the missing-.gitignore branch above, which was
        // already downgraded on 2026-07-23: it is incoherent for "no
        // .gitignore at all" to warn while "an existing .gitignore missing
        // one line" blocks.
        const atRisk = this._matchingFileExists(projectRoot, pat);
        result.addCheck(`secrets:gitignore-${pat}`, false, {
          severity: atRisk ? 'error' : 'warning',
          message: atRisk
            ? `.gitignore missing pattern: ${pat} — and a matching file exists in the tree`
            : `.gitignore missing pattern: ${pat}`,
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
