import { z } from 'zod';
import { arxivSearch } from '../clients/arxiv.js';
import { formatArxivList } from '../formatters.js';

export const arxivSearchSchema = {
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
};

export type ArxivSearchInput = z.infer<z.ZodObject<typeof arxivSearchSchema>>;

export async function handleArxivSearch(input: ArxivSearchInput): Promise<string> {
  const papers = await arxivSearch(input.query, {
    maxResults: input.max_results,
    sortBy: input.sort_by,
    sortOrder: input.sort_order,
    dateFrom: input.date_from,
    dateTo: input.date_to,
    categories: input.categories,
  });

  if (papers.length === 0) {
    return `No results found for: ${input.query}`;
  }

  return formatArxivList(papers);
}
