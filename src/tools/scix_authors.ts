import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ScixClient, getScixClient } from '../clients/scix.js';
import { DEFAULT_FIELDS } from '../config.js';
import { formatScixList } from '../formatters.js';
import { solrPhrase } from '../ids.js';
import { SCIX_ICONS } from '../icons.js';
import { READ_EXTERNAL, addTool, listOutput, responseFormat, type ToolOut } from '../content.js';
import { scixItem, scixItemOut, type Doc } from './scix.js';

type In<S extends z.ZodType> = Omit<z.infer<S>, 'response_format'>;

type SearchResponse = { response?: { numFound?: number; docs?: unknown[] } };

const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
const AFFILIATION_BIBCODE_CAP = 500;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Several ADS services answer HTTP 200 with an error body; surface those as tool errors. */
function assertNoErrorKey(data: unknown, service: string): void {
  if (!isRecord(data)) return;
  const key = Object.keys(data).find(k => /^error/i.test(k));
  if (key === undefined) return;
  const info = Object.entries(data).filter(([k]) => /^error/i.test(k)).map(([, v]) => String(v)).join(' ');
  throw new Error(`${service} reported an error: ${info}`.trim());
}

// ── scix_author_papers ───────────────────────────────────────────────────────

const metricsOut = z.object({
  h: z.number().optional(),
  g: z.number().optional(),
  i10: z.number().optional(),
  m: z.number().optional(),
  tori: z.number().optional(),
  total_citations: z.number().optional(),
  refereed_citations: z.number().optional(),
});

const authorPapersOut = listOutput(scixItemOut).extend({ metrics: metricsOut.optional() });

export const scixAuthorPapersSchema = z.object({
  author: z.string().min(1).max(200).optional().describe(
    'Author name as "Last, First" or "Last, F". Example: "Hawking, S". Give this or orcid.'
  ),
  orcid: z.string().optional().describe(
    'ORCID iD (0000-0002-1825-0097). Takes precedence over author and matches that person only.'
  ),
  first_author_only: z.boolean().default(false).describe('Only papers where this person is first author (author name only, not with orcid)'),
  year_from: z.number().int().min(1000).max(3000).optional().describe('Earliest publication year'),
  year_to: z.number().int().min(1000).max(3000).optional().describe('Latest publication year'),
  rows: z.number().int().min(1).max(200).default(20).describe('Number of papers (max 200)'),
  include_metrics: z.boolean().default(true).describe(
    'Also compute h/g/i10, tori and citation totals over the returned papers'
  ),
  response_format: responseFormat,
});

function authorQuery(input: In<typeof scixAuthorPapersSchema>): string {
  let q: string;
  if (input.orcid) {
    const orcid = input.orcid.trim();
    if (!ORCID.test(orcid)) throw new Error('Invalid ORCID: expected the form 0000-0002-1825-0097');
    if (input.first_author_only) {
      throw new Error('first_author_only works with the author name, not with orcid');
    }
    q = `orcid:${solrPhrase(orcid)}`;
  } else if (input.author) {
    const name = input.author.trim();
    q = `author:${solrPhrase(input.first_author_only ? `^${name}` : name)}`;
  } else {
    throw new Error('Give author or orcid');
  }
  if (input.year_from !== undefined || input.year_to !== undefined) {
    q += ` AND year:[${input.year_from ?? '*'} TO ${input.year_to ?? '*'}]`;
  }
  return q;
}

type Metrics = z.infer<typeof metricsOut>;

function pickMetrics(data: Record<string, unknown>): Metrics {
  const ind = (isRecord(data['indicators']) ? data['indicators'] : {}) as Record<string, number | undefined>;
  const cit = (isRecord(data['citation stats']) ? data['citation stats'] : {}) as Record<string, number | undefined>;
  return {
    h: ind['h'], g: ind['g'], i10: ind['i10'], m: ind['m'], tori: ind['tori'],
    total_citations: cit['total number of citations'],
    refereed_citations: cit['total number of refereed citations'],
  };
}

export async function handleScixAuthorPapers(
  client: ScixClient,
  input: In<typeof scixAuthorPapersSchema>
): Promise<ToolOut> {
  const q = authorQuery(input);
  const data = await client.get('search/query', {
    q, fl: DEFAULT_FIELDS, rows: input.rows, sort: 'date desc',
  }) as SearchResponse;

  const total = data.response?.numFound ?? 0;
  const docs = (data.response?.docs ?? []) as Doc[];
  let text = formatScixList(docs, total, `Papers for ${input.orcid ?? input.author}`);
  const structured: Record<string, unknown> = { total, start: 0, items: docs.map(scixItem) };

  const bibcodes = docs.map(d => d['bibcode']).filter((b): b is string => typeof b === 'string');
  if (input.include_metrics && bibcodes.length > 0) {
    try {
      const raw = await client.post('metrics', { bibcodes, types: ['basic', 'citations', 'indicators'] }, { idempotent: true });
      const metrics = pickMetrics(isRecord(raw) ? raw : {});
      structured['metrics'] = metrics;
      text += `## Metrics (over the ${bibcodes.length} papers above)\n\n` +
        `- h-index: ${metrics.h ?? 'n/a'}, g-index: ${metrics.g ?? 'n/a'}, i10-index: ${metrics.i10 ?? 'n/a'}\n` +
        (metrics.m != null ? `- m-index: ${Number(metrics.m).toFixed(2)}\n` : '') +
        (metrics.tori != null ? `- tori: ${Number(metrics.tori).toFixed(2)}\n` : '') +
        `- Citations: ${metrics.total_citations ?? 0} (refereed: ${metrics.refereed_citations ?? 0})\n`;
    } catch (e) {
      // The paper list is still useful without metrics.
      text += `\n*Metrics unavailable: ${e instanceof Error ? e.message : String(e)}*\n`;
    }
  }
  if (total > docs.length) text += `\n*${total - docs.length} more papers match; raise \`rows\` (max 200) or narrow with year_from/year_to.*\n`;
  return { text, structured };
}

// ── scix_author_affiliations ─────────────────────────────────────────────────

/** Enum strings from the ADS author-affiliation/export OpenAPI spec. */
export const AFFILIATION_EXPORT_FORMATS = {
  csv: '| Lastname, Firstname | Affiliation | Last Active Date | [csv]',
  text: 'Lastname, Firstname(Affiliation)Last Active Date[text]',
  browser: 'Lastname, Firstname(Affiliation)Last Active Date[browser]',
} as const;

const affiliationRowOut = z.object({
  author: z.string(),
  affiliation: z.string(),
  years: z.array(z.string()),
  last_active: z.string().optional(),
});

export const scixAuthorAffiliationsSchema = z.object({
  bibcodes: z.array(z.string().min(1).max(200)).min(1).max(AFFILIATION_BIBCODE_CAP).optional().describe(
    `Bibcodes to report on (max ${AFFILIATION_BIBCODE_CAP}). Give this or query.`
  ),
  query: z.string().min(1).max(1000).optional().describe(
    `SciX query whose first ${AFFILIATION_BIBCODE_CAP} results are used instead of explicit bibcodes`
  ),
  maxauthor: z.number().int().min(1).max(100).default(3).describe('First N authors of each paper to report'),
  numyears: z.number().int().min(1).max(50).default(4).describe('Affiliations from the last N years'),
  export_format: z.enum(['csv', 'text', 'browser']).optional().describe(
    'Also render the report as csv, text or browser (via the ADS export service) for grant co-author forms'
  ),
  response_format: responseFormat,
});

function affiliationRows(data: unknown): Array<z.infer<typeof affiliationRowOut>> {
  const entries = isRecord(data) && Array.isArray(data['data']) ? data['data'] : [];
  const rows: Array<z.infer<typeof affiliationRowOut>> = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const author = String(entry['authorName'] ?? '');
    const affs = Array.isArray(entry['affiliations']) ? entry['affiliations'] : [entry['affiliations']];
    for (const aff of affs) {
      if (typeof aff === 'string') {
        rows.push({ author, affiliation: aff, years: [] });
      } else if (isRecord(aff)) {
        rows.push({
          author,
          affiliation: String(aff['name'] ?? ''),
          years: Array.isArray(aff['years']) ? aff['years'].map(String) : [],
          last_active: aff['lastActiveDate'] === undefined ? undefined : String(aff['lastActiveDate']),
        });
      }
    }
  }
  return rows;
}

export async function handleScixAuthorAffiliations(
  client: ScixClient,
  input: In<typeof scixAuthorAffiliationsSchema>
): Promise<ToolOut> {
  if ((input.bibcodes === undefined) === (input.query === undefined)) {
    throw new Error('Give exactly one of bibcodes or query');
  }

  let bibcodes = input.bibcodes;
  if (bibcodes === undefined) {
    const found = await client.get('search/query', {
      q: input.query, fl: 'bibcode', rows: AFFILIATION_BIBCODE_CAP,
    }) as SearchResponse;
    bibcodes = ((found.response?.docs ?? []) as Doc[])
      .map(d => d['bibcode']).filter((b): b is string => typeof b === 'string');
    if (bibcodes.length === 0) throw new Error(`No papers found for query: ${input.query}`);
  }

  const raw = await client.post(
    'author-affiliation/search',
    { bibcode: bibcodes, maxauthor: input.maxauthor, numyears: input.numyears },
    { idempotent: true }
  );
  const rows = affiliationRows(raw);

  let text = `# Author affiliations\n\n${rows.length} author/affiliation rows from ${bibcodes.length} paper(s) ` +
    `(first ${input.maxauthor} authors, last ${input.numyears} years)\n\n`;
  for (const r of rows) {
    text += `- ${r.author} | ${r.affiliation}${r.last_active ? ` | ${r.last_active}` : ''}\n`;
  }

  const structured: Record<string, unknown> = { papers: bibcodes.length, rows };
  if (input.export_format) {
    const selected = rows.map(r => `${r.author} | ${r.affiliation} | ${r.last_active ?? ''}`);
    const body = await client.postText(
      'author-affiliation/export',
      { format: AFFILIATION_EXPORT_FORMATS[input.export_format], selected },
      { idempotent: true }
    );
    let exported = body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed) && typeof parsed['export'] === 'string') exported = parsed['export'];
    } catch {
      // plain text/CSV body
    }
    structured['export'] = exported;
    text += `\n## Export (${input.export_format})\n\n${exported}\n`;
  }
  return { text, structured };
}

// ── scix_resolve_objects ─────────────────────────────────────────────────────

export const scixResolveObjectsSchema = z.object({
  names: z.array(z.string().min(1).max(200)).min(1).max(50).describe('Astronomical object names, e.g. ["M31", "NGC 1275"]'),
  source: z.enum(['simbad', 'ned']).default('simbad').describe('Name resolver'),
  expand_query: z.boolean().optional().describe(
    'Also return the Solr query that expands each object to its SIMBAD/NED identifiers'
  ),
  response_format: responseFormat,
});

export async function handleScixResolveObjects(
  client: ScixClient,
  input: In<typeof scixResolveObjectsSchema>
): Promise<ToolOut> {
  const data = await client.post('objects', { source: input.source, objects: input.names }, { idempotent: true });
  assertNoErrorKey(data, 'ADS objects service');
  const map = isRecord(data) ? data : {};

  const expansions = new Map<string, string>();
  const expand = async (name: string): Promise<string> => {
    const known = expansions.get(name);
    if (known !== undefined) return known;
    const r = await client.post('objects/query', { query: [`object:${solrPhrase(name)}`] }, { idempotent: true });
    assertNoErrorKey(r, 'ADS objects/query service');
    const query = isRecord(r) ? String(r['query'] ?? '') : '';
    expansions.set(name, query);
    return query;
  };
  // SIMBAD needs its canonical spacing ("NGC  6383"), so /objects answers null for "NGC 6383" while objects/query
  // still expands it. For null names, take the identifier from the expansion instead of reporting "not recognized".
  const idPattern = input.source === 'simbad' ? /simbid:"?(\d+)/ : /nedid:"?([^"\s)]+)/;

  const items: { input: string; id: string | null; canonical: string | null; resolved_via?: 'query_expansion' }[] = [];
  for (const name of input.names) {
    const hit = map[name];
    const rec = isRecord(hit) ? hit : undefined;
    const item: (typeof items)[number] = {
      input: name,
      id: rec?.['id'] == null ? null : String(rec['id']),
      canonical: rec?.['canonical'] == null ? null : String(rec['canonical']),
    };
    if (item.id === null && item.canonical === null) {
      const id = idPattern.exec(await expand(name))?.[1];
      if (id) { item.id = id; item.resolved_via = 'query_expansion'; }
    }
    items.push(item);
  }

  const structured: Record<string, unknown> = { source: input.source, items };
  let text = `# Objects (${input.source})\n\n` +
    items.map(i => `- ${i.input} → ${i.canonical ?? (i.resolved_via ? `resolved via query expansion` : 'not recognized')}` +
      `${i.id ? ` (id ${i.id})` : ''}`).join('\n') + '\n';

  if (input.expand_query) {
    const expanded: Array<{ name: string; query: string }> = [];
    for (const name of input.names) expanded.push({ name, query: await expand(name) });
    structured['expanded_queries'] = expanded;
    text += `\n## Expanded queries\n\n` + expanded.map(e => `- ${e.name}: \`${e.query}\``).join('\n') + '\n';
  }
  return { text, structured };
}

// ── scix_citation_helper ─────────────────────────────────────────────────────

export const scixCitationHelperSchema = z.object({
  bibcodes: z.array(z.string().min(1).max(200)).min(1).max(100).describe('Bibcodes of the papers you already cite (max 100)'),
  response_format: responseFormat,
});

export async function handleScixCitationHelper(
  client: ScixClient,
  input: In<typeof scixCitationHelperSchema>
): Promise<ToolOut> {
  const data = await client.post('citation_helper', { bibcodes: input.bibcodes }, { idempotent: true });
  assertNoErrorKey(data, 'ADS citation_helper service');
  const list = Array.isArray(data) ? data : [];
  const items = list.filter(isRecord).map(r => ({
    bibcode: String(r['bibcode'] ?? ''),
    title: String(r['title'] ?? ''),
    author: r['author'] === undefined ? undefined : String(r['author']),
    score: Number(r['score'] ?? 0),
  }));
  const text = items.length === 0
    ? 'No missing citations suggested.'
    : '# Suggested missing citations\n\n' +
      items.map((i, n) => `${n + 1}. **${i.title}**\n   - ${i.author ?? 'Unknown'}\n   - Bibcode: \`${i.bibcode}\`\n   - Score: ${i.score}`).join('\n\n') + '\n';
  return { text, structured: { total: items.length, start: 0, items } };
}

// ── scix_resolve_references ──────────────────────────────────────────────────

export const scixResolveReferencesSchema = z.object({
  references: z.array(z.string().min(1).max(1000)).min(1).max(50).describe(
    'Free-text reference strings, e.g. "Blandford, R. D., & Znajek, R. L. 1977, MNRAS, 179, 433" (max 50)'
  ),
  response_format: responseFormat,
});

export async function handleScixResolveReferences(
  client: ScixClient,
  input: In<typeof scixResolveReferencesSchema>
): Promise<ToolOut> {
  // The live service answers HTTP 200 with a PLAIN-TEXT body (empty content-type), one line per reference:
  //   `1.0 2012Sci...337..444S -- Sana, H. et al. 2012, Science, 337, 444`
  // The OpenAPI documents JSON ({"resolved": ...}); a body starting with { or [ is still parsed as JSON.
  const raw = (await client.postText('reference/text', { reference: input.references }, { idempotent: true })).trim();
  let items: { reference: string; bibcode?: string; score?: number; comment?: string }[];
  if (raw.startsWith('{') || raw.startsWith('[')) {
    const data: unknown = JSON.parse(raw);
    assertNoErrorKey(data, 'ADS reference service');
    // The OpenAPI example shows one object; accept either one object or a list.
    const resolved = isRecord(data) ? data['resolved'] : undefined;
    const list = Array.isArray(resolved) ? resolved : resolved === undefined ? [] : [resolved];
    items = list.filter(isRecord).map(r => ({
      reference: String(r['refstring'] ?? ''),
      bibcode: r['bibcode'] === undefined || r['bibcode'] === null ? undefined : String(r['bibcode']),
      score: r['score'] === undefined ? undefined : Number(r['score']),
      comment: r['comment'] === undefined ? undefined : String(r['comment']),
    }));
  } else {
    items = raw.split(/\r?\n/).filter(l => l.trim()).map(line => {
      const m = /^(\d+(?:\.\d+)?)\s+(\S+)\s+--\s+(.*)$/.exec(line.trim());
      // ponytail: the failure format is undocumented; anything but a 19-char bibcode counts as unresolved.
      if (!m) return { reference: line.trim(), comment: `unresolved: ${line.trim()}` };
      const bibcode = /^\d{4}\S{15}$/.test(m[2]!) ? m[2] : undefined;
      return bibcode
        ? { reference: m[3]!, bibcode, score: Number(m[1]) }
        : { reference: m[3]!, score: Number(m[1]), comment: `unresolved: ${line.trim()}` };
    });
  }
  const text = '# Resolved references\n\n' + items.map((i, n) =>
    `${n + 1}. ${i.reference}\n   - ${i.bibcode ? `Bibcode: \`${i.bibcode}\`` : 'not resolved'}` +
    `${i.score !== undefined ? ` (score ${i.score})` : ''}${i.comment ? `\n   - ${i.comment}` : ''}`
  ).join('\n') + '\n';
  return { text, structured: { total: items.length, start: 0, items } };
}

// ── Registration ─────────────────────────────────────────────────────────────

/** Tools 7-11 of the catalog. */
export function registerScixAuthorTools(server: McpServer): void {
  addTool(server, 'scix_author_papers', {
    title: 'Author papers and metrics',
    description:
      'List a person\'s papers in SciX/ADS by author name ("Last, F") or ORCID iD, optionally first-author only ' +
      'and limited to a year range, newest first. By default also returns h-index, g-index, i10, tori and ' +
      'citation totals computed over the returned papers (up to `rows`, max 200). Author names can be ' +
      'ambiguous; prefer orcid when known.',
    inputSchema: scixAuthorPapersSchema,
    outputSchema: authorPapersOut,
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixAuthorPapers(getScixClient(), input));

  addTool(server, 'scix_author_affiliations', {
    title: 'Author affiliations report',
    description:
      'Build the SciX author-affiliations report (co-authors and their recent affiliations, as requested ' +
      'by grant agencies) for a list of bibcodes or for the results of a query (first 500). ' +
      'maxauthor limits to the first N authors per paper; numyears to the last N years. ' +
      'export_format csv/text/browser also returns the report rendered by the ADS export service.',
    inputSchema: scixAuthorAffiliationsSchema,
    outputSchema: z.object({
      papers: z.number(),
      rows: z.array(affiliationRowOut),
      export: z.string().optional(),
    }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixAuthorAffiliations(getScixClient(), input));

  addTool(server, 'scix_resolve_objects', {
    title: 'Resolve astronomical objects',
    description:
      'Resolve object names (M31, NGC 1275, ...) to SIMBAD or NED identifiers and canonical names. ' +
      'Names SIMBAD does not match by spelling (it wants its own spacing, e.g. "NGC  6383") are retried through query ' +
      'expansion and returned with resolved_via="query_expansion". expand_query also returns the Solr query that includes those identifiers. ' +
      'You usually do not need this: scix_search accepts object:"M31" directly.',
    inputSchema: scixResolveObjectsSchema,
    outputSchema: z.object({
      source: z.string(),
      items: z.array(z.object({
        input: z.string(), id: z.string().nullable(), canonical: z.string().nullable(),
        resolved_via: z.literal('query_expansion').optional(),
      })),
      expanded_queries: z.array(z.object({ name: z.string(), query: z.string() })).optional(),
    }),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixResolveObjects(getScixClient(), input));

  addTool(server, 'scix_citation_helper', {
    title: 'Suggest missing citations',
    description:
      'Given the bibcodes of papers you already cite, suggest up to 10 missing citations: papers that cite or ' +
      'are cited by several of them but are not in the list. The score counts how many of your papers each ' +
      'suggestion is connected to.',
    inputSchema: scixCitationHelperSchema,
    outputSchema: listOutput(z.object({
      bibcode: z.string(), title: z.string(), author: z.string().optional(), score: z.number(),
    })),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixCitationHelper(getScixClient(), input));

  addTool(server, 'scix_resolve_references', {
    title: 'Resolve reference strings',
    description:
      'Resolve free-text reference strings (as in a paper\'s bibliography) to SciX bibcodes. Returns the ' +
      'bibcode, a confidence score (0 low to 1 high) and an error comment per reference. Up to 50 per call.',
    inputSchema: scixResolveReferencesSchema,
    outputSchema: listOutput(z.object({
      reference: z.string(),
      bibcode: z.string().optional(),
      score: z.number().optional(),
      comment: z.string().optional(),
    })),
    annotations: READ_EXTERNAL,
    icons: SCIX_ICONS,
  }, input => handleScixResolveReferences(getScixClient(), input));
}
