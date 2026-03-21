import { serve } from '@hono/node-server';
import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { PORT } from './config.js';
import { ScixClient } from './clients/scix.js';

// SciX tools
import { scixSearchSchema, handleScixSearch } from './tools/scix_search.js';
import { scixGetPaperSchema, handleScixGetPaper } from './tools/scix_get_paper.js';
import { scixGetCitationsSchema, handleScixGetCitations } from './tools/scix_get_citations.js';
import { scixGetMetricsSchema, handleScixGetMetrics } from './tools/scix_get_metrics.js';
import { scixExportSchema, handleScixExport } from './tools/scix_export.js';
import {
  scixLibraryListSchema, handleScixLibraryList,
  scixLibraryGetSchema, handleScixLibraryGet,
  scixLibraryCreateSchema, handleScixLibraryCreate,
  scixLibraryDocumentsSchema, handleScixLibraryDocuments,
} from './tools/scix_library.js';

// arXiv tools
import { arxivSearchSchema, handleArxivSearch } from './tools/arxiv_search.js';
import { arxivGetPaperSchema, handleArxivGetPaper } from './tools/arxiv_get_paper.js';

// ── MCP server factory ───────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'research-remote-mcp', version: '1.0.0' });
  const scix = new ScixClient();

  // ── SciX search & retrieval ────────────────────────────────────────────

  server.tool(
    'scix_search',
    'Search NASA SciX / ADS (Astrophysics Data System) for peer-reviewed papers. ' +
    'Covers astronomy, astrophysics, physics, planetary science, and related fields. ' +
    'Returns bibcodes, titles, authors, citation counts. Use scix_get_paper for full details.',
    scixSearchSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixSearch(scix, input) }],
    })
  );

  server.tool(
    'scix_get_paper',
    'Get full metadata and abstract for a paper in SciX/ADS by its bibcode, arXiv ID, or DOI.',
    scixGetPaperSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetPaper(scix, input) }],
    })
  );

  server.tool(
    'scix_get_citations',
    'Get papers that cite a given SciX/ADS paper (citations), or papers it cites (references).',
    scixGetCitationsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetCitations(scix, input) }],
    })
  );

  server.tool(
    'scix_get_metrics',
    'Compute citation metrics (h-index, g-index, i10-index, citation counts) for a set of papers.',
    scixGetMetricsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixGetMetrics(scix, input) }],
    })
  );

  // ── SciX export ────────────────────────────────────────────────────────

  server.tool(
    'scix_export',
    'Export a list of papers in a bibliography format. ' +
    'Supports BibTeX, RIS (Zotero/Mendeley), EndNote, AASTeX, IEEE, MNRAS, and 18 other formats. ' +
    'Pass bibcodes from scix_search results. Ideal for building reference lists.',
    scixExportSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixExport(scix, input) }],
    })
  );

  // ── SciX libraries ─────────────────────────────────────────────────────

  server.tool(
    'scix_library_list',
    'List your SciX personal libraries (saved paper collections). ' +
    'Returns library IDs, names, paper counts, and permissions.',
    scixLibraryListSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixLibraryList(scix, input) }],
    })
  );

  server.tool(
    'scix_library_get',
    'Get the contents and metadata of a specific SciX library by its ID.',
    scixLibraryGetSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixLibraryGet(scix, input) }],
    })
  );

  server.tool(
    'scix_library_create',
    'Create a new personal library in SciX to save and organize papers.',
    scixLibraryCreateSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixLibraryCreate(scix, input) }],
    })
  );

  server.tool(
    'scix_library_documents',
    'Add or remove papers from a SciX library. Pass bibcodes and "add" or "remove".',
    scixLibraryDocumentsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixLibraryDocuments(scix, input) }],
    })
  );

  // ── arXiv ──────────────────────────────────────────────────────────────

  server.tool(
    'arxiv_search',
    'Search arXiv preprint server across all scientific disciplines. ' +
    'Supports field prefixes (ti:, au:, abs:, cat:), date ranges, and category filters.',
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

  // ── Prompts ────────────────────────────────────────────────────────────

  server.prompt(
    'research_discovery',
    'Begin exploring a research topic: search for relevant papers, identify key authors, ' +
    'and map the research landscape.',
    {
      topic: z.string().describe('Research topic or question to explore'),
      expertise_level: z.enum(['beginner', 'intermediate', 'expert'])
        .default('intermediate')
        .describe('Your familiarity with the topic'),
      time_period: z.string().optional().describe('Time period of interest, e.g. "2020-present"'),
      domain: z.string().optional().describe('Domain hint, e.g. "machine learning", "astrophysics"'),
    },
    ({ topic, expertise_level, time_period, domain }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `I want to explore the research topic: **${topic}**`,
            domain ? `Domain: ${domain}` : '',
            time_period ? `Time period: ${time_period}` : '',
            `My expertise level: ${expertise_level}`,
            '',
            'Please help me:',
            '1. Search for the most influential recent papers on this topic using scix_search and arxiv_search',
            '2. Identify key authors and research groups',
            '3. Summarize the main open questions and research directions',
            '4. Suggest 3-5 foundational papers I should read first',
          ].filter(Boolean).join('\n'),
        },
      }],
    })
  );

  server.prompt(
    'deep_paper_analysis',
    'Perform a deep analysis of a specific arXiv paper: methodology, contributions, ' +
    'limitations, and position in the literature.',
    {
      paper_id: z.string().describe('arXiv paper ID, e.g. "2103.01231"'),
      focus: z.enum([
        'methodology', 'results', 'limitations', 'related_work', 'reproducibility',
      ]).default('methodology').describe('Aspect to focus the analysis on'),
    },
    ({ paper_id, focus }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Please perform a deep analysis of arXiv paper: **${paper_id}**`,
            `Focus: **${focus}**`,
            '',
            'Steps:',
            '1. Retrieve the paper with arxiv_get_paper',
            '2. Also check SciX for citation metrics with scix_get_paper (if indexed)',
            '3. Analyze the paper with focus on: ' + focus,
            '4. Structure your analysis as:',
            '   - Executive summary (3-5 sentences)',
            '   - Key contributions',
            '   - Methodology / approach',
            '   - Results and significance',
            '   - Limitations and open questions',
            '   - Related work and context',
          ].join('\n'),
        },
      }],
    })
  );

  server.prompt(
    'literature_synthesis',
    'Synthesize findings across multiple papers into a coherent review of the state of the art.',
    {
      paper_ids: z.string().describe('Comma-separated arXiv or SciX bibcodes'),
      synthesis_goal: z.string().optional().describe(
        'What you want to understand, e.g. "compare approaches to X", "find consensus on Y"'
      ),
    },
    ({ paper_ids, synthesis_goal }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Please synthesize the following papers:',
            paper_ids.split(',').map(id => `- ${id.trim()}`).join('\n'),
            synthesis_goal ? `\nGoal: ${synthesis_goal}` : '',
            '',
            'Steps:',
            '1. Retrieve each paper using arxiv_get_paper or scix_get_paper',
            '2. Identify common themes, agreements, and disagreements',
            '3. Produce a synthesis covering:',
            '   - Shared findings and consensus',
            '   - Contradictions or open debates',
            '   - Methodological differences',
            '   - Overall state of the art and next steps',
          ].filter(Boolean).join('\n'),
        },
      }],
    })
  );

  return server;
}

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: HttpBindings }>();

app.get('/health', (c) => c.json({ status: 'ok', server: 'research-remote-mcp' }));

app.post('/mcp', async (c) => {
  const { incoming, outgoing } = c.env;
  const body = await c.req.json().catch(() => undefined);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();

  outgoing.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(incoming, outgoing, body);

  return RESPONSE_ALREADY_SENT;
});

app.get('/mcp', (c) =>
  c.json({ error: 'Method Not Allowed', detail: 'Stateless Streamable HTTP — send POST to /mcp.' }, 405)
);

app.delete('/mcp', (c) =>
  c.json({ error: 'Method Not Allowed', detail: 'Stateless server has no sessions.' }, 405)
);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`research-remote-mcp on :${PORT}  →  POST /mcp`);
});
