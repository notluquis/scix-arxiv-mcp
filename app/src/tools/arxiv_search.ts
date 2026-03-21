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
};

export type ArxivSearchInput = z.infer<z.ZodObject<typeof arxivSearchSchema>>;

export async function handleArxivSearch(
  input: ArxivSearchInput
): Promise<string> {
  const papers = await arxivSearch(
    input.query,
    input.max_results,
    input.sort_by,
    input.sort_order
  );

  if (papers.length === 0) {
    return `No results found for: ${input.query}`;
  }

  return formatArxivList(papers);
}
