import { z } from 'zod';
import { REQUEST_TIMEOUT } from '../config.js';

export const arxivCitationGraphSchema = {
  paper_id: z.string().min(1).describe(
    'arXiv paper ID. Accepted formats: "2103.01231", "2103.01231v2", "cs.LG/0612056". Do NOT include the full URL.'
  ),
};

export type ArxivCitationGraphInput = z.infer<z.ZodObject<typeof arxivCitationGraphSchema>>;

interface SemanticScholarAuthor {
  name?: string;
}

interface SemanticScholarPaperRef {
  paperId?: string;
  title?: string;
  year?: number;
  authors?: SemanticScholarAuthor[];
  externalIds?: Record<string, string>;
}

interface SemanticScholarPaper extends SemanticScholarPaperRef {
  citations?: SemanticScholarPaperRef[];
  references?: SemanticScholarPaperRef[];
}

export interface ArxivCitationGraphStructured {
  status: 'success' | 'error';
  paper_id: string;
  paper?: {
    paper_id?: string;
    arxiv_id: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
  };
  citation_count?: number;
  reference_count?: number;
  citations?: {
    paper_id?: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
    arxiv_id?: string;
  }[];
  references?: {
    paper_id?: string;
    title?: string;
    year?: number;
    authors: string[];
    external_ids: Record<string, string>;
    arxiv_id?: string;
  }[];
  message?: string;
}

export interface ArxivCitationGraphResult {
  text: string;
  structuredContent: ArxivCitationGraphStructured;
  isError?: boolean;
}

function normalizePaperId(paperId: string): string {
  return paperId.trim().replace(/v\d+$/, '');
}

function normalizePaper(paper: SemanticScholarPaperRef) {
  const externalIds = paper.externalIds ?? {};

  return {
    paper_id: paper.paperId,
    title: paper.title,
    year: paper.year,
    authors: paper.authors?.map(author => author.name).filter((name): name is string => Boolean(name)) ?? [],
    external_ids: externalIds,
    arxiv_id: externalIds['ArXiv'],
  };
}

function formatPaperList(papers: SemanticScholarPaperRef[], heading: string): string {
  let output = `## ${heading} (${papers.length})\n\n`;

  if (papers.length === 0) {
    output += 'No papers returned.\n\n';
    return output;
  }

  papers.slice(0, 25).forEach((paper, index) => {
    const authors = paper.authors?.map(author => author.name).filter(Boolean) ?? [];
    const firstAuthor = authors[0] ?? 'Unknown';
    const arxivId = paper.externalIds?.['ArXiv'];

    output += `${index + 1}. **${paper.title ?? 'Untitled'}**\n`;
    output += `   - ${firstAuthor}${paper.year ? ` (${paper.year})` : ''}\n`;
    if (arxivId) output += `   - arXiv: \`${arxivId}\`\n`;
    if (paper.paperId) output += `   - Semantic Scholar: \`${paper.paperId}\`\n`;
    output += '\n';
  });

  if (papers.length > 25) {
    output += `_Showing 25 of ${papers.length} returned papers._\n\n`;
  }

  return output;
}

export async function getArxivCitationGraph(
  input: ArxivCitationGraphInput
): Promise<ArxivCitationGraphResult> {
  const paperId = normalizePaperId(input.paper_id);
  const fields = [
    'title',
    'year',
    'authors',
    'externalIds',
    'citations.paperId',
    'citations.title',
    'citations.year',
    'citations.authors',
    'citations.externalIds',
    'references.paperId',
    'references.title',
    'references.year',
    'references.authors',
    'references.externalIds',
  ].join(',');
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(`ARXIV:${paperId}`)}?fields=${encodeURIComponent(fields)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `Could not retrieve citation graph for ${paperId}: Semantic Scholar API error ${res.status}${text ? `: ${text}` : ''}`;
      return {
        text: message,
        structuredContent: { status: 'error', paper_id: paperId, message },
        isError: true,
      };
    }

    const paper = await res.json() as SemanticScholarPaper;
    const citations = paper.citations ?? [];
    const references = paper.references ?? [];
    const structuredCitations = citations.map(normalizePaper);
    const structuredReferences = references.map(normalizePaper);

    let output = `# Citation Graph for arXiv:${paperId}\n\n`;
    output += `**Title:** ${paper.title ?? 'Untitled'}\n\n`;
    if (paper.year) output += `**Year:** ${paper.year}\n\n`;
    output += `**Citations returned:** ${citations.length}\n\n`;
    output += `**References returned:** ${references.length}\n\n`;
    output += formatPaperList(citations, 'Citing papers');
    output += formatPaperList(references, 'Referenced papers');

    return {
      text: output,
      structuredContent: {
        status: 'success',
        paper_id: paperId,
        paper: {
          paper_id: paper.paperId,
          arxiv_id: paperId,
          title: paper.title,
          year: paper.year,
          authors: paper.authors?.map(author => author.name).filter((name): name is string => Boolean(name)) ?? [],
          external_ids: paper.externalIds ?? {},
        },
        citation_count: citations.length,
        reference_count: references.length,
        citations: structuredCitations,
        references: structuredReferences,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleArxivCitationGraph(
  input: ArxivCitationGraphInput
): Promise<string> {
  return (await getArxivCitationGraph(input)).text;
}
