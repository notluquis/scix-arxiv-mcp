import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MiniSearch, { type SearchOptions } from 'minisearch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH = path.join(__dirname, '..', 'data', 'scix', 'chunked-index.json');
const SNIPPET_MAX_LENGTH = 260;
const MIN_SCORE_RATIO = 0.4;

const BASE_SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  fuzzy: 0.2,
  boost: {
    title: 4,
    section: 3,
    subsection: 2,
    doc_type: 2
  }
};

interface DocChunk {
  id: string;
  source_file: string;
  source_url: string;
  doc_type: string;
  category: string;
  title: string;
  section: string;
  subsection: string;
  content: string;
  char_count: number;
}

interface SearchResult {
  id: string;
  title: string;
  section: string;
  subsection: string;
  source_file: string;
  source_url: string;
  doc_type: string;
  category: string;
  score: number;
  snippet: string;
}

interface SearchStats {
  totalDocs: number;
  byCategory: Record<string, number>;
  byDocType: Record<string, number>;
  avgContentLength: number;
}

let docs: DocChunk[] = [];
let miniSearch: MiniSearch<DocChunk> | null = null;

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function normalizeContent(content: string): string {
  return stripMarkdownLinks(content).replace(/\s+/g, ' ').trim();
}

function extractFirstHeading(raw: string): string {
  const headingMatch = raw.match(/^(#{1,6})\s+(.+)$/m);
  if (!headingMatch) {
    return '';
  }
  return normalizeContent(headingMatch[2] || '');
}

function slugToTitle(slug: string): string {
  if (!slug) return '';
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isNavText(text: string): boolean {
  const matcher = /what['’]?s?\s*[_\s-]*new/i;
  return matcher.test(text || '');
}

function deriveTitle(doc: DocChunk, heading: string): string {
  const candidates = [
    heading,
    doc.subsection?.trim(),
    doc.section?.trim(),
    doc.title?.trim(),
    slugToTitle(doc.source_file),
    doc.id
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isNavText(candidate)) {
      return candidate;
    }
  }

  return doc.id;
}

function isWhatsNew(doc: DocChunk): boolean {
  return isNavText(doc.source_file || '') ||
    isNavText(doc.source_url || '') ||
    isNavText(doc.id || '');
}

async function initIndex(): Promise<void> {
  if (miniSearch) {
    return;
  }

  let raw: string;
  try {
    raw = await readFile(DOCS_PATH, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load SciX documentation index at ${DOCS_PATH}: ${message}`);
  }

  const parsedDocs: DocChunk[] = JSON.parse(raw);
  docs = parsedDocs
    .map((doc) => {
      const rawContent = doc.content || '';
      const heading = extractFirstHeading(rawContent);
      const cleanContent = normalizeContent(rawContent);
      const cleanTitle = deriveTitle(doc, heading);
      const cleanSection = doc.section?.trim() || '';
      const cleanSubsection = doc.subsection?.trim() || '';

      return {
        ...doc,
        title: cleanTitle,
        section: cleanSection,
        subsection: cleanSubsection,
        content: cleanContent,
        char_count: cleanContent.length,
        _heading: heading
      } as DocChunk & { _heading: string };
    })
    .filter((doc) => {
      if (!doc.title || !doc.content || doc.title === '404' || doc.content.length === 0) {
        return false;
      }

      return !isWhatsNew(doc);
    })
    .map((doc) => {
      const { _heading, ...rest } = doc as DocChunk & { _heading?: string };
      return rest;
    });

  miniSearch = new MiniSearch({
    fields: ['title', 'section', 'subsection', 'content', 'doc_type', 'category'],
    storeFields: [
      'id',
      'title',
      'section',
      'subsection',
      'source_file',
      'source_url',
      'doc_type',
      'category',
      'content'
    ],
    searchOptions: BASE_SEARCH_OPTIONS
  });

  miniSearch.addAll(docs);
}

function makeSnippet(content: string, terms: string[], maxLen = SNIPPET_MAX_LENGTH): string {
  if (!content) {
    return '';
  }

  const lower = content.toLowerCase();
  let idx = -1;

  for (const term of terms) {
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (idx === -1 || i < idx)) {
      idx = i;
    }
  }

  if (idx === -1) {
    const snippet = content.slice(0, maxLen);
    return snippet + (content.length > maxLen ? '...' : '');
  }

  const start = Math.max(0, idx - Math.floor(maxLen / 2));
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end);

  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < content.length) {
    snippet = snippet + '...';
  }

  return snippet;
}

export async function searchDocs(query: string, limit = 5, options: SearchOptions = {}): Promise<SearchResult[]> {
  await initIndex();

  const trimmedQuery = query?.trim();

  if (!trimmedQuery) {
    return [];
  }

  const limitValue = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;
  const maxResults = Math.min(limitValue, docs.length || limitValue);
  const searchOptions: SearchOptions = {
    ...BASE_SEARCH_OPTIONS,
    ...options
  };

  const results = miniSearch!.search(trimmedQuery, searchOptions);

  const terms = trimmedQuery.split(/\s+/).filter(Boolean);
  const topScore = results[0]?.score ?? 0;
  const filteredResults =
    topScore > 0 ? results.filter((r) => r.score >= topScore * MIN_SCORE_RATIO) : results;

  return filteredResults.slice(0, maxResults).map((r) => {
    const snippet = makeSnippet(r.content || '', terms);

    return {
      id: r.id,
      title: r.title || '',
      section: r.section || '',
      subsection: r.subsection || '',
      source_file: r.source_file || '',
      source_url: r.source_url || '',
      doc_type: r.doc_type || '',
      category: r.category || '',
      score: r.score,
      snippet
    };
  });
}

export async function getDocById(id: string): Promise<DocChunk | null> {
  await initIndex();
  return docs.find((d) => d.id === id) || null;
}

export async function searchByCategory(category: string, query = '', limit = 10): Promise<SearchResult[]> {
  await initIndex();

  const safeLimit = Math.max(1, Math.floor(limit) || 1);
  const categoryDocs = docs.filter((d) => d.category === category);

  if (!query || !query.trim()) {
    return categoryDocs.slice(0, safeLimit).map((d) => ({
      id: d.id,
      title: d.title,
      section: d.section,
      subsection: d.subsection,
      source_file: d.source_file,
      source_url: d.source_url,
      doc_type: d.doc_type,
      category: d.category,
      score: 0,
      snippet: d.content.slice(0, SNIPPET_MAX_LENGTH) + (d.content.length > SNIPPET_MAX_LENGTH ? '...' : '')
    }));
  }

  const tempSearch = new MiniSearch({
    fields: ['title', 'section', 'subsection', 'content'],
    storeFields: [
      'id',
      'title',
      'section',
      'subsection',
      'source_file',
      'source_url',
      'doc_type',
      'category',
      'content'
    ],
  });

  tempSearch.addAll(categoryDocs);

  const results = tempSearch.search(query, {
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 4, section: 2 },
  });

  const terms = query.split(/\s+/).filter(Boolean);

  return results.slice(0, safeLimit).map((r) => {
    const snippet = makeSnippet(r.content || '', terms);

    return {
      id: r.id,
      title: r.title || '',
      section: r.section || '',
      subsection: r.subsection || '',
      source_file: r.source_file || '',
      source_url: r.source_url || '',
      doc_type: r.doc_type || '',
      category: r.category || '',
      score: r.score,
      snippet
    };
  });
}

export async function getStats(): Promise<SearchStats> {
  await initIndex();

  const stats: SearchStats = {
    totalDocs: docs.length,
    byCategory: {},
    byDocType: {},
    avgContentLength: 0
  };

  let totalChars = 0;

  for (const doc of docs) {
    stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
    stats.byDocType[doc.doc_type] = (stats.byDocType[doc.doc_type] || 0) + 1;
    totalChars += doc.content.length;
  }

  stats.avgContentLength = docs.length ? Math.round(totalChars / docs.length) : 0;

  return stats;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {

  const q = process.argv.slice(2).join(' ');

  if (!q) {
    console.log('Usage: node search-docs.mjs <query>');
    console.log('Example: node search-docs.mjs author search');
    process.exit(1);
  }

  searchDocs(q).then((hits) => {
    console.log(JSON.stringify(hits, null, 2));
  });
}
