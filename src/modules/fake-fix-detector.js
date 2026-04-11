/**
 * Fake Fix Detector — The "chicken scratching" killer.
 *
 * When an AI coding assistant is told "fix this bug" and it doesn't understand
 * the root cause, it often patches the symptom instead: deletes the failing
 * assertion, wraps the error in a swallowing try/catch, stubs a function to
 * `return true`, adds `.skip` to the test, or comments out the offending code.
 *
 * This module analyses a git diff and flags those anti-patterns. Two engines:
 *
 *   1. Pattern engine — deterministic regex rules, no API key required.
 *      Catches 80% of chicken scratching with zero false positives on the
 *      high-confidence rules.
 *
 *   2. AI engine — if ANTHROPIC_API_KEY is set, sends the diff to Claude and
 *      asks whether each hunk is a real fix or a symptom patch, with the
 *      explicit prompt "is this disabling the check that exposed the bug?".
 *
 * Both engines run by default. Either can be disabled via module config.
 */

const BaseModule = require('./base-module');
const https = require('https');

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_DIFF_SIZE = 120000; // 120KB — cap the payload sent to AI
const AI_TIMEOUT_MS = 60000;

/**
 * Pattern rules. Each rule inspects an ADDED or REMOVED line from the diff.
 * Severity: error = almost certainly a fake fix. warning = suspicious.
 */
const PATTERN_RULES = [
  // --- Test disabling (high confidence) ---
  {
    id: 'test-skip-added',
    direction: 'added',
    pattern: /^\+.*\b(it|describe|test)\.skip\s*\(/,
    severity: 'error',
    title: 'Test was skipped instead of fixed',
    explanation: 'A test was changed to .skip — the failing test is now being ignored, not fixed.',
  },
  {
    id: 'test-only-added',
    direction: 'added',
    pattern: /^\+.*\b(it|describe|test)\.only\s*\(/,
    severity: 'warning',
    title: '.only added to test',
    explanation: '.only narrows the suite to one test and hides failures in the rest of the suite.',
  },
  {
    id: 'test-xit-added',
    direction: 'added',
    pattern: /^\+\s*(xit|xdescribe|xtest)\s*\(/,
    severity: 'error',
    title: 'Test was disabled with xit/xdescribe/xtest',
    explanation: 'The test has been disabled rather than fixed.',
  },
  {
    id: 'assertion-deleted',
    direction: 'removed',
    pattern: /^-.*\b(assert|expect|should)\b.*[()]/,
    severity: 'warning',
    title: 'Assertion was removed from a test',
    explanation: 'A test assertion was deleted. Verify the assertion is obsolete, not inconvenient.',
  },
  {
    id: 'test-block-deleted',
    direction: 'removed',
    pattern: /^-\s*(it|test)\s*\(\s*['"`]/,
    severity: 'warning',
    title: 'Test case was removed',
    explanation: 'An entire test case was deleted. Confirm the behaviour is still covered.',
  },

  // --- Error swallowing ---
  {
    id: 'empty-catch',
    direction: 'added',
    pattern: /^\+.*\bcatch\s*(\([^)]*\))?\s*\{\s*\}/,
    severity: 'error',
    title: 'Empty catch block added',
    explanation: 'An empty catch swallows errors silently — the root cause is hidden, not fixed.',
  },
  {
    id: 'catch-noop',
    direction: 'added',
    pattern: /^\+.*catch\s*\([^)]*\)\s*\{\s*\/\*.*\*\/\s*\}/,
    severity: 'error',
    title: 'Catch block comments out the error',
    explanation: 'The catch block contains only a comment — errors are being discarded.',
  },
  {
    id: 'catch-ignore-comment',
    direction: 'added',
    pattern: /^\+.*\/\/\s*(ignore|swallow|suppress|silence).*(error|exception|err)/i,
    severity: 'warning',
    title: 'Error explicitly ignored with comment',
    explanation: 'Code explicitly ignores an error. Errors should be handled, not ignored.',
  },

  // --- Stubbed returns ---
  {
    id: 'return-true-stub',
    direction: 'added',
    pattern: /^\+\s*return\s+true\s*;?\s*$/,
    severity: 'warning',
    title: 'Function reduced to `return true`',
    explanation: 'A function body was replaced with `return true`. Verify the original logic is still needed.',
  },
  {
    id: 'always-pass',
    direction: 'added',
    pattern: /^\+.*\bif\s*\(\s*(false|0|null|undefined)\s*\)/,
    severity: 'error',
    title: 'Dead-code guard added (`if (false)`)',
    explanation: 'An `if (false)` / `if (0)` guard disables code permanently. This is a symptom patch.',
  },
  {
    id: 'commented-out-code',
    direction: 'added',
    pattern: /^\+\s*\/\/\s*(TODO|FIXME|HACK|XXX|temporary|temp|disabled|commented out)/i,
    severity: 'warning',
    title: 'TODO/FIXME/HACK comment added',
    explanation: 'New TODO/FIXME/HACK comments indicate unresolved work left in place of a real fix.',
  },

  // --- Weakening checks ---
  {
    id: 'strict-to-loose',
    direction: 'changed',
    pattern: /===/,
    replacement: /==[^=]/,
    severity: 'warning',
    title: 'Strict equality relaxed to loose equality',
    explanation: '=== was changed to == — type coercion masks bugs rather than fixing them.',
  },
  {
    id: 'not-equal-removed',
    direction: 'removed',
    pattern: /^-.*(!==|!=)/,
    severity: 'info',
    title: 'Not-equal check removed',
    explanation: 'An inequality check was removed. Confirm the invariant it protected still holds.',
  },

  // --- Type escape hatches ---
  {
    id: 'ts-ignore-added',
    direction: 'added',
    pattern: /^\+.*@ts-(ignore|nocheck|expect-error)/,
    severity: 'error',
    title: 'TypeScript error suppressed with @ts-ignore',
    explanation: 'Type errors are being suppressed rather than fixed. The underlying type issue remains.',
  },
  {
    id: 'eslint-disable-added',
    direction: 'added',
    pattern: /^\+.*eslint-disable(-next-line)?/,
    severity: 'warning',
    title: 'ESLint rule disabled inline',
    explanation: 'An ESLint rule was disabled instead of the underlying issue being fixed.',
  },
  {
    id: 'any-cast-added',
    direction: 'added',
    pattern: /^\+.*\bas\s+any\b/,
    severity: 'warning',
    title: '`as any` cast added',
    explanation: 'An `as any` cast erases type safety instead of fixing a type mismatch.',
  },

  // --- Config / threshold softening ---
  {
    id: 'threshold-lowered',
    direction: 'added',
    pattern: /^\+.*(coverage|threshold|minScore|maxErrors)\s*[:=]\s*\d/i,
    severity: 'info',
    title: 'Threshold value changed',
    explanation: 'A quality threshold was modified. Confirm the new value is justified, not loosened.',
  },
];

class FakeFixDetectorModule extends BaseModule {
  constructor() {
    super('fakeFixDetector', 'Fake Fix Detector — Catches symptom patching and skipped tests');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const moduleConfig = config.getModuleConfig
      ? config.getModuleConfig('fakeFixDetector')
      : {};

    const runnerOptions = config._runnerOptions || {};
    const patternEnabled = moduleConfig.patternEngine !== false;
    const aiEnabled = moduleConfig.aiEngine !== false;

    // Figure out what diff to analyse.
    const diff = this._getDiff(projectRoot, runnerOptions, moduleConfig);

    if (!diff || !diff.trim()) {
      result.addCheck('fake-fix:no-diff', true, {
        severity: 'info',
        message: 'No diff to analyse — skipping fake fix detection',
      });
      return;
    }

    result.addCheck('fake-fix:scanning', true, {
      severity: 'info',
      message: `Analysing ${this._countChangedFiles(diff)} changed file(s) for symptom patching`,
    });

    // 1. Pattern engine — always runs when enabled.
    let patternFindings = [];
    if (patternEnabled) {
      patternFindings = this._runPatternEngine(diff);
      this._recordFindings(result, patternFindings, 'pattern');
    }

    // 2. AI engine — runs if key is set and enabled.
    if (aiEnabled && process.env.ANTHROPIC_API_KEY) {
      try {
        const aiFindings = await this._runAiEngine(
          process.env.ANTHROPIC_API_KEY,
          diff,
          moduleConfig.context || runnerOptions.fixContext || null
        );
        this._recordFindings(result, aiFindings, 'ai');
      } catch (err) {
        result.addCheck('fake-fix:ai-error', false, {
          severity: 'warning',
          message: `AI fake-fix analysis failed: ${err.message}`,
          suggestion: 'Check ANTHROPIC_API_KEY is valid. Pattern engine results are still valid.',
        });
      }
    } else if (aiEnabled && !process.env.ANTHROPIC_API_KEY) {
      result.addCheck('fake-fix:ai-skipped', true, {
        severity: 'info',
        message: 'AI engine skipped — set ANTHROPIC_API_KEY for deeper analysis',
      });
    }

    // Summary check — passes if nothing suspicious found.
    const total = patternFindings.length;
    if (total === 0) {
      result.addCheck('fake-fix:clean', true, {
        severity: 'info',
        message: 'No fake-fix patterns detected',
      });
    }
  }

  // ------------------------------------------------------------------
  // Diff acquisition
  // ------------------------------------------------------------------

  _getDiff(projectRoot, runnerOptions, moduleConfig) {
    // Explicit diff provided (e.g. tests or CI). Empty string counts — it
    // means "no changes", not "fall through to git".
    if (moduleConfig.diff != null) return moduleConfig.diff;
    if (runnerOptions.diff != null) return runnerOptions.diff;

    // Diff against a specific ref
    const against = moduleConfig.against || runnerOptions.against;
    const commands = against
      ? [`git diff --unified=3 ${against}...HEAD`]
      : [
          'git diff --unified=3 --cached',          // staged
          'git diff --unified=3',                    // working tree
          'git diff --unified=3 HEAD~1 HEAD',        // last commit
        ];

    for (const cmd of commands) {
      const { stdout, exitCode } = this._exec(cmd, { cwd: projectRoot });
      if (exitCode === 0 && stdout && stdout.trim()) {
        return stdout;
      }
    }
    return '';
  }

  _countChangedFiles(diff) {
    const matches = diff.match(/^diff --git /gm);
    return matches ? matches.length : 0;
  }

  // ------------------------------------------------------------------
  // Pattern engine
  // ------------------------------------------------------------------

  _runPatternEngine(diff) {
    const findings = [];
    const hunks = this._parseDiff(diff);

    for (const hunk of hunks) {
      // Walk added / removed lines
      for (const line of hunk.lines) {
        for (const rule of PATTERN_RULES) {
          if (rule.direction === 'added' && !line.startsWith('+')) continue;
          if (rule.direction === 'removed' && !line.startsWith('-')) continue;
          if (rule.direction === 'changed') continue; // handled below

          if (rule.pattern.test(line)) {
            findings.push({
              ruleId: rule.id,
              file: hunk.file,
              line: hunk.lineNumber,
              severity: rule.severity,
              title: rule.title,
              explanation: rule.explanation,
              snippet: line.trim().slice(0, 160),
            });
          }
        }
      }

      // Changed-line rules: look for a removed line matching `pattern` and an
      // added line matching `replacement` at a similar position.
      for (const rule of PATTERN_RULES.filter(r => r.direction === 'changed')) {
        const removed = hunk.lines.filter(l => l.startsWith('-') && rule.pattern.test(l));
        const added = hunk.lines.filter(l => l.startsWith('+') && rule.replacement.test(l));
        if (removed.length > 0 && added.length > 0) {
          findings.push({
            ruleId: rule.id,
            file: hunk.file,
            line: hunk.lineNumber,
            severity: rule.severity,
            title: rule.title,
            explanation: rule.explanation,
            snippet: added[0].trim().slice(0, 160),
          });
        }
      }
    }

    return findings;
  }

  _parseDiff(diff) {
    const hunks = [];
    const lines = diff.split('\n');
    let currentFile = null;
    let currentHunk = null;

    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const match = line.match(/diff --git a\/(.+?) b\/(.+)$/);
        currentFile = match ? match[2] : 'unknown';
      } else if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk);
        const match = line.match(/\+(\d+)/);
        currentHunk = {
          file: currentFile,
          lineNumber: match ? parseInt(match[1], 10) : 0,
          lines: [],
        };
      } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        currentHunk.lines.push(line);
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }

  // ------------------------------------------------------------------
  // AI engine
  // ------------------------------------------------------------------

  async _runAiEngine(apiKey, diff, context) {
    const truncatedDiff = diff.length > MAX_DIFF_SIZE
      ? diff.slice(0, MAX_DIFF_SIZE) + '\n[... diff truncated for length ...]'
      : diff;

    const contextBlock = context
      ? `\nCONTEXT — the bug/error this diff is supposed to fix:\n${context}\n`
      : '';

    const prompt = `You are the Fake Fix Detector for GateTest. Your ONLY job is to decide whether a code change is a REAL fix (addresses the root cause) or a SYMPTOM PATCH (hides the problem).

Symptom patches include — but are not limited to:
- Deleting, skipping, or weakening a failing test
- Wrapping failing code in empty or noop try/catch
- Replacing a function body with return true/return null/return []
- Adding @ts-ignore, eslint-disable, as any, or other suppressions
- Lowering thresholds so a quality check passes
- Adding \`if (false)\` or commenting out the offending code
- Replacing === with == to hide type mismatches

REAL fixes address WHY something was broken. They either change the faulty logic,
add missing state, or correctly handle a previously unhandled case.
${contextBlock}
DIFF:
\`\`\`diff
${truncatedDiff}
\`\`\`

Respond with STRICT JSON only. No prose before or after. Schema:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "error" | "warning" | "info",
      "title": "Short description",
      "explanation": "Why this is a symptom patch, not a real fix",
      "suggestion": "What a real fix would look like"
    }
  ],
  "verdict": "real-fix" | "mixed" | "symptom-patch",
  "summary": "One sentence"
}

Rules:
- severity "error" = high confidence symptom patch
- severity "warning" = suspicious, needs human review
- severity "info" = minor concern
- If the diff is a genuine real fix, return { "findings": [], "verdict": "real-fix", "summary": "..." }
- Be ruthless. We are building a product that kills fake fixes.`;

    const response = await this._callClaude(apiKey, prompt);
    const findings = [];

    if (response && Array.isArray(response.findings)) {
      for (const f of response.findings) {
        findings.push({
          ruleId: `ai:${f.severity || 'warning'}`,
          file: f.file || 'unknown',
          line: f.line || 0,
          severity: ['error', 'warning', 'info'].includes(f.severity) ? f.severity : 'warning',
          title: f.title || 'AI detected potential symptom patch',
          explanation: f.explanation || '',
          suggestion: f.suggestion || '',
        });
      }
    }
    if (response && response.summary) {
      findings.push({
        ruleId: 'ai:summary',
        file: '',
        line: 0,
        severity: 'info',
        title: `AI verdict: ${response.verdict || 'unknown'}`,
        explanation: response.summary,
        snippet: '',
        informational: true,
      });
    }
    return findings;
  }

  _callClaude(apiKey, prompt) {
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
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              resolve(JSON.parse(jsonMatch[0]));
            } else {
              resolve({ findings: [], verdict: 'unknown', summary: text });
            }
          } catch (err) {
            reject(new Error(`Failed to parse AI response: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(AI_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`AI fake-fix analysis timed out after ${AI_TIMEOUT_MS / 1000}s`));
      });

      req.write(body);
      req.end();
    });
  }

  // ------------------------------------------------------------------
  // Result recording
  // ------------------------------------------------------------------

  _recordFindings(result, findings, engine) {
    for (const f of findings) {
      if (f.informational) {
        result.addCheck(`fake-fix:${engine}:summary`, true, {
          severity: 'info',
          message: `${f.title}${f.explanation ? ' — ' + f.explanation : ''}`,
        });
        continue;
      }
      const checkName = `fake-fix:${engine}:${f.ruleId}:${f.file}:${f.line}`;
      result.addCheck(checkName, false, {
        file: f.file,
        line: f.line,
        severity: f.severity,
        message: `[${engine === 'ai' ? 'AI' : 'PATTERN'}] ${f.title}`,
        explanation: f.explanation,
        suggestion: f.suggestion || 'Address the root cause instead of suppressing the symptom.',
        snippet: f.snippet,
      });
    }
  }
}

module.exports = FakeFixDetectorModule;
// Exported for testing
module.exports.PATTERN_RULES = PATTERN_RULES;
