import { z } from 'zod';
import { arxivGetPaperFullText } from '../clients/arxiv.js';
import { formatArxivFullText } from '../formatters.js';

export const arxivDownloadPaperSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". Do NOT include the full URL.'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Character offset into the extracted PDF text. Use the next offset shown in the previous response to continue reading.'
  ),
  max_chars: z.number().int().min(1000).max(50_000).default(12_000).describe(
    'Maximum extracted-text characters to return in this response. Default 12000 to stay under MCP client output limits.'
  ),
};

export type ArxivDownloadPaperInput = z.infer<z.ZodObject<typeof arxivDownloadPaperSchema>>;

export async function handleArxivDownloadPaper(
  input: ArxivDownloadPaperInput
): Promise<string> {
  const result = await arxivGetPaperFullText(input.paper_id);

  if (!result) {
    return `Could not download paper with ID: ${input.paper_id}`;
  }

  return formatArxivFullText(result.paper, result.fullText, {
    offset: input.offset,
    maxChars: input.max_chars,
  });
}
