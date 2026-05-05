import { z } from 'zod';
import { arxivReadPaper } from '../clients/arxiv.js';
import { formatArxivReadPaper } from '../formatters.js';

export const arxivReadPaperSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". Do NOT include the full URL.'
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

  return formatArxivReadPaper(result);
}