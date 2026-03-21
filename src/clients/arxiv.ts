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

export interface ArxivSearchOptions {
  maxResults?: number;
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  sortOrder?: 'descending' | 'ascending';
  /** YYYY-MM-DD — filter papers submitted on or after this date */
  dateFrom?: string;
  /** YYYY-MM-DD — filter papers submitted on or before this date */
  dateTo?: string;
  /** arXiv category list, e.g. ['cs.LG', 'cs.CL'] */
  categories?: string[];
}

function parseAtomFeed(xml: string): ArxivPaper[] {
  const papers: ArxivPaper[] = [];

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

/** Convert YYYY-MM-DD → YYYYMM for arXiv date range format. */
function toArxivDate(date: string): string {
  return date.replace(/-/g, '').slice(0, 6);
}

/**
 * Build the full arXiv API query string, appending date and category filters
 * without letting URLSearchParams double-encode the `[` `]` `*` `+TO+` tokens
 * that the arXiv Atom API expects.
 */
function buildArxivUrl(
  query: string,
  opts: ArxivSearchOptions
): string {
  const parts: string[] = [query];

  if (opts.dateFrom || opts.dateTo) {
    const from = opts.dateFrom ? toArxivDate(opts.dateFrom) : '*';
    const to = opts.dateTo ? toArxivDate(opts.dateTo) : '*';
    parts.push(`submittedDate:[${from}* TO ${to}*]`);
  }

  if (opts.categories?.length) {
    const catFilter = opts.categories.map(c => `cat:${c}`).join(' OR ');
    parts.push(`(${catFilter})`);
  }

  const fullQuery = parts.join(' AND ');

  // URLSearchParams encodes brackets as %5B%5D and * as %2A — arXiv API
  // needs them literal in the query string. Build manually instead.
  const encoded = encodeURIComponent(fullQuery)
    .replace(/%5B/g, '[').replace(/%5D/g, ']')
    .replace(/%2A/g, '*').replace(/%20/g, '+')
    .replace(/%2B/g, '+');

  const sortBy = opts.sortBy ?? 'relevance';
  const sortOrder = opts.sortOrder ?? 'descending';
  const maxResults = opts.maxResults ?? 10;

  return `${ARXIV_API_URL}?search_query=${encoded}&max_results=${maxResults}&sortBy=${sortBy}&sortOrder=${sortOrder}`;
}

async function fetchAtom(url: string): Promise<ArxivPaper[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`arXiv API error ${res.status}`);
    return parseAtomFeed(await res.text());
  } finally {
    clearTimeout(timer);
  }
}

export async function arxivSearch(
  query: string,
  opts: ArxivSearchOptions = {}
): Promise<ArxivPaper[]> {
  return fetchAtom(buildArxivUrl(query, opts));
}

export async function arxivGetPaper(paperId: string): Promise<ArxivPaper | null> {
  const cleanId = paperId.replace(/v\d+$/, '');
  const url = `${ARXIV_API_URL}?id_list=${cleanId}&max_results=1`;
  const papers = await fetchAtom(url);
  return papers[0] ?? null;
}
