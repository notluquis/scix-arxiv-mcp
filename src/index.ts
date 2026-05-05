import { serve } from '@hono/node-server';
import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { PORT } from './config.js';
import { getScixClient } from './clients/scix.js';

// SciX tools
import { scixSearchSchema, handleScixSearch } from './tools/scix_search.js';
import { scixGetPaperSchema, handleScixGetPaper } from './tools/scix_get_paper.js';
import { scixGetCitationsSchema, handleScixGetCitations } from './tools/scix_get_citations.js';
import { scixGetMetricsSchema, handleScixGetMetrics } from './tools/scix_get_metrics.js';
import { scixExportSchema, handleScixExport } from './tools/scix_export.js';
import { scixFindSimilarSchema, handleScixFindSimilar } from './tools/scix_find_similar.js';
import { scixSearchDocsSchema, handleScixSearchDocs } from './tools/scix_search_docs.js';
import {
  scixLibraryListSchema, handleScixLibraryList,
  scixLibraryGetSchema, handleScixLibraryGet,
  scixLibraryCreateSchema, handleScixLibraryCreate,
  scixLibraryDocumentsSchema, handleScixLibraryDocuments,
} from './tools/scix_library.js';
import { scixLibraryNoteSchema, handleScixLibraryNote } from './tools/scix_library_note.js';

// arXiv tools
import { arxivSearchSchema, handleArxivSearch } from './tools/arxiv_search.js';
import { arxivGetPaperSchema, handleArxivGetPaper } from './tools/arxiv_get_paper.js';
import { arxivReadPaperSchema, handleArxivReadPaper } from './tools/arxiv_read_paper.js';
import { arxivDownloadPaperSchema, handleArxivDownloadPaper } from './tools/arxiv_download_paper.js';

// ── MCP server factory ───────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'research-remote-mcp', version: '1.0.0' });
  const scix = getScixClient();

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

  server.tool(
    'scix_find_similar',
    'Find papers with similar content to a given SciX/ADS paper using its bibcode. ' +
    'Uses the SciX similar() operator to surface related work.',
    scixFindSimilarSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixFindSimilar(scix, input) }],
    })
  );

  server.tool(
    'scix_search_docs',
    'Search SciX help docs, search syntax guides, and usage notes.',
    scixSearchDocsSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixSearchDocs(input) }],
    })
  );

  server.tool(
    'scix_library_note',
    'Get, set, or delete a personal annotation note for a paper in a SciX library.',
    scixLibraryNoteSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleScixLibraryNote(scix, input) }],
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

  server.tool(
    'arxiv_read_paper',
    'Fetch a paper from arXiv and extract its full text from the HTML rendering or source archive as markdown-ready text.',
    arxivReadPaperSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleArxivReadPaper(input) }],
    })
  );

  server.tool(
    'arxiv_download_paper',
    'Download a paper from arXiv and extract full text from the PDF. Directly fetches and processes the PDF file.',
    arxivDownloadPaperSchema,
    async (input) => ({
      content: [{ type: 'text', text: await handleArxivDownloadPaper(input) }],
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
            `Analyze paper ${paper_id}.`,
            '',
            'Present your analysis with the following structure:',
            '1. Executive Summary: 3-5 sentence overview of key contributions',
            `2. Detailed Analysis: Following the requested focus: ${focus}`,
            '3. Visual Breakdown: Describe key figures/tables and their significance',
            '4. Related Work Map: Position this paper within the research landscape',
            '5. Implementation Notes: Practical considerations for applying these findings',
            '',
            'You are an AI research assistant tasked with analyzing academic papers from arXiv.',
            'You have access to several tools to help with this analysis:',
            '',
            'AVAILABLE TOOLS:',
            '1. arxiv_read_paper: Use this tool to retrieve the full content of the paper with the provided arXiv ID',
            '2. arxiv_download_paper: If HTML/TeX extraction is insufficient, use this tool to extract full text from the PDF',
            '3. arxiv_search: Find related papers on the same topic to provide context',
            '4. arxiv_get_paper: Retrieve authoritative arXiv metadata and abstract',
            '5. scix_get_paper, scix_get_citations, scix_get_metrics, and scix_find_similar: Cross-check SciX/ADS metadata, citations, metrics, and related work when indexed',
            '',
            '<workflow-for-paper-analysis>',
            '<preparation>',
            '  - First, use arxiv_get_paper to retrieve metadata for the paper',
            '  - Then use arxiv_read_paper with the paper_id to get the full content',
            '  - If arxiv_read_paper cannot retrieve sufficient full text, use arxiv_download_paper',
            '  - If the paper is not found, use arxiv_search to find related papers while you wait',
            '  - If you find related papers, retrieve enough metadata or full text to compare them responsibly',
            '</preparation>',
            '<comprehensive-analysis>',
            '  - Executive Summary:',
            '    * Summarize the paper in 2-3 sentences',
            '    * What is the main contribution of the paper?',
            '    * What is the main problem that the paper solves?',
            '    * What is the main methodology used in the paper?',
            '    * What are the main results of the paper?',
            '    * What is the main conclusion of the paper?',
            '</comprehensive-analysis>',
            '<research-context>',
            '  * Research area and specific problem addressed',
            '  * Key prior approaches and their limitations',
            '  * How this paper aims to advance the field',
            '  * How does this paper compare to other papers in the field?',
            '</research-context>',
            '<methodology-analysis>',
            '  * Step-by-step breakdown of the approach',
            '  * Key innovations in the methodology',
            '  * Theoretical foundations and assumptions',
            '  * Technical implementation details',
            '  * Algorithmic complexity and performance characteristics',
            '  * Anything the reader should know about the methodology if they wanted to replicate the paper',
            '</methodology-analysis>',
            '<results-analysis>',
            '  * Experimental setup (datasets, benchmarks, metrics)',
            '  * Main experimental results and their significance',
            '  * Statistical validity and robustness of results',
            '  * How results support or challenge the paper\'s claims',
            '  * Comparison to state-of-the-art approaches',
            '</results-analysis>',
            '<practical-implications>',
            '  * How could this be implemented or applied?',
            '  * Required resources and potential challenges',
            '  * Available code, datasets, or resources',
            '</practical-implications>',
            '<theoretical-implications>',
            '  * How this work advances fundamental understanding',
            '  * New concepts or paradigms introduced',
            '  * Challenges to existing theories or assumptions',
            '  * Open questions raised',
            '</theoretical-implications>',
            '<future-directions>',
            '  * Limitations that future work could address',
            '  * Promising follow-up research questions',
            '  * Potential for integration with other approaches',
            '  * Long-term research agenda this work enables',
            '</future-directions>',
            '<broader-impact>',
            '  * Societal, ethical, or policy implications',
            '  * Environmental or economic considerations',
            '  * Potential real-world applications and timeframe',
            '</broader-impact>',
            '',
            '<keep-in-mind>',
            '  * Use arxiv_search and SciX tools to find related work or papers building on this work',
            '  * Cross-reference findings with other papers you have analyzed',
            '  * Use diagrams, pseudocode, and other visualizations to illustrate key concepts when helpful',
            '  * Summarize key results in tables for easy reference',
            '</keep-in-mind>',
            '</workflow-for-paper-analysis>',
            '',
            'Structure your analysis with clear headings, maintain technical accuracy while being accessible, and include your critical assessment where appropriate.',
            'Your analysis should be comprehensive but concise. Be sure to critically evaluate the statistical significance and reproducibility of any reported results.',
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
