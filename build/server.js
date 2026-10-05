import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { INSTRUCTIONS, registerPrompts } from './prompts.js';
import { registerArxivTools } from './tools/arxiv.js';
import { registerScixLibraryTools } from './tools/scix_libraries.js';
import { registerScixAuthorTools } from './tools/scix_authors.js';
import { registerAlertTools } from './tools/alerts.js';
import { registerHealthTool } from './tools/health.js';
import { registerScixDocsTool, registerScixTools } from './tools/scix.js';
const pkg = createRequire(import.meta.url)('../package.json');
// ── MCP server factory ───────────────────────────────────────────────────────
export function buildServer() {
    const server = new McpServer({ name: 'scix-arxiv-mcp', version: pkg.version }, { instructions: INSTRUCTIONS });
    // Registration order is the tools/list order (locked by test/contract.json):
    // SciX/ADS tools (core, authors/objects, docs), then SciX libraries, then arXiv, then health_check.
    registerScixTools(server);
    registerScixAuthorTools(server);
    registerScixDocsTool(server);
    registerScixLibraryTools(server);
    registerArxivTools(server);
    registerAlertTools(server);
    registerHealthTool(server);
    registerPrompts(server);
    return server;
}
