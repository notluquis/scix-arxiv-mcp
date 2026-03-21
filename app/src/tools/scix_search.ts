import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixList } from '../formatters.js';

export const scixSearchSchema = {
  query: z.string().min(1).max(1000).describe(
    'SciX/ADS search query. Supports Solr syntax: field:value, AND/OR/NOT, wildcards. ' +
    'Examples: "black holes AND galaxy", "author:Einstein", "abs:dark matter year:2020-2024"'
  ),
  rows: z.number().int().min(1).max(50).default(10).describe('Number of results (max 50)'),
  start: z.number().int().min(0).default(0).describe('Pagination offset'),
  sort: z.enum(['score desc', 'citation_count desc', 'date desc', 'date asc', 'read_count desc'])
    .default('score desc')
    .describe('Sort order'),
};

export type ScixSearchInput = z.infer<z.ZodObject<typeof scixSearchSchema>>;

export async function handleScixSearch(
  client: ScixClient,
  input: ScixSearchInput
): Promise<string> {
  const data = await client.get('search/query', {
    q: input.query,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    start: input.start,
    sort: input.sort,
  }) as { response?: { numFound?: number; docs?: unknown[] } };

  const numFound = data.response?.numFound ?? 0;
  const docs = data.response?.docs ?? [];
  const hasMore = (input.start + input.rows) < numFound;

  let result = formatScixList(docs as Record<string, unknown>[], numFound);

  if (hasMore) {
    result += `\n*Use \`start=${input.start + input.rows}\` to see more results*\n`;
  }

  return result;
}
