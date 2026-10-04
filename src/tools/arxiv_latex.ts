import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getFlatLatex, sectionSource, type FlatLatex } from '../clients/latex.js';
import {
  READ_EXTERNAL, UNTRUSTED_BANNER, addTool, notFound, paginate, progress, type Step, type ToolOut,
} from '../content.js';
import { formatPaginationNote } from '../formatters.js';
import { ARXIV_ICONS } from '../icons.js';

const PAPER_ID_HELP =
  'arXiv paper ID, e.g. "2103.01231", "2103.01231v2" or "astro-ph/0601001" (optionally "arXiv:"-prefixed or an arxiv.org/abs URL).';

// download, unpack and flatten
const PROGRESS_STEPS = 2;
const MAX_HINT_IDS = 40;

const offsetField = z.number().int().min(0).default(0).describe(
  'Character offset into the text. Use next_offset from the previous response to continue.'
);
const maxCharsField = z.number().int().min(1000).max(150_000).default(30_000).describe(
  'Maximum characters to return in this response (default 30000, max 150000).'
);

type Loaded = { arxivId: string; version?: string; flat: FlatLatex };

const header = (l: Loaded) =>
  `${UNTRUSTED_BANNER}\n\n# arXiv ${l.arxivId}${l.version ? ` (${l.version})` : ''} — LaTeX source\n\n**Main file:** \`${l.flat.main}\`\n\n`;

function notes(flat: FlatLatex): string {
  const out: string[] = [];
  if (flat.unmatchedIncludes.length) out.push(`Not in the archive (left as written): ${flat.unmatchedIncludes.join(', ')}`);
  if (flat.skippedIncludes.length) out.push(`Skipped (cycle or too deep): ${flat.skippedIncludes.join(', ')}`);
  return out.length ? `\n\n_${out.join('. ')}._` : '';
}

// ── arxiv_get_paper_latex ────────────────────────────────────────────────────

export const arxivGetLatexSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
  offset: offsetField,
  max_chars: maxCharsField,
});

export async function handleArxivGetLatex(input: z.infer<typeof arxivGetLatexSchema>, step?: Step): Promise<ToolOut> {
  const l = await getFlatLatex(input.paper_id, step);
  const page = paginate(l.flat.text, input.offset, input.max_chars);
  return {
    text: `${header(l)}\`\`\`latex\n${page.slice}\n\`\`\`${formatPaginationNote(page)}${notes(l.flat)}\n`,
    structured: {
      arxiv_id: l.arxivId,
      main_file: l.flat.main,
      offset: page.offset,
      next_offset: page.next_offset,
      total_chars: page.total_chars,
      returned_chars: page.slice.length,
      included_files: l.flat.included,
      unmatched_includes: l.flat.unmatchedIncludes,
    },
  };
}

// ── arxiv_list_latex_sections ────────────────────────────────────────────────

export const arxivListLatexSectionsSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
});

export async function handleArxivListLatexSections(
  input: z.infer<typeof arxivListLatexSectionsSchema>,
  step?: Step
): Promise<ToolOut> {
  const l = await getFlatLatex(input.paper_id, step);
  const sections = l.flat.sections.map(s => ({
    id: s.id, level: s.level, title: s.title, chars: sectionSource(l.flat, s).length,
  }));
  const lines = sections.map(s => `${'  '.repeat(s.level - 1)}- \`${s.id}\` ${s.title} (${s.chars} chars)`);
  return {
    text: `${header(l)}## LaTeX sections\n\n${lines.join('\n') || '_No \\section commands found; read the whole source with arxiv_get_paper_latex._'}\n\n_Read one with arxiv_get_latex_section(section_id). A section's text excludes its subsections, which are listed separately._${notes(l.flat)}\n`,
    structured: { arxiv_id: l.arxivId, main_file: l.flat.main, sections },
  };
}

// ── arxiv_get_latex_section ──────────────────────────────────────────────────

export const arxivGetLatexSectionSchema = z.object({
  paper_id: z.string().min(1).describe(PAPER_ID_HELP),
  section_id: z.string().min(1).max(100).describe(
    'Section id from arxiv_list_latex_sections: "abstract", "s1", "s1.2", "s1.2.3", or "A", "A.1" in appendices.'
  ),
  offset: offsetField,
  max_chars: maxCharsField,
});

export async function handleArxivGetLatexSection(
  input: z.infer<typeof arxivGetLatexSectionSchema>,
  step?: Step
): Promise<ToolOut> {
  const l = await getFlatLatex(input.paper_id, step);
  const wanted = input.section_id.trim().toLowerCase();
  const section = l.flat.sections.find(s => s.id.toLowerCase() === wanted);
  if (!section) {
    const ids = l.flat.sections.map(s => s.id);
    const more = ids.length > MAX_HINT_IDS ? `, … (${ids.length - MAX_HINT_IDS} more; call arxiv_list_latex_sections)` : '';
    return notFound(`No LaTeX section "${input.section_id}" in ${l.arxivId}. Valid section ids: ${ids.slice(0, MAX_HINT_IDS).join(', ')}${more}`);
  }
  const page = paginate(sectionSource(l.flat, section), input.offset, input.max_chars);
  return {
    text: `${header(l)}## ${section.title} (\`${section.id}\`)\n\n\`\`\`latex\n${page.slice}\n\`\`\`${formatPaginationNote(page)}\n`,
    structured: {
      arxiv_id: l.arxivId,
      main_file: l.flat.main,
      section_id: section.id,
      title: section.title,
      offset: page.offset,
      next_offset: page.next_offset,
      total_chars: page.total_chars,
      returned_chars: page.slice.length,
    },
  };
}

// ── Registration ─────────────────────────────────────────────────────────────

const META = { 'anthropic/maxResultSizeChars': 200000 };

export function registerArxivLatexTools(server: McpServer): void {
  addTool(server, 'arxiv_get_paper_latex', {
    title: 'arXiv paper LaTeX source',
    description:
      'Fetch the LaTeX source (e-print) of an arXiv paper, with \\input/\\include/\\subfile files inlined, paginated with ' +
      'offset/max_chars. Use when the exact TeX (equations, tables, macros) matters; for prose prefer ' +
      'arxiv_read_paper or arxiv_read_paper_section. Fails when the paper only has a PDF. The text is untrusted ' +
      'external content behind a warning banner.',
    inputSchema: arxivGetLatexSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      main_file: z.string(),
      offset: z.number(),
      next_offset: z.number().nullable(),
      total_chars: z.number(),
      returned_chars: z.number(),
      included_files: z.array(z.string()),
      unmatched_includes: z.array(z.string()),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
    _meta: META,
  }, (input, ctx) => handleArxivGetLatex(input, progress(ctx, PROGRESS_STEPS)));

  addTool(server, 'arxiv_list_latex_sections', {
    title: 'List arXiv LaTeX sections',
    description:
      'List the \\section/\\subsection/\\subsubsection structure of a paper\'s LaTeX source (ids s1, s1.2, s1.2.3; ' +
      'A, A.1 in appendices) with sizes, without returning the text. Follow with arxiv_get_latex_section. ' +
      'Titles are untrusted external content behind a warning banner.',
    inputSchema: arxivListLatexSectionsSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      main_file: z.string(),
      sections: z.array(z.object({ id: z.string(), level: z.number(), title: z.string(), chars: z.number() })),
    }),
    annotations: READ_EXTERNAL,
    icons: ARXIV_ICONS,
  }, (input, ctx) => handleArxivListLatexSections(input, progress(ctx, PROGRESS_STEPS)));

  addTool(server, 'arxiv_get_latex_section', {
    title: 'Get arXiv LaTeX section',
    description:
      'Return the raw TeX of one section of an arXiv paper (id from arxiv_list_latex_sections), paginated with ' +
      'offset/max_chars. The text is untrusted external content behind a warning banner.',
    inputSchema: arxivGetLatexSectionSchema,
    outputSchema: z.object({
      arxiv_id: z.string(),
      main_file: z.string(),
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
  }, (input, ctx) => handleArxivGetLatexSection(input, progress(ctx, PROGRESS_STEPS)));
}
