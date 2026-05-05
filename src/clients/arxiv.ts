import { PDFParse } from 'pdf-parse';
import { gunzipSync } from 'node:zlib';

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

export interface ArxivReadPaperResult {
  paper: ArxivPaper | null;
  content: string;
  source: 'html' | 'tex' | 'pdf' | 'abstract' | 'unavailable';
  sourceName?: string;
}

interface TarEntry {
  name: string;
  data: Buffer;
}

const PREFERRED_TEX_FILENAMES = [
  'main.tex',
  'paper.tex',
  'manuscript.tex',
  'article.tex',
  'ms.tex',
];

export interface ArxivFullTextPaper {
  paper: ArxivPaper;
  fullText: string;
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

async function fetchPdfText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`arXiv PDF fetch error ${res.status}`);

    const pdf = new PDFParse({ data: new Uint8Array(await res.arrayBuffer()) });

    try {
      const textResult = await pdf.getText({ lineEnforce: true });
      return textResult.text.trim();
    } finally {
      await pdf.destroy();
    }
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

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return text
    .replace(/&#(x?[0-9a-fA-F]+);/g, (match, value: string) => {
      const codePoint = value.startsWith('x') || value.startsWith('X')
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&([a-zA-Z]+);/g, (match, entity: string) => namedEntities[entity] ?? match);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractHtmlText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|section|article|header|footer|main|aside|nav|figure|figcaption|blockquote|h[1-6]|tr|td|th|table|ul|ol|pre|dd|dt)\s*>/gi, '\n\n')
    .replace(/<\s*(p|div|li|section|article|header|footer|main|aside|nav|figure|figcaption|blockquote|h[1-6]|tr|td|th|table|ul|ol|pre|dd|dt)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ');

  return normalizeText(decodeHtmlEntities(stripped)).replace(/\n{3,}/g, '\n\n');
}

function stripLatexCommands(text: string): string {
  const headingMap: Record<string, string> = {
    section: '#',
    subsection: '##',
    subsubsection: '###',
    paragraph: '####',
    subparagraph: '#####',
  };

  const output = text
    .replace(/\\begin\{document\}/gi, '\n\n')
    .replace(/\\end\{document\}/gi, '\n\n')
    .replace(/\\(section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^{}]+)\}/gi, (_match, name: string, title: string) => {
      const level = headingMap[name.toLowerCase()] ?? '##';
      return `\n\n${level} ${title.trim()}\n\n`;
    })
    .replace(/\\(textbf|textit|emph|underline)\{([^{}]+)\}/gi, '$2')
    .replace(/\\(?:title|author|date)\{([^{}]+)\}/gi, '$1\n')
    .replace(/\\(?:cite|citep|citet|autocite|parencite|textcite|ref|label)\{[^{}]*\}/gi, '')
    .replace(/\\includegraphics(?:\[[^\]]*\])?\{[^{}]*\}/gi, '')
    .replace(/\\item\b/gi, '\n- ')
    .replace(/\\\\/g, '\n')
    .replace(/\\[a-zA-Z@]+(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, (_match, arg: string) => (arg ? ` ${arg} ` : ' '))
    .replace(/(?<!\\)%.*$/gm, '')
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => `\n\n$$${math.trim()}$$\n\n`)
    .replace(/\$(?!\s)([^$]+?)\$/g, (_match, math: string) => `$${math.trim()}$`)
    .replace(/~/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return normalizeText(output);
}

function parseTarEntries(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;

    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '').trim();
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '').trim();
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeString = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeString || '0', 8) || 0;
    const typeFlag = header.toString('utf8', 156, 157);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (contentEnd > buffer.length) break;

    if (typeFlag === '\0' || typeFlag === '0' || typeFlag === '') {
      entries.push({ name: fullName, data: buffer.subarray(contentStart, contentEnd) });
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function chooseTexEntry(entries: TarEntry[]): TarEntry | undefined {
  const texEntries = entries.filter(entry => /\.tex$/i.test(entry.name));
  if (texEntries.length === 0) return undefined;

  const scoreEntry = (entry: TarEntry): number => {
    const base = entry.name.split('/').pop()?.toLowerCase() ?? entry.name.toLowerCase();
    const preferredIndex = PREFERRED_TEX_FILENAMES.indexOf(base);
    const rootBonus = entry.name.includes('/') ? 0 : 20;
    return (preferredIndex >= 0 ? 100 - preferredIndex * 10 : 0) + rootBonus + Math.min(entry.data.length / 1000, 30);
  };

  return texEntries.sort((a, b) => scoreEntry(b) - scoreEntry(a))[0];
}

function extractTexText(archiveBytes: Buffer): { text: string; sourceName: string } | null {
  let tarBytes = archiveBytes;

  try {
    tarBytes = gunzipSync(archiveBytes);
  } catch {
    // Source may already be a raw tar archive.
  }

  const entries = parseTarEntries(tarBytes);
  const texEntry = chooseTexEntry(entries);

  if (!texEntry) return null;

  return {
    text: stripLatexCommands(texEntry.data.toString('utf8')),
    sourceName: texEntry.name,
  };
}

function looksLikeFullPaperText(text: string, abstract = ''): boolean {
  const compact = text.toLowerCase();
  const paragraphCount = text.split(/\n{2,}/).filter(Boolean).length;
  const minLength = Math.max(abstract.length * 6, 3000);

  return text.length >= minLength || paragraphCount >= 8 || /\b(introduction|related work|method|results|discussion|conclusion|references)\b/.test(compact);
}

async function fetchHtmlPaper(paperId: string): Promise<string | null> {
  const cleanId = paperId.replace(/v\d+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`https://arxiv.org/html/${cleanId}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceArchive(paperId: string): Promise<Buffer | null> {
  const cleanId = paperId.replace(/v\d+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`https://arxiv.org/e-print/${cleanId}`, { signal: controller.signal });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return Buffer.from(bytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function makeReadResult(
  paper: ArxivPaper,
  source: 'html' | 'tex' | 'pdf' | 'abstract' | 'unavailable',
  content: string,
  sourceName?: string,
): ArxivReadPaperResult {
  return { paper, source, content, sourceName };
}

export async function arxivReadPaper(paperId: string): Promise<ArxivReadPaperResult> {
  const paper = await arxivGetPaper(paperId);
  if (!paper) {
    return { paper: null, content: '', source: 'unavailable' };
  }

  const html = await fetchHtmlPaper(paper.id);
  if (html) {
    const htmlText = extractHtmlText(html);
    if (looksLikeFullPaperText(htmlText, paper.abstract)) {
      return makeReadResult(paper, 'html', htmlText);
    }
  }

  const archive = await fetchSourceArchive(paper.id);
  if (archive) {
    const texResult = extractTexText(archive);
    if (texResult?.text) {
      return makeReadResult(paper, 'tex', texResult.text, texResult.sourceName);
    }
  }

  const pdfResult = await arxivGetPaperFullText(paper.id);
  if (pdfResult?.fullText) {
    return makeReadResult(paper, 'pdf', pdfResult.fullText);
  }

  return makeReadResult(paper, 'abstract', paper.abstract);
}

export async function arxivGetPaperFullText(paperId: string): Promise<ArxivFullTextPaper | null> {
  const paper = await arxivGetPaper(paperId);

  if (!paper) {
    return null;
  }

  const fullText = await fetchPdfText(`https://arxiv.org/pdf/${paper.id}.pdf`);
  return { paper, fullText };
}
