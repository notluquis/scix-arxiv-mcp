import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixList } from '../formatters.js';

export const scixGetCitationsSchema = {
  bibcode: z.string().min(1).max(30).describe('SciX/ADS bibcode of the paper'),
  rows: z.number().int().min(1).max(50).default(20).describe('Number of citations to return'),
  relationship: z.enum(['citations', 'references']).default('citations').describe(
    '"citations" = papers that cite this paper; "references" = papers cited by this paper'
  ),
};

export type ScixGetCitationsInput = z.infer<z.ZodObject<typeof scixGetCitationsSchema>>;

export async function handleScixGetCitations(
  client: ScixClient,
  input: ScixGetCitationsInput
): Promise<string> {
  const query = input.relationship === 'citations'
    ? `citations(${input.bibcode})`
    : `references(${input.bibcode})`;

  const data = await client.get('search/query', {
    q: query,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'citation_count desc',
  }) as { response?: { numFound?: number; docs?: unknown[] } };

  const numFound = data.response?.numFound ?? 0;
  const docs = data.response?.docs ?? [];

  const label = input.relationship === 'citations'
    ? `Papers citing ${input.bibcode}`
    : `References in ${input.bibcode}`;

  return formatScixList(docs as Record<string, unknown>[], numFound, label);
}
