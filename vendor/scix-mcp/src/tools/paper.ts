import { SciXAPIClient } from '../client.js';
import { DEFAULT_FIELDS } from '../config.js';
import { GetPaperInput, ResponseFormat } from '../types.js';
import { formatPaperMarkdown } from '../formatters.js';

export async function getPaper(client: SciXAPIClient, input: GetPaperInput): Promise<string> {
  const params = {
    q: `identifier:${input.bibcode}`,
    fl: DEFAULT_FIELDS,
    rows: 1
  };

  const response = await client.get('search/query', params);
  const docs = response.response?.docs || [];

  if (docs.length === 0) {
    throw new Error(`Paper with identifier ${input.bibcode} not found`);
  }

  const paper = docs[0];

  if (input.response_format === ResponseFormat.JSON) {
    return JSON.stringify(paper, null, 2);
  }

  return formatPaperMarkdown(paper);
}
