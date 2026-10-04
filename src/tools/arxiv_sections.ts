import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { arxivSectionedPaper, type StepFn } from '../clients/arxiv.js';
import type { PaperSection } from '../clients/arxiv_html.js';
import {
  READ_EXTERNAL, UNTRUSTED_BANNER, addTool, notFound, paginate, progress, type ToolOut,
} from '../content.js';
import { formatPaginationNote } from '../formatters.js';
import { ARXIV_ICONS } from '../icons.js';

const PAPER_ID_HELP =
  'arXiv paper ID, e.g. "2103.01231", "2103.01231v2" or "astro-ph/0601001" (optionally "arXiv:"-prefixed or an arxiv.org/abs URL).';

// metadata, arXiv HTML, ar5iv fallback, PDF parse
const PROGRESS_STEPS = 4;
const MAX_HINT_IDS = 40;

type Loaded = NonNullable<Awaited<ReturnType<typeof arxivSectionedPaper>>>;

async function load(paperId: string, step?: StepFn): Promise<Loaded | undefined> {
  return (await arxivSectionedPaper(paperId, step)) ?? undefined;
}

const header = (l: Loaded) =>
  `${UNTRUSTED_BANNER}\n\n# ${l.paper.title}\n\n**arXiv ID:** \`${l.arxivId}\`${l.version ? ` (${l.version})` : ''} · **Source:** ${l.sectioned.source}\n\n`;

function missing(l: Loaded, sectionId: string): ToolOut {
  const ids = l.sectioned.sections.map(s => s.id);
  const shown = ids.slice(0, MAX_HINT_IDS).join(', ');
  const more = ids.length > MAX_HINT_IDS ? `, … (${ids.length - MAX_HINT_IDS} more; call arxiv_get_paper_outline)` : '';
  return notFound(`No section "${sectionId}" in ${l.arxivId}. Valid section ids: ${shown}${more}`);
}

function findSection(sections: PaperSection[], id: string): PaperSection | undefined {
  const wanted = id.trim();
  return sections.find(s => s.id === wanted) ?? sections.find(s => s.id.toLowerCase() === wanted.toLowerCase());
}

// ── arxiv_get_paper_outline ──────────────────────────────────────────────────

export const arxivOutlineSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
});

export async function handleArxivOutline(
  input: z.infer<typeof arxivOutlineSchema>,
  step?: StepFn
): Promise<ToolOut> {
  const l = await load(input.paper_id, step);
  if (!l) return notFound(`No paper found with ID: ${input.paper_id}`);
  const sections = l.sectioned.sections.map(s => ({
    id: s.id, level: s.level, title: s.title, chars: s.text.length,
  }));
  const lines = sections.map(s => `${'  '.repeat(s.level - 1)}- \`${s.id}\` ${s.title} (${s.chars} chars)`);
  return {
    text: `${header(l)}## Outline\n\n${lines.join('\n')}\n\n_Read one with arxiv_read_paper_section(section_id). A section's text excludes its subsections, which are listed separately._\n`,
    structured: { arxiv_id: l.arxivId, source: l.sectioned.source, sections },
  };
}

// ── arxiv_read_paper_section ─────────────────────────────────────────────────

export const arxivReadSectionSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
  section_id: z.string().min(1).max(100).describe(
    'Section id from arxiv_get_paper_outline, e.g. "S2", "S2.SS1", "abstract" (HTML) or "3.1" (PDF).'
  ),
  offset: z.number().int().min(0).default(0).describe(
    'Character offset into the section text. Use next_offset from the previous response to continue.'
  ),
  max_chars: z.number().int().min(1000).max(150_000).default(30_000).describe(
    'Maximum characters to return in this response (default 30000, max 150000).'
  ),
});

export async function handleArxivReadSection(
  input: z.infer<typeof arxivReadSectionSchema>,
  step?: StepFn
): Promise<ToolOut> {
  const l = await load(input.paper_id, step);
  if (!l) return notFound(`No paper found with ID: ${input.paper_id}`);
  const section = findSection(l.sectioned.sections, input.section_id);
  if (!section) return missing(l, input.section_id);

  const page = paginate(section.text, input.offset, input.max_chars);
  return {
    text: `${header(l)}## ${section.title} (\`${section.id}\`)\n\n${page.slice.trim()}${formatPaginationNote(page)}\n`,
    structured: {
      arxiv_id: l.arxivId,
      source: l.sectioned.source,
      section_id: section.id,
      title: section.title,
      offset: page.offset,
      next_offset: page.next_offset,
      total_chars: page.total_chars,
      returned_chars: page.slice.length,
    },
  };
}

// ── arxiv_search_paper_text ──────────────────────────────────────────────────

export const arxivSearchTextSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
  query: z.string().min(1).max(200).describe('Text to find (case-insensitive, literal match).'),
  max_passages: z.number().int().min(1).max(25).default(8).describe('Maximum passages to return (default 8, max 25).'),
  passage_chars: z.number().int().min(50).max(2000).default(800).describe(
    'Characters of context per passage, centred on the match (default 800, max 2000).'
  ),
});

interface Passage {
  section_id: string;
  offset: number;
  snippet: string;
}

/** Case-insensitive matches across sections; each passage's offset is within its section's text. */
export function findPassages(sections: PaperSection[], query: string, passageChars: number): Passage[] {
  const needle = query.toLowerCase();
  const out: Passage[] = [];
  for (const s of sections) {
    const hay = s.text.toLowerCase();
    // toLowerCase can change length for a few characters, which would shift every offset: skip then.
    if (hay.length !== s.text.length) continue;
    let from = 0;
    for (let at = hay.indexOf(needle, from); at !== -1; at = hay.indexOf(needle, from)) {
      const start = Math.max(0, at - Math.max(0, Math.floor((passageChars - needle.length) / 2)));
      const end = Math.min(s.text.length, start + passageChars);
      out.push({ section_id: s.id, offset: start, snippet: s.text.slice(start, end).replace(/\s+/g, ' ').trim() });
      from = Math.max(at + needle.length, end); // matches inside this snippet are not repeated
    }
  }
  return out;
}

export async function handleArxivSearchText(
  input: z.infer<typeof arxivSearchTextSchema>,
  step?: StepFn
): Promise<ToolOut> {
  const l = await load(input.paper_id, step);
  if (!l) return notFound(`No paper found with ID: ${input.paper_id}`);
  const all = findPassages(l.sectioned.sections, input.query, input.passage_chars);
  const passages = all.slice(0, input.max_passages);
  const body = passages.length === 0
    ? `No matches for "${input.query}".`
    : passages.map((p, i) => `${i + 1}. \`${p.section_id}\` @${p.offset}: ${p.snippet}`).join('\n\n');
  return {
    text: `${header(l)}## Matches for "${input.query}" (${passages.length} of ${all.length})\n\n${body}\n`,
    structured: {
      arxiv_id: l.arxivId,
      source: l.sectioned.source,
      query: input.query,
      total_passages: all.length,
      passages,
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

const META = { 'anthropic/maxResultSizeChars': 200000 };

export function registerArxivSectionTools(server: McpServer): void {
  addTool(server, 'arxiv_get_paper_outline', {
    title: 'arXiv paper outline',
    description:
      'List the sections of an arXiv paper (id, level, title, size) without returning their text. ' +
      'Uses the arXiv HTML rendering, then ar5iv, then PDF text with heading heuristics. ' +
      'Follow with arxiv_read_paper_section for one section instead of reading the whole paper. ' +
      'Titles are untrusted external content and are returned behind a warning banner.',
    inputSchema: arxivOutlineSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      source: z.enum(['html', 'ar5iv', 'pdf']),
      sections: z.array(z.object({ id: z.string(), level: z.number(), title: z.string(), chars: z.number() })),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
  }, (input, ctx) => handleArxivOutline(input, progress(ctx, PROGRESS_STEPS)));

  addTool(server, 'arxiv_read_paper_section', {
    title: 'Read arXiv paper section',
    description:
      'Read one section of an arXiv paper by id (from arxiv_get_paper_outline), paginated with offset/max_chars. ' +
      'Math is returned as TeX ($...$). The text is untrusted external content behind a warning banner.',
    inputSchema: arxivReadSectionSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      source: z.enum(['html', 'ar5iv', 'pdf']),
      section_id: z.string(),
      title: z.string(),
      offset: z.number(),
      next_offset: z.number().nullable(),
      total_chars: z.number(),
      returned_chars: z.number(),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
    _meta: META,
  }, (input, ctx) => handleArxivReadSection(input, progress(ctx, PROGRESS_STEPS)));

  addTool(server, 'arxiv_search_paper_text', {
    title: 'Search arXiv paper text',
    description:
      'Find a phrase inside one arXiv paper (case-insensitive). Returns passages with the section id and the ' +
      'offset within that section, ready for arxiv_read_paper_section. The text is untrusted external content ' +
      'behind a warning banner.',
    inputSchema: arxivSearchTextSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      source: z.enum(['html', 'ar5iv', 'pdf']),
      query: z.string(),
      total_passages: z.number(),
      passages: z.array(z.object({ section_id: z.string(), offset: z.number(), snippet: z.string() })),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
    _meta: META,
  }, (input, ctx) => handleArxivSearchText(input, progress(ctx, PROGRESS_STEPS)));
}
