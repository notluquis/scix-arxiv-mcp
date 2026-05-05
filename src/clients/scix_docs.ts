import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH = path.join(__dirname, '..', '..', 'data', 'scix', 'chunked-index.json');
const SNIPPET_MAX_LENGTH = 260;

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

export interface SciXDocSearchResult {
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

let docs: DocChunk[] | null = null;

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function normalizeContent(content: string): string {
  return stripMarkdownLinks(content).replace(/\s+/g, ' ').trim();
}

function extractFirstHeading(raw: string): string {
  const headingMatch = raw.match(/^(#{1,6})\s+(.+)$/m);
  if (!headingMatch) return '';
  return normalizeContent(headingMatch[2] ?? '');
}

function slugToTitle(slug: string): string {
  if (!slug) return '';
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function isNavText(text: string): boolean {
  return /what['’]?s?\s*[_\s-]*new/i.test(text || '');
}

function deriveTitle(doc: DocChunk, heading: string): string {
  const candidates = [
    heading,
    doc.subsection?.trim(),
    doc.section?.trim(),
    doc.title?.trim(),
    slugToTitle(doc.source_file),
    doc.id,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (!isNavText(candidate)) {
      return candidate;
    }
  }

  return doc.id;
}

function isWhatsNew(doc: DocChunk): boolean {
  return isNavText(doc.source_file || '') || isNavText(doc.source_url || '') || isNavText(doc.id || '');
}

async function loadDocs(): Promise<DocChunk[]> {
  if (docs) return docs;

  const raw = await readFile(DOCS_PATH, 'utf8');
  const parsedDocs: DocChunk[] = JSON.parse(raw);

  docs = parsedDocs
    .map(doc => {
      const rawContent = doc.content || '';
      const heading = extractFirstHeading(rawContent);
      const cleanContent = normalizeContent(rawContent);
      return {
        ...doc,
        title: deriveTitle(doc, heading),
        section: doc.section?.trim() || '',
        subsection: doc.subsection?.trim() || '',
        content: cleanContent,
        char_count: cleanContent.length,
      };
    })
    .filter(doc => {
      if (!doc.title || !doc.content || doc.title === '404' || doc.content.length === 0) {
        return false;
      }

      return !isWhatsNew(doc);
    });

  return docs;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;

  let count = 0;
  let index = 0;
  while (index !== -1) {
    index = haystack.indexOf(needle, index);
    if (index !== -1) {
      count += 1;
      index += needle.length;
    }
  }

  return count;
}

function makeSnippet(content: string, terms: string[], maxLen = SNIPPET_MAX_LENGTH): string {
  if (!content) return '';

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

  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;

  return snippet;
}

export async function searchScixDocs(query: string, limit = 5): Promise<SciXDocSearchResult[]> {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return [];

  const docsToSearch = await loadDocs();
  const limitValue = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5;
  const terms = trimmedQuery
    .toLowerCase()
    .replace(/["'()]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const results = docsToSearch
    .map(doc => {
      const title = doc.title || '';
      const section = doc.section || '';
      const subsection = doc.subsection || '';
      const haystack = [title, section, subsection, doc.doc_type || '', doc.category || '', doc.content || '']
        .join(' ')
        .toLowerCase();

      let score = 0;
      for (const term of terms) {
        score += countOccurrences(title.toLowerCase(), term) * 4;
        score += countOccurrences(section.toLowerCase(), term) * 3;
        score += countOccurrences(subsection.toLowerCase(), term) * 2;
        score += countOccurrences(haystack, term);
      }

      const phraseScore = countOccurrences(haystack, trimmedQuery.toLowerCase()) * 6;
      score += phraseScore;

      return {
        doc,
        score,
        snippet: makeSnippet(doc.content, terms),
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.doc.char_count ?? 0) - (a.doc.char_count ?? 0);
    })
    .slice(0, limitValue);

  return results.map(result => ({
    id: result.doc.id,
    title: result.doc.title,
    section: result.doc.section,
    subsection: result.doc.subsection,
    source_file: result.doc.source_file,
    source_url: result.doc.source_url,
    doc_type: result.doc.doc_type,
    category: result.doc.category,
    score: result.score,
    snippet: result.snippet,
  }));
}
