/**
 * Base Module - Abstract base class for all GateTest test modules.
 *
 * Phase 6 launch hardening (gaps 1, 2, 3, 6, 7 from the audit):
 *   - _collectFiles now delegates to src/core/safe-fs.walkFiles which:
 *       * caps total files (default 5000, configurable via opts.maxFiles)
 *       * caps recursion depth (default 25)
 *       * traps EACCES / EPERM / EISDIR / ENOENT per-entry (one bad
 *         file no longer kills the scan)
 *       * follows symlinks via realpath with loop protection
 *       * optionally respects .gitignore (opts.respectGitignore)
 *   - _safeReadFile traps the same set of FS errors at read time and
 *     refuses oversize / binary / non-utf8 files cleanly
 *
 * Old _collectFiles signature preserved (projectRoot, patterns, excludes)
 * — every existing call site keeps working.
 */

const safeFs = require('../core/safe-fs');

class BaseModule {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  /**
   * Run the module's checks.
   * @param {TestResult} result - The result object to record checks against.
   * @param {GateTestConfig} config - The GateTest configuration.
   */
  async run(result, config) {
    throw new Error(`Module "${this.name}" must implement run()`);
  }

  /**
   * Collect files matching extension patterns from projectRoot.
   *
   * @param {string} projectRoot
   * @param {string[]} patterns — file extensions including dot (e.g. ['.js', '.ts'])
   *   or ['*'] to match any extension
   * @param {string[]} [excludes] — extra directory names to skip
   * @param {object} [opts] — { maxFiles, maxDepth, respectGitignore }
   *   maxFiles defaults to 5000; pass higher for monorepos that genuinely need
   *   deeper scans, lower for routes with tight time budgets
   * @returns {string[]} absolute paths
   */
  _collectFiles(projectRoot, patterns, excludes = [], opts = {}) {
    const path = require('path');
    const allowAny = patterns.includes('*');
    const allowedExts = new Set(patterns.map((p) => p.toLowerCase()));

    // Merge module's extra excludes into the default skip set.
    // .gatetest, .claude (agent worktrees), .svelte-kit, .output, .vercel
    // are GateTest-specific noise sources not in the safe-fs default list.
    const skipDirs = new Set(safeFs.DEFAULT_SKIP_DIRS);
    skipDirs.add('.gatetest');
    skipDirs.add('.claude');
    skipDirs.add('.svelte-kit');
    skipDirs.add('.output');
    skipDirs.add('.vercel');
    skipDirs.add('public/build');
    skipDirs.add('.cargo');
    for (const e of excludes) skipDirs.add(e);

    const walk = safeFs.walkFiles(projectRoot, {
      skipDirs,
      maxFiles: typeof opts.maxFiles === 'number' ? opts.maxFiles : safeFs.DEFAULT_MAX_FILES,
      maxDepth: typeof opts.maxDepth === 'number' ? opts.maxDepth : safeFs.DEFAULT_MAX_DEPTH,
      respectGitignore: opts.respectGitignore === true,
      filter: (rel) => {
        const ext = path.extname(rel).toLowerCase();
        return allowAny || allowedExts.has(ext);
      },
    });

    // Surface the truncation as a side-channel field readable by callers
    // that care to expose it (e.g. info-level "X files skipped over cap").
    if (walk.truncatedAt !== null) {
      this._lastWalkTruncated = walk.truncatedAt;
    } else {
      this._lastWalkTruncated = null;
    }
    this._lastWalkSkipped = walk.skipped;

    return walk.files;
  }

  /**
   * Read a single file safely. Returns { ok, content?, encoding?, reason?, size? }.
   * Modules should prefer this over fs.readFileSync — callers don't need to
   * wrap in try/catch and oversize/binary/encoding-mangled files are filtered
   * out cleanly with a structured `reason`.
   */
  _safeReadFile(filePath, opts = {}) {
    return safeFs.safeReadFile(filePath, opts);
  }

  /**
   * Run a shell command and return { stdout, stderr, exitCode }.
   */
  _exec(command, options = {}) {
    const { execSync } = require('child_process');
    try {
      const stdout = execSync(command, {
        encoding: 'utf-8',
        timeout: options.timeout || 60000,
        cwd: options.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        exitCode: err.status || 1,
      };
    }
  }
}

module.exports = BaseModule;
