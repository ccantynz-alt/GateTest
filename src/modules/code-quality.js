/**
 * Code Quality Module - Enforces coding standards and quality metrics.
 * Catches console.log, debugger, TODO/FIXME, eval, and complexity issues.
 */

const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class CodeQualityModule extends BaseModule {
  constructor() {
    super('codeQuality', 'Code Quality Analysis');
  }

  async run(result, config) {
    const projectRoot = config.projectRoot;
    const moduleConfig = config.getModuleConfig('codeQuality');
    const thresholds = config.config.thresholds;

    const sourceFiles = this._collectFiles(projectRoot, ['.js', '.ts', '.jsx', '.tsx']);

    for (const file of sourceFiles) {
      const relPath = path.relative(projectRoot, file);
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      // Check forbidden patterns
      this._checkForbiddenPatterns(relPath, content, lines, moduleConfig, result);

      // Check function length
      this._checkFunctionLength(relPath, lines, thresholds.maxFunctionLength, result);

      // Check file length
      if (lines.length > thresholds.maxFileLength) {
        result.addCheck(`quality:file-length:${relPath}`, false, {
          file: relPath,
          expected: `<= ${thresholds.maxFileLength} lines`,
          actual: `${lines.length} lines`,
          suggestion: 'Split this file into smaller, focused modules',
        });
      }

      // Check for commented-out code blocks
      this._checkCommentedCode(relPath, lines, result);

      // Check for unused imports (basic heuristic)
      this._checkUnusedImports(relPath, content, lines, result);
    }

    if (sourceFiles.length === 0) {
      result.addCheck('code-quality-scan', true, { message: 'No source files to check' });
    }
  }

  _checkForbiddenPatterns(relPath, content, lines, moduleConfig, result) {
    const patterns = moduleConfig.forbiddenPatterns || [];
    for (const { pattern, message } of patterns) {
      // Clone regex to reset lastIndex
      const regex = new RegExp(pattern.source, pattern.flags);
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (regex.test(lines[i])) {
          result.addCheck(`quality:${message}:${relPath}:${i + 1}`, false, {
            file: relPath,
            line: i + 1,
            message: `${message} at line ${i + 1}`,
            suggestion: 'Remove or replace this pattern before committing',
          });
        }
      }
    }
  }

  _checkFunctionLength(relPath, lines, maxLength, result) {
    let braceDepth = 0;
    let functionStart = -1;
    let functionName = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect function declarations
      const funcMatch = line.match(/(?:function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?(?:function|\(.*?\)\s*=>))/);
      if (funcMatch && braceDepth === 0) {
        functionName = funcMatch[1] || funcMatch[2] || 'anonymous';
        functionStart = i;
      }

      // Count braces
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') {
          braceDepth--;
          if (braceDepth === 0 && functionStart >= 0) {
            const length = i - functionStart + 1;
            if (length > maxLength) {
              result.addCheck(`quality:function-length:${relPath}:${functionName}`, false, {
                file: relPath,
                line: functionStart + 1,
                expected: `<= ${maxLength} lines`,
                actual: `${length} lines`,
                message: `Function "${functionName}" is ${length} lines (max ${maxLength})`,
                suggestion: 'Extract helper functions to reduce complexity',
              });
            }
            functionStart = -1;
          }
        }
      }
    }
  }

  _checkCommentedCode(relPath, lines, result) {
    let commentBlock = 0;
    let commentStart = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // Heuristic: lines starting with // that look like code
      if (trimmed.startsWith('//') && /\/\/\s*(const|let|var|function|if|for|while|return|import|export|class)\s/.test(trimmed)) {
        if (commentBlock === 0) commentStart = i;
        commentBlock++;
      } else {
        if (commentBlock >= 3) {
          result.addCheck(`quality:commented-code:${relPath}:${commentStart + 1}`, false, {
            file: relPath,
            line: commentStart + 1,
            message: `${commentBlock} lines of commented-out code starting at line ${commentStart + 1}`,
            suggestion: 'Remove commented-out code — use version control instead',
          });
        }
        commentBlock = 0;
      }
    }
  }

  _checkUnusedImports(relPath, content, lines, result) {
    const importRegex = /(?:import\s+(?:{([^}]+)}|(\w+))\s+from|const\s+(?:{([^}]+)}|(\w+))\s*=\s*require\()/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const imported = match[1] || match[2] || match[3] || match[4];
      if (!imported) continue;

      const names = imported.split(',').map(n => n.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);

      for (const name of names) {
        if (!name || name === '*') continue;
        // Count occurrences (subtract the import line itself)
        const occurrences = content.split(new RegExp(`\\b${name}\\b`)).length - 1;
        if (occurrences <= 1) {
          result.addCheck(`quality:unused-import:${relPath}:${name}`, false, {
            file: relPath,
            message: `Import "${name}" appears unused`,
            suggestion: `Remove unused import "${name}"`,
          });
        }
      }
    }
  }
}

module.exports = CodeQualityModule;
