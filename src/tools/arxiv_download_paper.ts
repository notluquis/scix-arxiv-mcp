import { z } from 'zod';
import { arxivGetPaperFullText } from '../clients/arxiv.js';
import { formatArxivFullText } from '../formatters.js';

export const arxivDownloadPaperSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". Do NOT include the full URL.'
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

  return formatArxivFullText(result.paper, result.fullText);
}
