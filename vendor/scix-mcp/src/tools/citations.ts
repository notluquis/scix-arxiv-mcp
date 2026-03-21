import { SciXAPIClient } from '../client.js';
import { DEFAULT_FIELDS } from '../config.js';
import { CitationsInput, ResponseFormat } from '../types.js';
import { formatCitationNetworkMarkdown } from '../formatters.js';

export async function getCitations(client: SciXAPIClient, input: CitationsInput): Promise<string> {
  const params = {
    q: `citations(identifier:${input.bibcode})`,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'citation_count desc'
  };

  const response = await client.get('search/query', params);
  const numFound = response.response?.numFound || 0;
  const docs = response.response?.docs || [];

  if (input.response_format === ResponseFormat.JSON) {
    return JSON.stringify(response, null, 2);
  }

  return formatCitationNetworkMarkdown(docs, `Papers citing ${input.bibcode}`, numFound);
}

export async function getReferences(client: SciXAPIClient, input: CitationsInput): Promise<string> {
  const params = {
    q: `references(identifier:${input.bibcode})`,
    fl: DEFAULT_FIELDS,
    rows: input.rows,
    sort: 'citation_count desc'
  };

  const response = await client.get('search/query', params);
  const numFound = response.response?.numFound || 0;
  const docs = response.response?.docs || [];

  if (input.response_format === ResponseFormat.JSON) {
    return JSON.stringify(response, null, 2);
  }

  return formatCitationNetworkMarkdown(docs, `Papers referenced by ${input.bibcode}`, numFound);
}
