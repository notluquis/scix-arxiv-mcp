import { SciXAPIClient } from '../client.js';
import { MetricsInput, ResponseFormat } from '../types.js';
import { formatMetricsMarkdown } from '../formatters.js';

export async function getMetrics(client: SciXAPIClient, input: MetricsInput): Promise<string> {
  const data = {
    bibcodes: input.bibcodes,
    types: ['basic', 'citations', 'indicators']
  };

  const response = await client.post('metrics', data);

  if (input.response_format === ResponseFormat.JSON) {
    return JSON.stringify(response, null, 2);
  }

  return formatMetricsMarkdown(response);
}
