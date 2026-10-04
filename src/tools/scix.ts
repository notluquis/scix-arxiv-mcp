import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ScixClient, getScixClient } from '../clients/scix.js';
import { searchScixDocs } from '../clients/scix_docs.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixList, formatScixPaper } from '../formatters.js';
import { adsIdentifierQuery } from '../ids.js';
import { SCIX_ICONS } from '../icons.js';
import {
  READ_EXTERNAL, READ_LOCAL, addTool, listOutput, notFound, responseFormat,
  type ToolOut,
} from '../content.js';

type In<S extends z.ZodType> = Omit<z.infer<S>, 'response_format'>;

const MAX_AUTHORS = 25;

// ── Structured shapes ────────────────────────────────────────────────────────

const scixItemOut = z.object({
  bibcode: z.string().optional(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.string().optional(),
  pub: z.string().optional(),
  citation_count: z.number().optional(),
});

const scixPaperOut = scixItemOut.extend({
  author_count: z.number(),
  read_count: z.number().optional(),
  doi: z.string().optional(),
  arxiv_id: z.string().optional(),
  abstract: z.string().optional(),
  url: z.string().optional(),
});

type Doc = Record<string, unknown>;

function scixItem(p: Doc) {
  const authors = (p['author'] as string[] | undefined) ?? [];
  return {
    bibcode: p['bibcode'] as string | undefined,
    title: (p['title'] as string[] | undefined)?.[0] ?? 'Untitled',
    authors: authors.slice(0, MAX_AUTHORS),
    year: p['year'] === undefined ? undefined : String(p['year']),
    pub: p['pub'] as string | undefined,
    citation_count: p['citation_count'] as number | undefined,
  };
}

function scixPaper(p: Doc) {
  const bibcode = p['bibcode'] as string | undefined;
  return {
    ...scixItem(p),
    author_count: ((p['author'] as string[] | undefined) ?? []).length,
    read_count: p['read_count'] as number | undefined,
    doi: (p['doi'] as string[] | undefined)?.[0],
    arxiv_id: p['arxiv_id'] as string | undefined,
    abstract: p['abstract'] as string | undefined,
    url: bibcode ? `https://scixplorer.org/abs/${bibcode}` : undefined,
  };
}

function listOut(text: string, docs: Doc[], total: number, start: number): ToolOut {
  return { text, structured: { total, start, items: docs.map(scixItem) } };
}

type SearchResponse = { response?: { numFound?: number; docs?: unknown[] } };

// ── scix_search ──────────────────────────────────────────────────────────────

export const scixSearchSchema = z.object({
  query: z.string().min(1).max(1000).describe(
    'SciX/ADS search query. Supports Solr syntax: field:value, AND/OR/NOT, wildcards. ' +
    'Examples: "black holes AND galaxy", "author:Einstein", "abs:dark matter year:2020-2024"'
  ),
  rows: z.number().int().min(1).max(50).default(10).describe('Number of results (max 50)'),
  start: z.number().int().min(0).default(0).describe('Pagination offset'),
  sort: z.enum(['score desc', 'citation_count desc', 'date desc', 'date asc', 'read_count desc'])
    .default('score desc')
    .describe('Sort order'),
  response_format: responseFormat,
});

export async function handleScixSearch(
  client: ScixClient,
  input: In<typeof scixSearchSchema>
): Promise<ToolOut> {
  const data = await client.get('search/query', {
    q: input.query,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    start: input.start,
    sort: input.sort,
  }) as SearchResponse;

  const numFound = data.response?.numFound ?? 0;
  const docs = (data.response?.docs ?? []) as Doc[];
  const hasMore = (input.start + input.rows) < numFound;

  let text = formatScixList(docs, numFound);
  if (hasMore) text += `\n*Use \`start=${input.start + input.rows}\` to see more results*\n`;
  return listOut(text, docs, numFound, input.start);
}

// ── scix_get_paper ───────────────────────────────────────────────────────────

export const scixGetPaperSchema = z.object({
  bibcode: z.string().min(1).max(200).describe(
    'SciX/ADS bibcode identifier. Example: "2019ApJ...882L..24A". ' +
    'Also accepts arXiv IDs like "arXiv:2103.01231", DOIs like "10.1093/mnras/stab1234", or "scix:..." ids.'
  ),
  response_format: responseFormat,
});

export async function handleScixGetPaper(
  client: ScixClient,
  input: In<typeof scixGetPaperSchema>
): Promise<ToolOut> {
  const data = await client.get('search/query', {
    q: adsIdentifierQuery(input.bibcode),
    fl: DEFAULT_FIELDS,
    rows: 1,
  }) as SearchResponse;

  const docs = (data.response?.docs ?? []) as Doc[];
  if (docs.length === 0) return notFound(`No paper found with identifier: ${input.bibcode}`);

  return { text: formatScixPaper(docs[0]), structured: scixPaper(docs[0]) };
}

// ── scix_get_citations ───────────────────────────────────────────────────────

export const scixGetCitationsSchema = z.object({
  bibcode: z.string().min(1).max(200).describe('SciX/ADS bibcode (or arXiv id / DOI) of the paper'),
  rows: z.number().int().min(1).max(50).default(20).describe('Number of citations to return'),
  relationship: z.enum(['citations', 'references']).default('citations').describe(
    '"citations" = papers that cite this paper; "references" = papers cited by this paper'
  ),
  response_format: responseFormat,
});

export async function handleScixGetCitations(
  client: ScixClient,
  input: In<typeof scixGetCitationsSchema>
): Promise<ToolOut> {
  const operator = input.relationship === 'citations' ? 'citations' : 'references';
  const data = await client.get('search/query', {
    q: `${operator}(${adsIdentifierQuery(input.bibcode)})`,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'citation_count desc',
  }) as SearchResponse;

  const numFound = data.response?.numFound ?? 0;
  const docs = (data.response?.docs ?? []) as Doc[];
  const label = input.relationship === 'citations'
    ? `Papers citing ${input.bibcode}`
    : `References in ${input.bibcode}`;

  return listOut(formatScixList(docs, numFound, label), docs, numFound, 0);
}

// ── scix_find_similar ────────────────────────────────────────────────────────

export const scixFindSimilarSchema = z.object({
  bibcode: z.string().min(1).max(200).describe(
    'SciX/ADS bibcode (or arXiv id / DOI) of the seed paper. The API finds papers with similar content.'
  ),
  rows: z.number().int().min(1).max(50).default(10).describe('Number of similar papers to return'),
  response_format: responseFormat,
});

export async function handleScixFindSimilar(
  client: ScixClient,
  input: In<typeof scixFindSimilarSchema>
): Promise<ToolOut> {
  const data = await client.get('search/query', {
    q: `similar(${adsIdentifierQuery(input.bibcode)})`,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'score desc',
  }) as SearchResponse;

  const numFound = data.response?.numFound ?? 0;
  const docs = (data.response?.docs ?? []) as Doc[];

  if (docs.length === 0) {
    return listOut(`No similar papers found for: ${input.bibcode}`, [], 0, 0);
  }
  return listOut(formatScixList(docs, numFound, `Papers Similar to ${input.bibcode}`), docs, numFound, 0);
}

// ── scix_get_metrics ─────────────────────────────────────────────────────────

export const scixGetMetricsSchema = z.object({
  bibcodes: z.array(z.string().min(1).max(30)).min(1).max(100).describe(
    'List of SciX/ADS bibcodes to compute metrics for (max 100)'
  ),
  response_format: responseFormat,
});

export async function handleScixGetMetrics(
  client: ScixClient,
  input: In<typeof scixGetMetricsSchema>
): Promise<ToolOut> {
  const data = await client.post('metrics', {
    bibcodes: input.bibcodes,
    types: ['basic', 'citations', 'indicators'],
  }) as Record<string, unknown>;

  const ind = data['indicators'] as Record<string, number> | undefined;
  const cit = data['citation stats'] as Record<string, number> | undefined;
  const basic = data['basic stats'] as Record<string, number> | undefined;

  let result = `# Citation Metrics\n\n`;
  result += `*Based on ${input.bibcodes.length} paper(s)*\n\n`;

  if (ind) {
    result += `## Indices\n\n`;
    result += `- **h-index:** ${ind['h'] ?? 0}\n`;
    result += `- **g-index:** ${ind['g'] ?? 0}\n`;
    result += `- **i10-index:** ${ind['i10'] ?? 0}\n`;
    if (ind['m'] != null) result += `- **m-index:** ${Number(ind['m']).toFixed(2)}\n`;
    if (ind['tori'] != null) result += `- **tori:** ${Number(ind['tori']).toFixed(2)}\n`;
    result += '\n';
  }

  if (cit) {
    result += `## Citation Statistics\n\n`;
    result += `- **Total citations:** ${cit['total number of citations'] ?? 0}\n`;
    result += `- **Refereed citations:** ${cit['total number of refereed citations'] ?? 0}\n`;
    if (cit['average number of citations'] != null) {
      result += `- **Average:** ${Number(cit['average number of citations']).toFixed(1)}\n`;
    }
    if (cit['median number of citations'] != null) {
      result += `- **Median:** ${cit['median number of citations']}\n`;
    }
    result += `- **Self-citations:** ${cit['number of self-citations'] ?? 0}\n\n`;
  }

  if (basic) {
    result += `## Paper Statistics\n\n`;
    result += `- **Total papers:** ${basic['number of papers'] ?? 0}\n`;
    result += `- **Total reads:** ${basic['total number of reads'] ?? 0}\n`;
    if (basic['average number of reads'] != null) {
      result += `- **Average reads:** ${Number(basic['average number of reads']).toFixed(1)}\n`;
    }
    result += '\n';
  }

  return {
    text: result,
    structured: {
      papers_requested: input.bibcodes.length,
      indicators: ind,
      citation_stats: cit,
      basic_stats: basic,
    },
  };
}

// ── scix_export ──────────────────────────────────────────────────────────────

const EXPORT_FORMATS = [
  'bibtex', 'bibtexabs', 'ris', 'endnote', 'aastex', 'ads', 'agu', 'ams',
  'custom', 'dcxml', 'gsa', 'icarus', 'ieee', 'jatsxml', 'medlars', 'mnras',
  'procite', 'refabsxml', 'refworks', 'refxml', 'rss', 'soph', 'votable',
] as const;

export const scixExportSchema = z.object({
  bibcodes: z.array(z.string().min(1)).min(1).max(2000).describe(
    'List of SciX/ADS bibcodes to export (max 2000)'
  ),
  format: z.enum(EXPORT_FORMATS).default('bibtex').describe(
    'Export format. Common: "bibtex" (BibTeX), "bibtexabs" (BibTeX + abstract), ' +
    '"ris" (Reference Manager / Zotero / Mendeley), "endnote" (EndNote), ' +
    '"aastex" (AASTeX LaTeX), "ieee" (IEEE), "mnras" (MNRAS). ' +
    'Use "custom" with custom_format for a template-based format.'
  ),
  custom_format: z.string().optional().describe(
    'Custom format template string (only used when format="custom")'
  ),
  sort: z.string().optional().describe(
    'Sort order for the exported bibliography, e.g. "date desc"'
  ),
  maxauthor: z.number().int().optional().describe(
    'Maximum number of authors to list before truncating to et al.'
  ),
  authorcutoff: z.number().int().optional().describe(
    'Author cutoff threshold before applying truncation'
  ),
  journalformat: z.number().int().min(1).max(4).optional().describe(
    'Journal abbreviation style: 1=AASTeX, 2=Icarus, 3=MNRAS, 4=SOPH'
  ),
  keyformat: z.string().optional().describe(
    'Citation key format template for export formats that support custom keys'
  ),
  response_format: responseFormat,
});

export async function handleScixExport(
  client: ScixClient,
  input: In<typeof scixExportSchema>
): Promise<ToolOut> {
  const body: Record<string, unknown> = { bibcode: input.bibcodes };

  if (input.sort) body['sort'] = [input.sort];
  if (input.maxauthor != null) body['maxauthor'] = [input.maxauthor];
  if (input.authorcutoff != null) body['authorcutoff'] = [input.authorcutoff];
  if (input.journalformat != null) body['journalformat'] = [input.journalformat];
  if (input.keyformat) body['keyformat'] = [input.keyformat];
  if (input.format === 'custom' && input.custom_format) body['format'] = input.custom_format;

  const data = await client.post(`export/${input.format}`, body) as { export?: string };
  const exported = data.export ?? '';
  return {
    text: exported,
    structured: { format: input.format, count: input.bibcodes.length, export: exported },
  };
}

// ── scix_search_docs ─────────────────────────────────────────────────────────

export const scixSearchDocsSchema = z.object({
  query: z.string().min(1).max(500).describe(
    'Search SciX help docs, syntax guides, and usage notes. Use this to find field syntax, tool usage, and feature explanations.'
  ),
  limit: z.number().int().min(1).max(20).default(5).describe('Number of results (max 20)'),
  response_format: responseFormat,
});

export async function handleScixSearchDocs(input: In<typeof scixSearchDocsSchema>): Promise<ToolOut> {
  const results = await searchScixDocs(input.query, input.limit);

  if (results.length === 0) {
    return {
      text: `No SciX docs found for: ${input.query}`,
      structured: { total: 0, start: 0, items: [] },
    };
  }

  let output = `# SciX Docs Search Results\n\nFound **${results.length}** result(s) for **${input.query}**\n\n`;

  results.forEach((result, index) => {
    output += `${index + 1}. **${result.title}**\n`;
    if (result.section || result.subsection) {
      output += `   - Section: ${[result.section, result.subsection].filter(Boolean).join(' / ')}\n`;
    }
    if (result.doc_type) output += `   - Type: ${result.doc_type}\n`;
    if (result.category) output += `   - Category: ${result.category}\n`;
    output += `   - Source: [${result.source_file}](${result.source_url})\n`;
    output += `   - Score: ${result.score.toFixed(2)}\n`;
    output += `   - Snippet: ${result.snippet}\n\n`;
  });

  return {
    text: output,
    structured: {
      total: results.length,
      start: 0,
      items: results.map(r => ({
        title: r.title,
        section: r.section || undefined,
        source_url: r.source_url,
        score: r.score,
        snippet: r.snippet,
      })),
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

const itemList = listOutput(scixItemOut);

export function registerScixTools(server: McpServer): void {
  addTool(server, 'scix_search', {
    title: 'Search SciX / ADS',
    description:
      'Search NASA SciX / ADS (Astrophysics Data System) for peer-reviewed papers. ' +
      'Covers astronomy, astrophysics, physics, planetary science, and related fields. ' +
      'Returns bibcodes, titles, authors, citation counts. Use scix_get_paper for full details.',
    inputSchema: scixSearchSchema,
    outputSchema: itemList,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixSearch(getScixClient(), input));

  addTool(server, 'scix_get_paper', {
    title: 'Get SciX paper',
    description: 'Get full metadata and abstract for a paper in SciX/ADS by its bibcode, arXiv ID, or DOI.',
    inputSchema: scixGetPaperSchema,
    outputSchema: scixPaperOut,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixGetPaper(getScixClient(), input));

  addTool(server, 'scix_get_citations', {
    title: 'Get citations or references',
    description: 'Get papers that cite a given SciX/ADS paper (citations), or papers it cites (references).',
    inputSchema: scixGetCitationsSchema,
    outputSchema: itemList,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixGetCitations(getScixClient(), input));

  addTool(server, 'scix_find_similar', {
    title: 'Find similar papers',
    description:
      'Find papers with similar content to a given SciX/ADS paper using its bibcode. ' +
      'Uses the SciX similar() operator to surface related work.',
    inputSchema: scixFindSimilarSchema,
    outputSchema: itemList,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixFindSimilar(getScixClient(), input));

  addTool(server, 'scix_get_metrics', {
    title: 'Citation metrics',
    description: 'Compute citation metrics (h-index, g-index, i10-index, citation counts) for a set of papers.',
    inputSchema: scixGetMetricsSchema,
    outputSchema: z.object({
      papers_requested: z.number(),
      indicators: z.record(z.string(), z.unknown()).optional(),
      citation_stats: z.record(z.string(), z.unknown()).optional(),
      basic_stats: z.record(z.string(), z.unknown()).optional(),
    }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixGetMetrics(getScixClient(), input));

  addTool(server, 'scix_export', {
    title: 'Export bibliography',
    description:
      'Export a list of papers in a bibliography format. ' +
      'Supports BibTeX, RIS (Zotero/Mendeley), EndNote, AASTeX, IEEE, MNRAS, and 18 other formats. ' +
      'Pass bibcodes from scix_search results. Ideal for building reference lists.',
    inputSchema: scixExportSchema,
    outputSchema: z.object({ format: z.string(), count: z.number(), export: z.string() }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixExport(getScixClient(), input));

  addTool(server, 'scix_search_docs', {
    title: 'Search SciX docs',
    description: 'Search SciX help docs, search syntax guides, and usage notes.',
    inputSchema: scixSearchDocsSchema,
    outputSchema: listOutput(z.object({
      title: z.string(),
      section: z.string().optional(),
      source_url: z.string(),
      score: z.number(),
      snippet: z.string(),
    })),
    annotations: READ_LOCAL,
    icons: SCIX_ICONS,
  }, input => handleScixSearchDocs(input));
}
