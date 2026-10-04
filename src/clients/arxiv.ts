import { PDFParse } from 'pdf-parse';

import { cached, TTL_UNVERSIONED_MS, TTL_VERSIONED_MS } from '../cache.js';
import { ARXIV_API_URL } from '../config.js';
import { fetchWithPolicy } from '../http.js';
import {
  extractHtmlText, htmlToText, parseSections, textToSections, tidySections, type PaperSection,
} from './arxiv_html.js';
import { getFlatLatex, stripLatexCommands, type FlatLatex } from './latex.js';
import { arxivIdWithVersion, normalizeArxivId, type ArxivId } from '../ids.js';

export { extractHtmlText };

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

export type ArxivReadSource = 'html' | 'latex' | 'pdf' | 'abstract' | 'unavailable';

export interface ArxivReadPaperResult {
  paper: ArxivPaper | null;
  content: string;
  source: ArxivReadSource;
  sourceName?: string;
  /** Version that was requested, e.g. "v2"; undefined means latest. */
  version?: string;
}

export interface ArxivSearchOptions {
  maxResults?: number;
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  sortOrder?: 'descending' | 'ascending';
  /** YYYY-MM-DD — filter papers submitted on or after this date */
  dateFrom?: string;
  /** YYYY-MM-DD — filter papers submitted on or before this date */
  dateTo?: string;
  /** Raw minute-resolution bounds YYYYMMDDHHMM (GMT, both inclusive); wins over dateFrom/dateTo. */
  submittedFrom?: string;
  submittedTo?: string;
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

/**
 * Convert YYYY-MM or YYYY-MM-DD to the arXiv `submittedDate` format YYYYMMDDHHMM.
 * A month-only input maps to the first (`start`) or last (`end`) day of that month.
 */
export function toArxivDate(date: string, edge: 'start' | 'end'): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(date);
  if (!m) throw new Error(`Invalid date ${JSON.stringify(date)}: expected YYYY-MM or YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = m[3] ? Number(m[3]) : edge === 'start' ? 1 : daysInMonth;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`Invalid date ${JSON.stringify(date)}: no such calendar day`);
  }
  const ymd = `${m[1]}${m[2]}${String(day).padStart(2, '0')}`;
  return `${ymd}${edge === 'start' ? '0000' : '2359'}`;
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

  if (opts.submittedFrom && opts.submittedTo) {
    parts.push(`submittedDate:[${opts.submittedFrom} TO ${opts.submittedTo}]`);
  } else if (opts.dateFrom || opts.dateTo) {
    // Open ends use explicit bounds: arXiv documents only closed numeric ranges.
    const from = opts.dateFrom ? toArxivDate(opts.dateFrom, 'start') : '000101010000';
    const to = opts.dateTo ? toArxivDate(opts.dateTo, 'end') : '999912312359';
    parts.push(`submittedDate:[${from} TO ${to}]`);
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
  // Atom metadata is deliberately not cached.
  const res = await fetchWithPolicy(url);
  if (!res.ok) throw new Error(`arXiv API error ${res.status}`);
  return parseAtomFeed(await res.text());
}

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export async function fetchPdfText(url: string): Promise<string> {
  const res = await fetchWithPolicy(url, {}, { maxBytes: MAX_DOWNLOAD_BYTES });
  if (!res.ok) throw new Error(`arXiv PDF fetch error ${res.status}`);

  const pdf = new PDFParse({ data: new Uint8Array(await res.arrayBuffer()) });

  try {
    const textResult = await pdf.getText({ lineEnforce: true });
    return textResult.text.trim();
  } finally {
    await pdf.destroy();
  }
}

export async function arxivSearch(
  query: string,
  opts: ArxivSearchOptions = {}
): Promise<ArxivPaper[]> {
  return fetchAtom(buildArxivUrl(query, opts));
}

export async function arxivGetPaper(paperId: string): Promise<ArxivPaper | null> {
  const { base } = normalizeArxivId(paperId);
  const url = `${ARXIV_API_URL}?id_list=${base}&max_results=1`;
  const papers = await fetchAtom(url);
  return papers[0] ?? null;
}

function looksLikeFullPaperText(text: string, abstract = ''): boolean {
  const compact = text.toLowerCase();
  const paragraphCount = text.split(/\n{2,}/).filter(Boolean).length;
  const minLength = Math.max(abstract.length * 6, 3000);

  return text.length >= minLength || paragraphCount >= 8 || /\b(introduction|related work|method|results|discussion|conclusion|references)\b/.test(compact);
}

const MAX_HTML_BYTES = 50 * 1024 * 1024;

/** The page body, or null for any non-2xx or network failure (callers fall back to another source). */
async function fetchHtmlPage(url: string): Promise<string | null> {
  try {
    const res = await fetchWithPolicy(url, {}, { maxBytes: MAX_HTML_BYTES });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

const fetchHtmlPaper = (urlId: string) => fetchHtmlPage(`https://arxiv.org/html/${urlId}`);

function makeReadResult(
  paper: ArxivPaper,
  source: ArxivReadSource,
  content: string,
  version: string | undefined,
  sourceName?: string,
): ArxivReadPaperResult {
  return { paper, source, content, sourceName, version };
}

/** Progress callback; see `progress()` in content.ts. Never rejects. */
export type StepFn = (message: string) => Promise<void>;
const noStep: StepFn = async () => undefined;

export type ArxivReadRequest = 'auto' | 'html' | 'latex' | 'pdf';

/**
 * Full text of a paper. `auto` tries HTML, then the LaTeX source, then the PDF, then falls
 * back to the abstract. An explicit source never falls back: it throws when unavailable.
 */
export async function arxivReadPaper(
  paperId: string,
  source: ArxivReadRequest = 'auto',
  step: StepFn = noStep
): Promise<ArxivReadPaperResult> {
  const id: ArxivId = normalizeArxivId(paperId);
  const urlId = arxivIdWithVersion(id);
  await step('Fetching paper metadata');
  const paper = await arxivGetPaper(id.base);
  if (!paper) {
    return { paper: null, content: '', source: 'unavailable' };
  }
  const { version } = id;
  const ttl = version ? TTL_VERSIONED_MS : TTL_UNVERSIONED_MS;

  if (source === 'auto' || source === 'html') {
    await step('Fetching arXiv HTML');
    const htmlText = await cached('html-tex', urlId, ttl, async () => {
      const html = await fetchHtmlPaper(urlId);
      return html ? htmlToText(html) : null;
    });
    if (htmlText !== null) {
      if (source === 'html' ? htmlText : looksLikeFullPaperText(htmlText, paper.abstract)) {
        return makeReadResult(paper, 'html', htmlText, version);
      }
    }
    if (source === 'html') throw new Error(`No HTML rendering available for ${urlId}. Try source="latex" or "pdf".`);
  }

  if (source === 'auto' || source === 'latex') {
    await step('Fetching LaTeX source');
    let flat: FlatLatex | undefined;
    try {
      flat = (await getFlatLatex(urlId)).flat;
    } catch (e) {
      if (source === 'latex') throw e; // an explicit source never falls back
    }
    const texText = flat ? stripLatexCommands(flat.text) : '';
    if (flat && texText) return makeReadResult(paper, 'latex', texText, version, flat.main);
    if (source === 'latex') throw new Error(`No LaTeX source available for ${urlId}. Try source="html" or "pdf".`);
  }

  if (source === 'auto' || source === 'pdf') {
    await step('Extracting PDF text');
    const pdfText = await cached('pdf', urlId, ttl, () => fetchPdfText(`https://arxiv.org/pdf/${urlId}.pdf`));
    if (pdfText) {
      return makeReadResult(paper, 'pdf', pdfText, version);
    }
    if (source === 'pdf') throw new Error(`No text could be extracted from the PDF of ${urlId}.`);
  }

  return makeReadResult(paper, 'abstract', paper.abstract, version);
}

export interface SectionedPaper {
  source: 'html' | 'ar5iv' | 'latex' | 'pdf';
  sections: PaperSection[];
}

/**
 * A paper split into sections. Sources, in order: arxiv.org/html, ar5iv, the LaTeX source, then PDF text with
 * heading heuristics. The flattened result is cached; a hit skips the fetch steps.
 */
export async function arxivSectionedPaper(
  paperId: string,
  step: StepFn = noStep
): Promise<{ paper: ArxivPaper; arxivId: string; version?: string; sectioned: SectionedPaper } | null> {
  const id: ArxivId = normalizeArxivId(paperId);
  const urlId = arxivIdWithVersion(id);
  await step('Fetching paper metadata');
  const paper = await arxivGetPaper(id.base);
  if (!paper) return null;
  const ttl = id.version ? TTL_VERSIONED_MS : TTL_UNVERSIONED_MS;

  const sectioned = await cached<SectionedPaper>('sections', urlId, ttl, async () => {
    await step('Fetching arXiv HTML');
    const html = await fetchHtmlPaper(urlId);
    const fromHtml = html ? parseSections(html) : [];
    if (fromHtml.length > 0) return { source: 'html', sections: fromHtml };

    await step('Falling back to ar5iv');
    const ar5iv = await fetchHtmlPage(`https://ar5iv.labs.arxiv.org/html/${urlId}`);
    const fromAr5iv = ar5iv ? parseSections(ar5iv) : [];
    if (fromAr5iv.length > 0) return { source: 'ar5iv', sections: fromAr5iv };

    await step('Reading LaTeX source');
    const flat = await getFlatLatex(urlId).then(r => r.flat, () => undefined);
    if (flat && flat.sections.length > 0) {
      return {
        source: 'latex',
        sections: flat.sections.map(s => ({
          id: s.id, level: s.level, title: s.title, text: stripLatexCommands(flat.text.slice(s.start, s.end)),
        })),
      };
    }

    await step('Extracting PDF text');
    const text = await fetchPdfText(`https://arxiv.org/pdf/${urlId}.pdf`);
    const fromPdf = textToSections(text);
    if (fromPdf.length === 0) throw new Error(`No section structure or text could be obtained for ${urlId}.`);
    return { source: 'pdf', sections: fromPdf };
  });
  return {
    paper, arxivId: paper.id, version: id.version,
    sectioned: { ...sectioned, sections: tidySections(sectioned.sections) },
  };
}
