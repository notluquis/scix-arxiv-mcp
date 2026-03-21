import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixList } from '../formatters.js';

export const scixFindSimilarSchema = {
  bibcode: z.string().min(1).max(19).describe(
    'SciX/ADS bibcode of the seed paper. The API finds papers with similar content.'
  ),
  rows: z.number().int().min(1).max(50).default(10).describe('Number of similar papers to return'),
};

export type ScixFindSimilarInput = z.infer<z.ZodObject<typeof scixFindSimilarSchema>>;

export async function handleScixFindSimilar(
  client: ScixClient,
  input: ScixFindSimilarInput
): Promise<string> {
  const data = await client.get('search/query', {
    q: `similar(${input.bibcode})`,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'score desc',
  }) as { response?: { numFound?: number; docs?: unknown[] } };

  const numFound = data.response?.numFound ?? 0;
  const docs = data.response?.docs ?? [];

  if (docs.length === 0) {
    return `No similar papers found for: ${input.bibcode}`;
  }

  return formatScixList(
    docs as Record<string, unknown>[],
    numFound,
    `Papers Similar to ${input.bibcode}`
  );
}
