#!/usr/bin/env node
/**
 * GateTest MCP Server
 *
 * Exposes GateTest as a Model Context Protocol server. Any MCP-compatible
 * AI — Claude Code, Cursor, Continue, etc. — can call GateTest directly
 * without needing webhooks, the web app, or any external infrastructure.
 *
 * Transport: stdio (connect via "command" in mcp_servers config)
 *
 * Usage in Claude Code (.claude/mcp_servers.json or settings.json):
 *   {
 *     "mcpServers": {
 *       "gatetest": {
 *         "command": "node",
 *         "args": ["/path/to/GateTest/bin/gatetest-mcp.mjs"]
 *       }
 *     }
 *   }
 *
 * Or if installed globally:
 *   { "command": "gatetest-mcp" }
 *
 * Tools exposed:
 *   scan_local       — scan a local directory path
 *   run_module       — run one specific module against a path
 *   list_modules     — list all 90 modules with descriptions
 *   check_health     — verify GateTest engine is operational
 */

import { createRequire } from 'module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import CJS GateTest engine via createRequire (SDK is ESM, engine is CJS)
const require = createRequire(import.meta.url);
const { GateTest } = require('../src/index.js');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'scan_local',
    description:
      'Scan a local directory with GateTest\'s 90-module engine. ' +
      'Returns issues found across security, reliability, code quality, ' +
      'and more. Use suite="quick" for the 4 core modules or suite="full" ' +
      'for all 90 modules. Optionally pass a list of specific module names.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the directory to scan',
        },
        suite: {
          type: 'string',
          enum: ['quick', 'standard', 'full'],
          description: 'Which module suite to run (default: standard)',
        },
        modules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of specific module names to run instead of a suite',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'run_module',
    description:
      'Run a single GateTest module against a local directory. ' +
      'Use list_modules to see all available module names.',
    inputSchema: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          description: 'Module name (e.g. "secrets", "tlsSecurity", "importCycle")',
        },
        path: {
          type: 'string',
          description: 'Absolute path to the directory to scan',
        },
      },
      required: ['module', 'path'],
    },
  },
  {
    name: 'list_modules',
    description:
      'List all 68 GateTest modules with their names and descriptions. ' +
      'Use this to discover what modules are available before calling ' +
      'scan_local with a specific modules list.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_health',
    description:
      'Verify GateTest is operational. Returns version, module count (90), ' +
      'and a list of all loaded module names.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function formatScanResult(result) {
  const lines = [];
  const blocked = result.gateStatus === 'BLOCKED';
  const status = blocked ? '❌ BLOCKED' : '✅ PASSED';
  lines.push(`## GateTest Scan — ${status}`);
  lines.push('');

  const allResults = result.results || [];
  const totalErrors = allResults.reduce((s, r) => s + (r.errors || 0), 0);
  const totalWarnings = allResults.reduce((s, r) => s + (r.warnings || 0), 0);
  const duration = result.duration ? `${(result.duration / 1000).toFixed(1)}s` : '?';
  lines.push(`**Duration:** ${duration}  |  **Errors:** ${totalErrors}  |  **Warnings:** ${totalWarnings}`);
  lines.push('');

  if (allResults.length === 0) {
    lines.push('No modules ran.');
    return lines.join('\n');
  }

  const withIssues = allResults.filter(r => (r.errors || 0) > 0 || (r.warnings || 0) > 0);
  const passed = allResults.filter(r => (r.errors || 0) === 0 && (r.warnings || 0) === 0);

  if (withIssues.length > 0) {
    lines.push('### Issues found');
    lines.push('');
    for (const mod of withIssues) {
      const modName = mod.module || mod.name || 'unknown';
      const issueCount = (mod.errors || 0) + (mod.warnings || 0);
      lines.push(`**\`${modName}\`** — ${issueCount} issue${issueCount === 1 ? '' : 's'} (${mod.errors || 0} errors, ${mod.warnings || 0} warnings)`);
      const flaggedChecks = (mod.checks || []).filter(c => c.severity === 'error' || c.severity === 'warning');
      for (const check of flaggedChecks.slice(0, 5)) {
        const loc = check.file ? ` (${check.file}${check.line ? `:${check.line}` : ''})` : '';
        lines.push(`  - [${check.severity}] ${check.message}${loc}`);
      }
      if (flaggedChecks.length > 5) {
        lines.push(`  - …and ${flaggedChecks.length - 5} more`);
      }
      lines.push('');
    }
  }

  if (passed.length > 0) {
    lines.push(`### Passed (${passed.length} module${passed.length === 1 ? '' : 's'})`);
    lines.push(passed.map(r => `\`${r.module || r.name}\``).join(', '));
  }

  return lines.join('\n');
}

async function handleScanLocal(args) {
  const { path: scanPath, suite, modules } = args;

  if (!scanPath || typeof scanPath !== 'string') {
    return { content: [{ type: 'text', text: 'Error: path is required and must be a string' }], isError: true };
  }

  try {
    const gt = new GateTest(scanPath, { silent: true }).init();

    let result;
    if (modules && Array.isArray(modules) && modules.length > 0) {
      // Run specific modules
      result = await gt._run(modules);
    } else {
      const s = suite || 'standard';
      result = await gt.runSuite(s);
    }

    const text = formatScanResult(result);
    const json = JSON.stringify(result, null, 2);
    return {
      content: [
        { type: 'text', text },
        { type: 'text', text: `\n<details>\n<summary>Full JSON result</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n</details>` },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Scan failed: ${err && err.message ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

async function handleRunModule(args) {
  const { module: moduleName, path: scanPath } = args;

  if (!moduleName || !scanPath) {
    return { content: [{ type: 'text', text: 'Error: module and path are both required' }], isError: true };
  }

  try {
    const gt = new GateTest(scanPath, { silent: true }).init();
    const result = await gt.runModule(moduleName);
    const text = formatScanResult(result);
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Module run failed: ${err && err.message ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

async function handleListModules() {
  try {
    const gt = new GateTest(process.cwd()).init();
    const allModules = gt.registry.getAll();
    const lines = [`## GateTest Modules (${allModules.size} total)`, ''];

    for (const [name, mod] of allModules) {
      const desc = mod.description || mod.name || name;
      lines.push(`**\`${name}\`** — ${desc}`);
    }

    lines.push('');
    lines.push(`Total: ${allModules.size} modules loaded`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Failed to list modules: ${err && err.message ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

async function handleCheckHealth() {
  try {
    const gt = new GateTest(process.cwd()).init();
    const moduleNames = gt.registry.list();
    return {
      content: [{
        type: 'text',
        text: `## GateTest Health\n\n✅ **Operational**\n\n- Engine: GateTest v1.41.0\n- Modules loaded: ${moduleNames.length}\n- Transport: stdio`,
      }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Health check failed: ${err && err.message ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'gatetest', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case 'scan_local':    return handleScanLocal(args);
    case 'run_module':    return handleRunModule(args);
    case 'list_modules':  return handleListModules();
    case 'check_health':  return handleCheckHealth();
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
