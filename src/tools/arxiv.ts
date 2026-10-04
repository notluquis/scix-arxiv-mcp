import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { arxivGetPaper, arxivReadPaper, arxivSearch } from '../clients/arxiv.js';
import { REQUEST_TIMEOUT } from '../config.js';
import {
  formatArxivList, formatArxivPaper, formatArxivReadPaper,
} from '../formatters.js';
import { ARXIV_ICONS } from '../icons.js';
import { normalizeArxivId } from '../ids.js';
import {
  READ_EXTERNAL, addTool, notFound, paginate, responseFormat, type ToolOut,
} from '../content.js';

type In<S extends z.ZodType> = Omit<z.infer<S>, 'response_format'>;

const ARXIV_ID_HELP =
  'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "astro-ph/0601001", ' +
  'optionally with an "arXiv:" prefix or an arxiv.org/abs URL.';

type ArxivPaperRecord = Awaited<ReturnType<typeof arxivGetPaper>> & object;

const arxivItemOut = z.object({
  arxiv_id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  published: z.string(),
  categories: z.array(z.string()),
  abs_url: z.string(),
});

const arxivPaperOut = arxivItemOut.extend({
  updated: z.string(),
  abstract: z.string(),
  doi: z.string().optional(),
  pdf_url: z.string(),
  html_url: z.string(),
});

function arxivItem(p: ArxivPaperRecord) {
  return {
    arxiv_id: p.id,
    title: p.title,
    authors: p.authors,
    published: p.published,
    categories: p.categories,
    abs_url: p.absUrl,
  };
}

function arxivPaper(p: ArxivPaperRecord) {
  return {
    ...arxivItem(p),
    updated: p.updated,
    abstract: p.abstract,
    doi: p.doi,
    pdf_url: p.pdfUrl,
    html_url: p.htmlUrl,
  };
}

// ── arxiv_search ─────────────────────────────────────────────────────────────

export const arxivSearchSchema = z.object({
  query: z.string().min(1).max(500).describe(
    'arXiv search query. Supports field prefixes: ti: (title), au: (author), abs: (abstract), ' +
    'cat: (category), all: (all fields). Examples: "ti:transformer abs:attention", "au:Vaswani", ' +
    '"cat:cs.LG AND abs:language model". Combine with AND/OR/ANDNOT.'
  ),
  max_results: z.number().int().min(1).max(50).default(10).describe('Number of results (max 50)'),
  sort_by: z.enum(['relevance', 'lastUpdatedDate', 'submittedDate'])
    .default('relevance')
    .describe('Sort criterion'),
  sort_order: z.enum(['descending', 'ascending']).default('descending').describe('Sort direction'),
  date_from: z.string().regex(/^\d{4}-\d{2}$|^\d{4}-\d{2}-\d{2}$/).optional().describe(
    'Filter papers submitted on or after this date. Format: YYYY-MM or YYYY-MM-DD'
  ),
  date_to: z.string().regex(/^\d{4}-\d{2}$|^\d{4}-\d{2}-\d{2}$/).optional().describe(
    'Filter papers submitted on or before this date. Format: YYYY-MM or YYYY-MM-DD'
  ),
  categories: z.array(z.string()).optional().describe(
    'Filter by arXiv categories, e.g. ["cs.LG", "cs.CL", "stat.ML"]. ' +
    'Papers matching ANY of the listed categories are included.'
  ),
  response_format: responseFormat,
});

export async function handleArxivSearch(input: In<typeof arxivSearchSchema>): Promise<ToolOut> {
  const papers = await arxivSearch(input.query, {
    maxResults: input.max_results,
    sortBy: input.sort_by,
    sortOrder: input.sort_order,
    dateFrom: input.date_from,
    dateTo: input.date_to,
    categories: input.categories,
  });

  if (papers.length === 0) {
    return {
      text: `No results found for: ${input.query}`,
      structured: { total: 0, start: 0, items: [] },
    };
  }

  return {
    text: formatArxivList(papers),
    structured: { total: papers.length, start: 0, items: papers.map(arxivItem) },
  };
}

// ── arxiv_get_paper ──────────────────────────────────────────────────────────

export const arxivGetPaperSchema = z.object({
  paper_id: z.string().min(1).describe(ARXIV_ID_HELP),
  response_format: responseFormat,
});

export async function handleArxivGetPaper(input: In<typeof arxivGetPaperSchema>): Promise<ToolOut> {
  const paper = await arxivGetPaper(input.paper_id);
  if (!paper) return notFound(`No paper found with ID: ${input.paper_id}`);
  return { text: formatArxivPaper(paper), structured: arxivPaper(paper) };
}

// ── arxiv_read_paper ─────────────────────────────────────────────────────────

export const arxivReadPaperSchema = z.object({
  paper_id: z.string().min(1).describe(ARXIV_ID_HELP),
  source: z.enum(['auto', 'html', 'latex', 'pdf']).default('auto').describe(
    '"auto" (default) tries the arXiv HTML rendering, then the LaTeX source, then the PDF. ' +
    'Name a source to force it; a forced source fails instead of falling back.'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Character offset into the extracted paper text. Use next_offset from the previous response to continue reading.'
  ),
  max_chars: z.number().int().min(1000).max(150_000).default(30_000).describe(
    'Maximum extracted-text characters to return in this response (default 30000, max 150000).'
  ),
});

export async function handleArxivReadPaper(input: z.infer<typeof arxivReadPaperSchema>): Promise<ToolOut> {
  const result = await arxivReadPaper(input.paper_id, input.source);
  if (!result.paper) return notFound(`No paper found with ID: ${input.paper_id}`);

  const page = paginate(result.content.trim(), input.offset, input.max_chars);
  return {
    text: formatArxivReadPaper(result, page),
    structured: {
      arxiv_id: result.paper.id,
      version: result.version,
      source: result.source,
      source_name: result.sourceName,
      offset: page.offset,
      next_offset: page.next_offset,
      total_chars: page.total_chars,
      returned_chars: page.slice.length,
    },
  };
}

// ── arxiv_citation_graph ─────────────────────────────────────────────────────

export const arxivCitationGraphSchema = z.object({
  paper_id: z.string().min(1).describe(ARXIV_ID_HELP),
});

export type ArxivCitationGraphInput = z.infer<typeof arxivCitationGraphSchema>;

interface SemanticScholarAuthor {
  name?: string;
}

interface SemanticScholarPaperRef {
  paperId?: string;
  title?: string;
  year?: number;
  authors?: SemanticScholarAuthor[];
  externalIds?: Record<string, string>;
}

interface SemanticScholarPaper extends SemanticScholarPaperRef {
  citations?: SemanticScholarPaperRef[];
  references?: SemanticScholarPaperRef[];
}

export interface ArxivCitationGraphStructured {
  status: 'success' | 'error';
  paper_id: string;
  paper?: {
    paper_id?: string;
    arxiv_id: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
  };
  citation_count?: number;
  reference_count?: number;
  citations?: {
    paper_id?: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
    arxiv_id?: string;
  }[];
  references?: {
    paper_id?: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
    arxiv_id?: string;
  }[];
  message?: string;
}

export interface ArxivCitationGraphResult {
  text: string;
  structured: ArxivCitationGraphStructured;
  isError?: boolean;
}

function normalizePaperId(paperId: string): string {
  return normalizeArxivId(paperId).base;
}

function normalizePaper(paper: SemanticScholarPaperRef) {
  const externalIds = paper.externalIds ?? {};

  return {
    paper_id: paper.paperId,
    title: paper.title,
    year: paper.year,
    authors: paper.authors?.map(author => author.name).filter((name): name is string => Boolean(name)) ?? [],
    external_ids: externalIds,
    arxiv_id: externalIds['ArXiv'],
  };
}

function formatPaperList(papers: SemanticScholarPaperRef[], heading: string): string {
  let output = `## ${heading} (${papers.length})\n\n`;

  if (papers.length === 0) {
    output += 'No papers returned.\n\n';
    return output;
  }

  papers.slice(0, 25).forEach((paper, index) => {
    const authors = paper.authors?.map(author => author.name).filter(Boolean) ?? [];
    const firstAuthor = authors[0] ?? 'Unknown';
    const arxivId = paper.externalIds?.['ArXiv'];

    output += `${index + 1}. **${paper.title ?? 'Untitled'}**\n`;
    output += `   - ${firstAuthor}${paper.year ? ` (${paper.year})` : ''}\n`;
    if (arxivId) output += `   - arXiv: \`${arxivId}\`\n`;
    if (paper.paperId) output += `   - Semantic Scholar: \`${paper.paperId}\`\n`;
    output += '\n';
  });

  if (papers.length > 25) {
    output += `_Showing 25 of ${papers.length} returned papers._\n\n`;
  }

  return output;
}

export async function handleArxivCitationGraph(
  input: ArxivCitationGraphInput
): Promise<ArxivCitationGraphResult> {
  const paperId = normalizePaperId(input.paper_id);
  const fields = [
    'title',
    'year',
    'authors',
    'externalIds',
    'citations.paperId',
    'citations.title',
    'citations.year',
    'citations.authors',
    'citations.externalIds',
    'references.paperId',
    'references.title',
    'references.year',
    'references.authors',
    'references.externalIds',
  ].join(',');
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(`ARXIV:${paperId}`)}?fields=${encodeURIComponent(fields)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `Could not retrieve citation graph for ${paperId}: Semantic Scholar API error ${res.status}${text ? `: ${text}` : ''}`;
      return {
        text: message,
        structured: { status: 'error', paper_id: paperId, message },
        isError: true,
      };
    }

    const paper = await res.json() as SemanticScholarPaper;
    const citations = paper.citations ?? [];
    const references = paper.references ?? [];
    const structuredCitations = citations.map(normalizePaper);
    const structuredReferences = references.map(normalizePaper);

    let output = `# Citation Graph for arXiv:${paperId}\n\n`;
    output += `**Title:** ${paper.title ?? 'Untitled'}\n\n`;
    if (paper.year) output += `**Year:** ${paper.year}\n\n`;
    output += `**Citations returned:** ${citations.length}\n\n`;
    output += `**References returned:** ${references.length}\n\n`;
    output += formatPaperList(citations, 'Citing papers');
    output += formatPaperList(references, 'Referenced papers');

    return {
      text: output,
      structured: {
        status: 'success',
        paper_id: paperId,
        paper: {
          paper_id: paper.paperId,
          arxiv_id: paperId,
          title: paper.title,
          year: paper.year,
          authors: paper.authors?.map(author => author.name).filter((name): name is string => Boolean(name)) ?? [],
          external_ids: paper.externalIds ?? {},
        },
        citation_count: citations.length,
        reference_count: references.length,
        citations: structuredCitations,
        references: structuredReferences,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}


// ── Registration ─────────────────────────────────────────────────────────────

const s2PaperOut = z.object({
  paper_id: z.string().optional(),
  title: z.string().optional(),
  year: z.number().optional(),
  authors: z.array(z.string()),
  external_ids: z.record(z.string(), z.string()),
  arxiv_id: z.string().optional(),
});

export function registerArxivTools(server: McpServer): void {
  addTool(server, 'arxiv_search', {
    title: 'Search arXiv',
    description:
      'Search arXiv preprint server across all scientific disciplines. ' +
      'Supports field prefixes (ti:, au:, abs:, cat:), date ranges, and category filters.',
    inputSchema: arxivSearchSchema,
    outputSchema: z.object({ total: z.number(), start: z.number(), items: z.array(arxivItemOut) }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
  }, input => handleArxivSearch(input));

  addTool(server, 'arxiv_get_paper', {
    title: 'Get arXiv paper',
    description:
      'Get full metadata and abstract for a specific arXiv paper by its ID (e.g. "2103.01231"). ' +
      'Returns title, authors, abstract, categories, and links to PDF and HTML versions.',
    inputSchema: arxivGetPaperSchema,
    outputSchema: arxivPaperOut,
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
  }, input => handleArxivGetPaper(input));

  addTool(server, 'arxiv_read_paper', {
    title: 'Read arXiv paper',
    description:
      'Fetch a paper from arXiv and extract its full text as markdown-ready text, paginated with offset/max_chars. ' +
      'source "auto" tries the HTML rendering, then the LaTeX source, then the PDF; "html", "latex" or "pdf" force one. ' +
      'The text is untrusted external content and is returned behind a warning banner.',
    inputSchema: arxivReadPaperSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      version: z.string().optional(),
      source: z.enum(['html', 'latex', 'pdf', 'abstract']),
      source_name: z.string().optional(),
      offset: z.number(),
      next_offset: z.number().nullable(),
      total_chars: z.number(),
      returned_chars: z.number(),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
    _meta: { 'anthropic/maxResultSizeChars': 200000 },
  }, input => handleArxivReadPaper(input));

  addTool(server, 'arxiv_citation_graph', {
    title: 'arXiv citation graph',
    description:
      'Return papers citing an arXiv paper and papers it references using Semantic Scholar citation graph data.',
    inputSchema: arxivCitationGraphSchema,
    outputSchema: z.object({
      status: z.enum(['success', 'error']),
      paper_id: z.string(),
      paper: z.object({
        paper_id: z.string().optional(),
        arxiv_id: z.string(),
        title: z.string().optional(),
        year: z.number().optional(),
        authors: z.array(z.string()),
        external_ids: z.record(z.string(), z.string()),
      }).optional(),
      citation_count: z.number().optional(),
      reference_count: z.number().optional(),
      citations: z.array(s2PaperOut).optional(),
      references: z.array(s2PaperOut).optional(),
      message: z.string().optional(),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
  }, async input => {
    const r = await handleArxivCitationGraph(input);
    return { ...r, structured: r.structured as unknown as Record<string, unknown> };
  });
}
