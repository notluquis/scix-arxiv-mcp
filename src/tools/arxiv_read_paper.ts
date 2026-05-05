import { z } from 'zod';
import { arxivReadPaper } from '../clients/arxiv.js';
import { formatArxivReadPaper } from '../formatters.js';

export const arxivReadPaperSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". Do NOT include the full URL.'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Character offset into the extracted paper text. Use the next offset shown in the previous response to continue reading.'
  ),
  max_chars: z.number().int().min(1000).max(50_000).default(12_000).describe(
    'Maximum extracted-text characters to return in this response. Default 12000 to stay under MCP client output limits.'
  ),
};

export type ArxivReadPaperInput = z.infer<z.ZodObject<typeof arxivReadPaperSchema>>;

export async function handleArxivReadPaper(
  input: ArxivReadPaperInput
): Promise<string> {
  const result = await arxivReadPaper(input.paper_id);

  if (!result.paper) {
    return `No paper found with ID: ${input.paper_id}`;
  }

  return formatArxivReadPaper(result, {
    offset: input.offset,
    maxChars: input.max_chars,
  });
}
