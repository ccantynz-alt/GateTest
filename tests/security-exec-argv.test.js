// =============================================================================
// SECURITY — an argv array is not a shell command
// =============================================================================
// We reported this as CRITICAL on ccantynz/Gluecron.com @e168803 (gluecron.com,
// org ccantynz), and it was returned as our false positive with the mechanism:
//
//     const res = await exec(["git", "show", `${ref}:${manifestPath}`], repoDir);
//
// Node's `exec` / `execSync` take a command STRING and hand it to a shell.
// Neither can accept an array. So a call whose first argument is an array
// literal is a project's own argv-style helper that merely shares the name —
// no shell ever parses that interpolation, and there is nothing to inject
// into.
//
// The rule's own comment already carried the principle: "execFile/spawn take
// an argv array and are the SAFE alternative — flagging those would punish the
// correct fix." It keyed that on the callee's NAME. The safety property lives
// in the ARGUMENT'S SHAPE, and a helper named `exec` taking argv is the safe
// form wearing the unsafe name. Argv call sites are common across Bun and
// Node codebases, so this was not a niche misfire.
//
// The exclusion is exactly one character of lookahead and nothing more. The
// second group below is what keeps it that way — `exec(cmd + input)` with no
// leading quote still fires, because that one really can reach a shell.
// =============================================================================

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SecurityModule = require('../src/modules/security');

async function execFindings(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-exec-'));
  try {
    fs.writeFileSync(path.join(root, 'run.js'), source);
    const checks = [];
    const result = {
      addCheck(id, passed, meta) { checks.push({ id, passed, meta: meta || {} }); },
      addInfo() {},
    };
    await new SecurityModule().run(result, { projectRoot: root });
    return checks.filter((c) => !c.passed && /shell exec with interpolated/i.test(c.id));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('security — argv arrays do not reach a shell', () => {
  const SAFE = {
    'the Gluecron call site verbatim':
      'const res = await exec(["git", "show", `${ref}:${manifestPath}`], repoDir);\n',
    'argv array with concatenation inside':
      'const r = exec(["ls", "-la", dir + suffix]);\n',
    'argv array spanning the call':
      'const r = exec([\n  "git",\n  `${ref}`,\n]);\n',
    // The callee is not a shell exec at all (2026-09-05, measured on got and
    // prisma when the match moved onto the masked line): RegExp#exec and a
    // database handle's exec share the name and reach no shell.
    'RegExp#exec with a template argument (got, is-unix-socket-url.ts)':
      'return /^(?<socketPath>[^:]+):/v.exec(`${url.pathname}${url.search}`)?.groups?.socketPath;\n',
    'a database handle\'s exec (prisma sqlite fixture)':
      "rawDb.exec(`INSERT INTO posts (id, title) VALUES ${values.join(', ')}`);\n",
  };

  for (const [why, src] of Object.entries(SAFE)) {
    it(`silent: ${why}`, async () => {
      const found = await execFindings(src);
      assert.deepStrictEqual(
        found.map((f) => f.id), [],
        `${why} passes argv, not a shell string — nothing can be injected`,
      );
    });
  }
});

describe('security — genuine shell strings still fire', () => {
  // The load-bearing half. Excluding a leading `[` must not become excluding
  // interpolation generally; each of these really can reach a shell.
  const UNSAFE = {
    'string concatenation': 'const out = exec("ls " + dir);\n',
    'template literal': 'const out = exec(`ls ${dir}`);\n',
    'execSync with concatenation': 'const out = execSync("git checkout " + ref);\n',
    'bare variable concatenation, no leading quote': 'const out = exec(baseCmd + userInput);\n',
    // Qualified by the module — the same shell, so the same finding.
    'child_process.exec with a template': 'const out = child_process.exec(`ls ${dir}`);\n',
    'cp.execSync with concatenation': 'const out = cp.execSync("git checkout " + ref);\n',
  };

  for (const [why, src] of Object.entries(UNSAFE)) {
    it(`fires: ${why}`, async () => {
      const found = await execFindings(src);
      assert.ok(
        found.length > 0,
        `${why} builds a shell command from interpolated input and must be reported`,
      );
    });
  }
});
