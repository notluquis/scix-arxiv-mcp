import { z } from 'zod';
import { ScixClient } from '../clients/scix.js';

export const scixGetMetricsSchema = {
  bibcodes: z.array(z.string().min(1).max(30)).min(1).max(100).describe(
    'List of SciX/ADS bibcodes to compute metrics for (max 100)'
  ),
};

export type ScixGetMetricsInput = z.infer<z.ZodObject<typeof scixGetMetricsSchema>>;

export async function handleScixGetMetrics(
  client: ScixClient,
  input: ScixGetMetricsInput
): Promise<string> {
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
    result += `- **Self-citations:** ${cit['number of self-citations'] ?? 0}\n\n`;
  }

  if (basic) {
    result += `## Paper Statistics\n\n`;
    result += `- **Total papers:** ${basic['number of papers'] ?? 0}\n`;
    result += `- **Total reads:** ${basic['total number of reads'] ?? 0}\n`;
    result += '\n';
  }

  return result;
}
