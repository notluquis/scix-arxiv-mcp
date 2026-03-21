import { ARXIV_API_URL, REQUEST_TIMEOUT } from '../config.js';

export interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  doi?: string;
  pdfUrl: string;
  htmlUrl: string;
  absUrl: string;
}

function parseAtomFeed(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];

  // Split into <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const id = (/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/.exec(entry)?.[1] ?? '')
      .trim()
      .replace(/v\d+$/, '');
    const title = (/<title[^>]*>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? '').replace(/\s+/g, ' ').trim();
    const abstract = (/<summary[^>]*>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? '').replace(/\s+/g, ' ').trim();
    const published = (/<published>(.*?)<\/published>/.exec(entry)?.[1] ?? '').trim();
    const updated = (/<updated>(.*?)<\/updated>/.exec(entry)?.[1] ?? '').trim();

    const authorMatches = [...entry.matchAll(/<name>(.*?)<\/name>/g)];
    const authors = authorMatches.map(m => m[1].trim());

    const categoryMatches = [...entry.matchAll(/<category[^>]+term="([^"]+)"/g)];
    const categories = categoryMatches.map(m => m[1]);

    const doi = /<link[^>]+title="doi"[^>]+href="https?:\/\/dx\.doi\.org\/([^"]+)"/.exec(entry)?.[1];

    if (!id) continue;

    papers.push({
      id,
      title,
      authors,
      abstract,
      published,
      updated,
      categories,
      doi,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
      htmlUrl: `https://arxiv.org/html/${id}`,
      absUrl: `https://arxiv.org/abs/${id}`,
    });
  }

  return papers;
}

export async function arxivSearch(
  query: string,
  maxResults = 10,
  sortBy = 'relevance',
  sortOrder = 'descending'
): Promise<ArxivPaper[]> {
  const params = new URLSearchParams({
    search_query: query,
    max_results: String(maxResults),
    sortBy,
    sortOrder,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${ARXIV_API_URL}?${params}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`arXiv API error ${res.status}`);
    }

    const xml = await res.text();
    return parseAtomFeed(xml);
  } finally {
    clearTimeout(timer);
  }
}

export async function arxivGetPaper(paperId: string): Promise<ArxivPaper | null> {
  // Normalize: strip version suffix for lookup, keep clean ID
  const cleanId = paperId.replace(/v\d+$/, '');
  const params = new URLSearchParams({ id_list: cleanId, max_results: '1' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${ARXIV_API_URL}?${params}`, {
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`arXiv API error ${res.status}`);

    const xml = await res.text();
    const papers = parseAtomFeed(xml);
    return papers[0] ?? null;
  } finally {
    clearTimeout(timer);
  }
}
