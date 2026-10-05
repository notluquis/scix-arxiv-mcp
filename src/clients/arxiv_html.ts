// Pure parsing of arXiv's LaTeXML HTML (and ar5iv) into sections, plus a heading heuristic for
// plain text (PDF). No network, no DOM dependency: regex over a well-formed, machine-made format.

export interface PaperSection {
  id: string;
  level: number;
  title: string;
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(x?[0-9a-fA-F]+);/g, (match, value: string) => {
      const codePoint = value.startsWith('x') || value.startsWith('X')
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    })
    .replace(/&([a-zA-Z]+);/g, (match, entity: string) => NAMED_ENTITIES[entity] ?? match);
}

export function normalizeText(text: string): string {
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

  // Tag removal leaves runs of spaces around citations and refs; collapse them (newlines stay).
  const collapsed = decodeHtmlEntities(stripped).replace(/[ \t]+/g, ' ').replace(/\n /g, '\n');
  return normalizeText(collapsed).replace(/\n{3,}/g, '\n\n');
}

// ── MathML → TeX ─────────────────────────────────────────────────────────────

// Attribute-aware: a quoted attribute value may contain '>' (it does not in LaTeXML, but be safe).
const MATH_RE = /<math\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/math>/gi;

function mathSource(attrs: string, inner: string): { tex: string; display: boolean } | undefined {
  const alt = /\balttext\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  let raw = alt ? (alt[1] ?? alt[2] ?? '') : '';
  if (!raw.trim()) {
    raw = /<annotation\b[^>]*application\/x-tex[^>]*>([\s\S]*?)<\/annotation>/i.exec(inner)?.[1] ?? '';
  }
  const tex = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
  if (!tex) return undefined;
  return { tex, display: /\bdisplay\s*=\s*["']block["']/i.test(attrs) };
}

/** Replace every `<math alttext="X">` with `$X$` (`$$X$$` for display="block"). */
export function mathmlToTex(html: string): string {
  return html.replace(MATH_RE, (whole, attrs: string, inner: string) => {
    const m = mathSource(attrs, inner);
    if (!m) return whole;
    return m.display ? `$$${m.tex}$$` : `$${m.tex}$`;
  });
}

/**
 * HTML to text with math rendered as TeX. TeX can contain `<`, `>` and `&`, so it is swapped in
 * after the tags are stripped and entities decoded, never before.
 */
export function htmlToText(html: string): string {
  const tex: string[] = [];
  const masked = html.replace(MATH_RE, (whole, attrs: string, inner: string) => {
    const m = mathSource(attrs, inner);
    if (!m) return whole;
    tex.push(m.display ? `\n\n$$${m.tex}$$\n\n` : `$${m.tex}$`);
    return `\uE000${tex.length - 1}\uE001`;
  });
  const text = extractHtmlText(masked);
  return normalizeText(text.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => tex[Number(i)] ?? ''));
}

// ── LaTeXML sections ─────────────────────────────────────────────────────────

interface SectionSpan {
  id: string;
  level: number;
  start: number;
  end: number;
  title: string;
}

const LEVEL_BY_CLASS: [string, number][] = [
  ['ltx_subsubsection', 3],
  ['ltx_subsection', 2],
  ['ltx_section', 1],
  ['ltx_appendix', 1],
  ['ltx_bibliography', 1],
];

/** Index just past the matching close tag, counting nested tags of the same name. */
function findClose(html: string, openStart: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = openStart;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length; // unbalanced: take the rest rather than drop the section
}

function titleOf(chunk: string, fallback: string): string {
  const h = /<(h[1-6])\b[^>]*class="[^"]*\bltx_title\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i.exec(chunk);
  if (!h) return fallback;
  const title = htmlToText(h[2]).replace(/\s+/g, ' ').trim();
  return title || fallback;
}

function classTokens(attrs: string): string[] {
  return (/\bclass\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? '').split(/\s+/);
}

/**
 * Sections of a LaTeXML page in document order: the abstract, `ltx_section`/`ltx_subsection`/
 * `ltx_subsubsection`, appendices and the bibliography. Each section's text excludes its nested
 * sections, which are listed as their own entries, so no passage appears twice.
 */
export function parseSections(html: string): PaperSection[] {
  const spans: SectionSpan[] = [];

  const abstract = /<div\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  for (let m = abstract.exec(html); m; m = abstract.exec(html)) {
    if (!classTokens(m[1]).includes('ltx_abstract')) continue;
    const end = findClose(html, m.index, 'div');
    spans.push({ id: 'abstract', level: 1, start: m.index, end, title: titleOf(html.slice(m.index, end), 'Abstract') });
    break;
  }

  const open = /<section\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tokens = classTokens(m[1]);
    const level = LEVEL_BY_CLASS.find(([cls]) => tokens.includes(cls))?.[1];
    const id = /\bid\s*=\s*"([^"]+)"/i.exec(m[1])?.[1];
    if (!level || !id) continue;
    const end = findClose(html, m.index, 'section');
    spans.push({ id, level, start: m.index, end, title: titleOf(html.slice(m.index, end), id) });
  }

  spans.sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  const sections: PaperSection[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    // Own text: the span minus every section nested inside it.
    let cursor = s.start;
    let own = '';
    let j = i + 1;
    while (j < spans.length && spans[j].start < s.end) {
      own += html.slice(cursor, spans[j].start);
      cursor = spans[j].end;
      const skipTo = spans[j].end;
      while (j < spans.length && spans[j].start < skipTo) j++;
    }
    own += html.slice(cursor, s.end);
    sections.push({ id: s.id, level: s.level, title: s.title, text: dropHeadingLine(htmlToText(own), s.title) });
  }
  return sections;
}

/** LaTeXML repeats the heading as the first line of the body; the title is reported separately. */
function dropHeadingLine(text: string, title: string): string {
  const nl = text.indexOf('\n');
  const first = (nl === -1 ? text : text.slice(0, nl)).replace(/\s+/g, ' ').trim();
  if (!first || first !== title.replace(/\s+/g, ' ').trim()) return text;
  return nl === -1 ? '' : text.slice(nl + 1).trim();
}

/**
 * Final pass over a section list, whatever its source: a blank title falls back to the id, and a
 * section with neither a title nor any text is dropped (it would be a bare "-" in the outline).
 */
export function tidySections(sections: PaperSection[]): PaperSection[] {
  const out: PaperSection[] = [];
  for (const s of sections) {
    const title = s.title.trim();
    if (!title && !s.text.trim()) continue;
    out.push({ ...s, title: title || s.id });
  }
  return out;
}

// ── Plain-text (PDF) headings ────────────────────────────────────────────────

const BARE_TITLES = new Set([
  'abstract', 'introduction', 'background', 'related work', 'related works', 'method', 'methods',
  'methodology', 'approach', 'experiment', 'experiments', 'experimental setup', 'results',
  'result', 'discussion', 'discussions', 'conclusion', 'conclusions', 'future work',
  'limitations', 'appendix', 'appendices', 'acknowledgement', 'acknowledgements',
  'acknowledgment', 'acknowledgments', 'notation', 'preliminaries', 'problem formulation',
  'problem statement', 'data', 'observations', 'analysis', 'summary',
]);
const TERMINATORS = new Set(['references', 'reference', 'bibliography']);
const ATX_RE = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const NUMBERED_RE = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?[ \t]+(\p{Lu}.{0,78})$/u;
const MAX_HEADING_WORDS = 10;

function bareKey(line: string): string {
  return line.trim().replace(/[:.]$/, '').toLowerCase();
}

/** A numbered line is a heading only when it reads like a title, not a list item or a sentence. */
function plausibleTitle(title: string): boolean {
  const t = title.trim();
  return t.length <= 80 && !/[.,;:]$/.test(t) && t.split(/\s+/).length <= MAX_HEADING_WORDS;
}

/**
 * Split extracted text (PDF) into sections by heading heuristics: ATX `#`, numbered headings
 * ("2.1 Data"), and bare common titles ("Introduction"). Heading detection stops at References.
 * Text with no recognised heading becomes one synthetic section "1".
 */
export function textToSections(text: string): PaperSection[] {
  const lines = text.split('\n');
  const heads: { line: number; id: string; level: number; title: string }[] = [];
  let bare = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let id: string | undefined;
    let level = 1;
    let title = line;
    const atx = ATX_RE.exec(line);
    const num = NUMBERED_RE.exec(atx ? atx[2] : line);
    if (num && plausibleTitle(num[2]) && num[1].split('.').every(p => Number(p) >= 1)) {
      id = num[1];
      level = num[1].split('.').length;
      title = num[2].trim();
    } else if (atx) {
      title = atx[2].trim();
      level = atx[1].length;
      id = `s${++bare}`;
    } else if (BARE_TITLES.has(bareKey(line)) || TERMINATORS.has(bareKey(line))) {
      id = `s${++bare}`;
    }
    if (!id) continue;
    heads.push({ line: i, id, level, title });
    if (TERMINATORS.has(bareKey(title))) break;
  }

  if (heads.length === 0) {
    return text.trim() ? [{ id: '1', level: 1, title: 'Full text', text: text.trim() }] : [];
  }

  const sections: PaperSection[] = [];
  const seen = new Set<string>();
  const front = lines.slice(0, heads[0].line).join('\n').trim();
  if (front) sections.push({ id: 'preamble', level: 1, title: 'Preamble', text: front });
  heads.forEach((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].line : lines.length;
    let id = h.id;
    for (let n = 2; seen.has(id); n++) id = `${h.id}-${n}`;
    seen.add(id);
    sections.push({ id, level: h.level, title: h.title, text: lines.slice(h.line, end).join('\n').trim() });
  });
  return sections;
}
