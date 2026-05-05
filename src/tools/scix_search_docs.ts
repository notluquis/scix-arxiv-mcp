import { z } from 'zod';
import { searchScixDocs } from '../clients/scix_docs.js';

export const scixSearchDocsSchema = {
  query: z.string().min(1).max(500).describe(
    'Search SciX help docs, syntax guides, and usage notes. Use this to find field syntax, tool usage, and feature explanations.'
  ),
  limit: z.number().int().min(1).max(20).default(5).describe('Number of results (max 20)'),
};

export type SciXSearchDocsInput = z.infer<z.ZodObject<typeof scixSearchDocsSchema>>;

export async function handleScixSearchDocs(input: SciXSearchDocsInput): Promise<string> {
  const results = await searchScixDocs(input.query, input.limit);

  if (results.length === 0) {
    return `No SciX docs found for: ${input.query}`;
  }

  let output = `# SciX Docs Search Results\n\nFound **${results.length}** result(s) for **${input.query}**\n\n`;

  results.forEach((result, index) => {
    output += `${index + 1}. **${result.title}**\n`;
    if (result.section || result.subsection) {
      output += `   - Section: ${[result.section, result.subsection].filter(Boolean).join(' / ')}\n`;
    }
    if (result.doc_type) output += `   - Type: ${result.doc_type}\n`;
    if (result.category) output += `   - Category: ${result.category}\n`;
    output += `   - Source: [${result.source_file}](${result.source_url})\n`;
    output += `   - Score: ${result.score.toFixed(2)}\n`;
    output += `   - Snippet: ${result.snippet}\n\n`;
  });

  return output;
}