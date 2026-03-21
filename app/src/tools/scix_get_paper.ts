import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixPaper } from '../formatters.js';

export const scixGetPaperSchema = {
  bibcode: z.string().min(1).max(19).describe(
    'SciX/ADS bibcode identifier. Example: "2019ApJ...882L..24A". ' +
    'Also accepts arXiv IDs like "arXiv:2103.01231" or DOIs.'
  ),
};

export type ScixGetPaperInput = z.infer<z.ZodObject<typeof scixGetPaperSchema>>;

export async function handleScixGetPaper(
  client: ScixClient,
  input: ScixGetPaperInput
): Promise<string> {
  const data = await client.get('search/query', {
    q: `identifier:${input.bibcode}`,
    fl: DEFAULT_FIELDS,
    rows: 1,
  }) as { response?: { docs?: unknown[] } };

  const docs = data.response?.docs ?? [];

  if (docs.length === 0) {
    return `No paper found with identifier: ${input.bibcode}`;
  }

  return formatScixPaper(docs[0] as Record<string, unknown>);
}
