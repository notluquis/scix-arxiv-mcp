import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { registerArxivTools } from './tools/arxiv.js';
import { registerScixLibraryTools } from './tools/scix_libraries.js';
import { registerScixTools } from './tools/scix.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

// ── MCP server factory ───────────────────────────────────────────────────────

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'scix-arxiv-mcp', version: pkg.version });

  // Registration order is the tools/list order (locked by test/contract.json):
  // SciX/ADS tools, then SciX libraries, then arXiv.
  registerScixTools(server);
  registerScixLibraryTools(server);
  registerArxivTools(server);

  // ── Prompts ────────────────────────────────────────────────────────────

  server.registerPrompt(
    'research_discovery',
    {
      description: 'Begin exploring a research topic: search for relevant papers, identify key authors, ' +
        'and map the research landscape.',
      argsSchema: z.object({
              topic: z.string().describe('Research topic or question to explore'),
              expertise_level: z.enum(['beginner', 'intermediate', 'expert'])
                .default('intermediate')
                .describe('Your familiarity with the topic'),
              time_period: z.string().optional().describe('Time period of interest, e.g. "2020-present"'),
              domain: z.string().optional().describe('Domain hint, e.g. "machine learning", "astrophysics"'),
            }),
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

  server.registerPrompt(
    'deep_paper_analysis',
    {
      description: 'Perform a deep analysis of a specific arXiv paper: methodology, contributions, ' +
        'limitations, and position in the literature.',
      argsSchema: z.object({
              paper_id: z.string().describe('arXiv paper ID, e.g. "2103.01231"'),
              focus: z.enum([
                'methodology', 'results', 'limitations', 'related_work', 'reproducibility',
              ]).default('methodology').describe('Aspect to focus the analysis on'),
            }),
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
            '2. arxiv_read_paper with source="pdf": If HTML/TeX extraction is insufficient, extract full text from the PDF',
            '3. arxiv_search: Find related papers on the same topic to provide context',
            '4. arxiv_get_paper: Retrieve authoritative arXiv metadata and abstract',
            '5. scix_get_paper, scix_get_citations, scix_get_metrics, and scix_find_similar: Cross-check SciX/ADS metadata, citations, metrics, and related work when indexed',
            '',
            '<workflow-for-paper-analysis>',
            '<preparation>',
            '  - First, use arxiv_get_paper to retrieve metadata for the paper',
            '  - Then use arxiv_read_paper with the paper_id to get the full content',
            '  - If arxiv_read_paper cannot retrieve sufficient full text, call it again with source="pdf"',
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

  server.registerPrompt(
    'summarize_paper',
    {
      description: 'Summarize a paper with key methods, results, limits, and practical takeaways.',
      argsSchema: z.object({
              paper_id: z.string().describe('arXiv paper ID, e.g. "2103.01231"'),
            }),
    },
    ({ paper_id }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Summarize paper ${paper_id}.`,
            '',
            'Use arxiv_get_paper and arxiv_read_paper as needed before summarizing. If full text extraction is insufficient, call arxiv_read_paper with source="pdf".',
            '',
            'Produce a concise, technically accurate summary of the target paper.',
            '',
            'Required structure:',
            '1. Problem and motivation (2-3 sentences)',
            '2. Core method or approach (3-5 bullet points)',
            '3. Main results (metrics, datasets, or key evidence)',
            '4. Strengths and limitations',
            '5. Practical takeaway for researchers',
            '',
            'Keep the summary factual, avoid speculation, and cite evidence from the paper text.',
          ].join('\n'),
        },
      }],
    })
  );

  server.registerPrompt(
    'compare_papers',
    {
      description: 'Compare two or more papers on methods, results, assumptions, and tradeoffs.',
      argsSchema: z.object({
              paper_ids: z.string().describe('Comma-separated arXiv paper IDs'),
            }),
    },
    ({ paper_ids }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Compare papers: ${paper_ids}.`,
            '',
            'Use arxiv_get_paper and arxiv_read_paper to gather metadata and full text for each paper. Use SciX tools for citation context when indexed.',
            '',
            'Compare the provided papers with a focus on technical differences and tradeoffs.',
            '',
            'Required structure:',
            '1. Shared problem definition and scope',
            '2. Method comparison table (assumptions, architecture, training setup)',
            '3. Results comparison (benchmarks, metrics, and caveats)',
            '4. Strengths, weaknesses, and failure modes',
            '5. Recommendation: when to choose each approach',
            '',
            'Use concrete evidence from each paper; call out missing details explicitly.',
          ].join('\n'),
        },
      }],
    })
  );

  server.registerPrompt(
    'literature_review',
    {
      description: 'Synthesize a structured literature review for a topic and optional paper set.',
      argsSchema: z.object({
              topic: z.string().describe('Research topic or question'),
              paper_ids: z.string().optional().describe('Optional comma-separated arXiv paper IDs'),
            }),
    },
    ({ topic, paper_ids }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Generate a structured literature review on topic: ${topic}.`,
            paper_ids ? `Focus papers: ${paper_ids}.` : '',
            '',
            'Use arxiv_search and scix_search to discover missing papers. Use arxiv_read_paper, arxiv_get_paper, and SciX tools to synthesize evidence.',
            '',
            'Required structure:',
            '1. Scope and inclusion criteria',
            '2. Thematic clusters in prior work',
            '3. Methodological trends over time',
            '4. Consensus findings and unresolved disagreements',
            '5. Gaps and open research questions',
            '6. Suggested future directions',
            '',
            'Prioritize synthesis over summary and separate established findings from tentative claims.',
          ].filter(Boolean).join('\n'),
        },
      }],
    })
  );

  server.registerPrompt(
    'literature_synthesis',
    {
      description: 'Synthesize findings across multiple papers into a coherent review of the state of the art.',
      argsSchema: z.object({
              paper_ids: z.string().describe('Comma-separated arXiv or SciX bibcodes'),
              synthesis_goal: z.string().optional().describe(
                'What you want to understand, e.g. "compare approaches to X", "find consensus on Y"'
              ),
            }),
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
