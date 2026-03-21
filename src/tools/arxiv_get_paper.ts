import { z } from 'zod';
import { arxivGetPaper } from '../clients/arxiv.js';
import { formatArxivPaper } from '../formatters.js';

export const arxivGetPaperSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". ' +
    'Do NOT include the full URL — just the ID.'
  ),
};

export type ArxivGetPaperInput = z.infer<z.ZodObject<typeof arxivGetPaperSchema>>;

export async function handleArxivGetPaper(
  input: ArxivGetPaperInput
): Promise<string> {
  const paper = await arxivGetPaper(input.paper_id);

  if (!paper) {
    return `No paper found with ID: ${input.paper_id}`;
  }

  return formatArxivPaper(paper);
}
