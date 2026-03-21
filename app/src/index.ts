import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { PORT } from './config.js';
import { ScixClient } from './clients/scix.js';
import { scixSearchSchema, handleScixSearch } from './tools/scix_search.js';
import { scixGetPaperSchema, handleScixGetPaper } from './tools/scix_get_paper.js';
import { scixGetCitationsSchema, handleScixGetCitations } from './tools/scix_get_citations.js';
import { scixGetMetricsSchema, handleScixGetMetrics } from './tools/scix_get_metrics.js';
import { arxivSearchSchema, handleArxivSearch } from './tools/arxiv_search.js';
import { arxivGetPaperSchema, handleArxivGetPaper } from './tools/arxiv_get_paper.js';

// ── MCP server factory ───────────────────────────────────────────────────────
// Stateless: one McpServer instance per request.

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'research-remote-mcp', version: '1.0.0' });
  const scix = new ScixClient();

  // ── SciX tools ─────────────────────────────────────────────────────────

  server.tool(
    'scix_search',
    'Search NASA SciX / ADS (Astrophysics Data System) for peer-reviewed papers. ' +
    'Covers astronomy, astrophysics, planetary science, and related fields. ' +
    'Returns bibcodes, titles, authors, citation counts. Use bibcodes with scix_get_paper for details.',
    scixSearchSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixSearch(scix, input) }],
    })
  );

  server.tool(
    'scix_get_paper',
    'Get full metadata and abstract for a specific paper in SciX/ADS using its bibcode, arXiv ID, or DOI.',
    scixGetPaperSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetPaper(scix, input) }],
    })
  );

  server.tool(
    'scix_get_citations',
    'Get papers that cite a given SciX/ADS paper (citations), or papers it cites (references). ' +
    'Useful for exploring research networks and finding related work.',
    scixGetCitationsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetCitations(scix, input) }],
    })
  );

  server.tool(
    'scix_get_metrics',
    'Compute citation metrics (h-index, g-index, i10-index, total citations) for a set of papers by bibcode.',
    scixGetMetricsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetMetrics(scix, input) }],
    })
  );

  // ── arXiv tools ────────────────────────────────────────────────────────

  server.tool(
    'arxiv_search',
    'Search arXiv preprint server for papers across all scientific disciplines. ' +
    'Supports field prefixes: ti: (title), au: (author), abs: (abstract), cat: (category). ' +
    'Returns arXiv IDs, titles, authors, categories. Use arxiv_get_paper for full abstract.',
    arxivSearchSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleArxivSearch(input) }],
    })
  );

  server.tool(
    'arxiv_get_paper',
    'Get full metadata and abstract for a specific arXiv paper by its ID (e.g. "2103.01231"). ' +
    'Returns title, authors, abstract, categories, and links to PDF and HTML versions.',
    arxivGetPaperSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleArxivGetPaper(input) }],
    })
  );

  return server;
}

// ── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'research-remote-mcp' });
});

// Express v5: async errors auto-propagate — no try/catch needed.
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', (_req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    detail: 'Stateless Streamable HTTP — send POST to /mcp.',
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed', detail: 'Stateless server has no sessions.' });
});

// Express v5 error handler (4-arg signature required)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('MCP error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`research-remote-mcp on :${PORT}  →  POST /mcp`);
});
