/**
 * AI Code Review Module — The feature no competitor has.
 *
 * Uses Claude API to perform intelligent code review on changed files.
 * This isn't pattern matching. This is an AI that understands your code,
 * finds real bugs, suggests fixes, and explains WHY something is wrong.
 *
 * Requires: ANTHROPIC_API_KEY environment variable.
 * When not configured, gracefully skips with an info message.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_FILES_PER_REVIEW = 10;
const MAX_FILE_SIZE = 50000; // 50KB per file

class AiReviewModule extends BaseModule {
  constructor() {
    super('aiReview', 'AI-Powered Code Review');
  }

  async run(result, config) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      result.addCheck('ai-review:not-configured', true, {
        severity: 'info',
        message: 'AI code review skipped — set ANTHROPIC_API_KEY to enable',
      });
      return;
    }

    const projectRoot = config.projectRoot;
    const runnerOptions = config._runnerOptions || {};

    // Get files to review
    let filesToReview;
    if (runnerOptions.diffOnly && runnerOptions.changedFiles) {
      filesToReview = runnerOptions.changedFiles
        .filter(f => this._isReviewableFile(f))
        .map(f => path.join(projectRoot, f));
    } else {
      // Review recent git changes or sample source files
      filesToReview = this._getRecentChanges(projectRoot);
    }

    if (filesToReview.length === 0) {
      result.addCheck('ai-review:no-files', true, {
        severity: 'info',
        message: 'No files to review',
      });
      return;
    }

    // Limit to MAX_FILES_PER_REVIEW
    const reviewBatch = filesToReview.slice(0, MAX_FILES_PER_REVIEW);

    result.addCheck('ai-review:scanning', true, {
      severity: 'info',
      message: `AI reviewing ${reviewBatch.length} file(s)...`,
    });

    // Build review payload
    const fileContents = [];
    for (const file of reviewBatch) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.length > MAX_FILE_SIZE) continue;
        const relPath = path.relative(projectRoot, file);
        fileContents.push({ path: relPath, content });
      } catch { /* skip unreadable */ }
    }

    if (fileContents.length === 0) {
      result.addCheck('ai-review:empty', true, {
        severity: 'info',
        message: 'No reviewable file content found',
      });
      return;
    }

    try {
      const review = await this._callClaude(apiKey, fileContents);
      this._processReview(review, result);
    } catch (err) {
      result.addCheck('ai-review:error', false, {
        severity: 'warning',
        message: `AI review failed: ${err.message}`,
        suggestion: 'Check ANTHROPIC_API_KEY is valid and has available credits',
      });
    }
  }

  async _callClaude(apiKey, files) {
    const filesText = files.map(f =>
      `--- ${f.path} ---\n${f.content}\n`
    ).join('\n');

    const prompt = `You are a senior code reviewer for GateTest, the most advanced QA system available. Review the following source files and find REAL bugs, security issues, performance problems, and quality concerns.

For each issue found, respond in this exact JSON format:
{
  "issues": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "error|warning|info",
      "category": "security|performance|bug|quality|accessibility",
      "title": "Short description",
      "explanation": "Why this is a problem",
      "suggestion": "How to fix it",
      "fixedCode": "The corrected code (if applicable, just the relevant lines)"
    }
  ],
  "summary": "One paragraph overall assessment"
}

Rules:
- Only report REAL issues. No style nitpicks. No subjective preferences.
- Security issues are always severity "error"
- Bugs that cause incorrect behavior are severity "error"
- Performance issues are severity "warning"
- Minor quality improvements are severity "info"
- If the code is clean, return an empty issues array
- Be specific about line numbers

Files to review:

${filesText}`;

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const options = {
        hostname: ANTHROPIC_API_HOST,
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const response = JSON.parse(raw);

            if (res.statusCode !== 200) {
              reject(new Error(`API returned ${res.statusCode}: ${response.error?.message || raw}`));
              return;
            }

            const text = response.content?.[0]?.text || '';

            // Extract JSON from response (Claude may wrap it in markdown)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              resolve(JSON.parse(jsonMatch[0]));
            } else {
              resolve({ issues: [], summary: text });
            }
          } catch (err) {
            reject(new Error(`Failed to parse AI response: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('AI review timed out after 60s'));
      });

      req.write(body);
      req.end();
    });
  }

  _processReview(review, result) {
    if (!review || !review.issues) {
      result.addCheck('ai-review:complete', true, {
        severity: 'info',
        message: 'AI review complete — no issues found',
      });
      return;
    }

    const issues = review.issues;

    if (issues.length === 0) {
      result.addCheck('ai-review:clean', true, {
        severity: 'info',
        message: `AI review complete — code looks clean. ${review.summary || ''}`,
      });
      return;
    }

    // Convert AI findings to GateTest checks
    for (const issue of issues) {
      const severity = ['error', 'warning', 'info'].includes(issue.severity)
        ? issue.severity : 'warning';

      result.addCheck(`ai-review:${issue.category || 'quality'}:${issue.file}:${issue.line || 0}`, false, {
        file: issue.file,
        line: issue.line,
        severity,
        message: `[AI] ${issue.title}`,
        suggestion: issue.suggestion,
        explanation: issue.explanation,
        fixedCode: issue.fixedCode,
      });
    }

    // Summary
    if (review.summary) {
      result.addCheck('ai-review:summary', true, {
        severity: 'info',
        message: `AI Review: ${review.summary}`,
      });
    }

    result.addCheck('ai-review:complete', true, {
      severity: 'info',
      message: `AI found ${issues.length} issue(s) across reviewed files`,
    });
  }

  _isReviewableFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const reviewable = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.java', '.rb', '.rs', '.php'];
    return reviewable.includes(ext);
  }

  _getRecentChanges(projectRoot) {
    try {
      const { stdout } = this._exec('git diff --name-only HEAD~5 2>/dev/null || git diff --name-only HEAD 2>/dev/null', {
        cwd: projectRoot,
      });

      return stdout.trim().split('\n')
        .filter(f => f && this._isReviewableFile(f))
        .map(f => path.join(projectRoot, f))
        .filter(f => fs.existsSync(f));
    } catch {
      // Not a git repo or no commits — review all source files
      return this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']).slice(0, MAX_FILES_PER_REVIEW);
    }
  }
}

module.exports = AiReviewModule;
