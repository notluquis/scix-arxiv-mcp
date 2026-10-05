import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../helpers/harness.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';

// Every tool, through the real 2026-07-28 protocol path: the SDK validates structuredContent
// against each tool's outputSchema, so a handler/schema mismatch fails here.

const DOC = {
  bibcode: '2019ApJ...882L..24A', title: ['First Image of a Black Hole'], author: ['EHT'], year: '2019',
  pub: 'ApJL', citation_count: 1500, read_count: 5, doi: ['10.3847/x'], arxiv_id: '1906.11238', abstract: 'We present.',
};
const LIB = {
  id: 'abc123', name: 'Mine', description: 'd', num_documents: 1, date_created: '2024-01-01T00:00:00',
  date_last_modified: '2024-06-15T00:00:00', permission: 'owner', owner: 'me', public: false, num_users: 1,
};
const HTML = `<html><body><article><h1>T</h1><section><h2>Introduction</h2><p>Body text.</p></section>
<section><h2>Method</h2><p>More.</p></section><section><h2>Conclusion</h2><p>Done.</p></section>
<section><h2>References</h2><p>[1] X.</p></section></article></body></html>`;

let objectsBody: unknown = { M31: { id: '1', canonical: 'M  31' } };

function res(body: unknown, text?: string) {
  return {
    ok: true, status: 200, headers: new Headers(),
    json: async () => body, text: async () => text ?? JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

function route(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET';
  if (url.includes('author-affiliation/search')) return res({ data: [{ authorName: 'Doe, J', affiliations: { name: 'MIT', years: ['2024'], lastActiveDate: '2024/05' } }] });
  if (url.includes('author-affiliation/export')) return res(null, 'Doe, J,MIT,2024/05');
  if (url.endsWith('/objects/query')) return res({ query: '(object:M31)' });
  if (url.endsWith('/objects')) return res(JSON.parse(JSON.stringify(objectsBody)));
  if (url.includes('citation_helper')) return res([{ bibcode: 'S1', title: 'Suggested', author: 'Roe, R', score: 2 }]);
  if (url.includes('reference/text')) return res({ resolved: [{ refstring: 'R', bibcode: 'B', score: '1.0' }] });
  if (url.includes('search/query')) return res({ response: { numFound: 1, docs: [DOC] } });
  if (url.includes('/metrics')) return res({ indicators: { h: 1 }, 'citation stats': {}, 'basic stats': {} });
  if (url.includes('export/')) return res({ export: '@article{a}' });
  if (url.includes('/notes/')) return res({ content: 'a note' });
  if (url.includes('biblib/documents/')) return res({ number_added: 1 });
  if (url.endsWith('biblib/libraries') && method === 'POST') return res({ id: 'new1', name: 'N' });
  if (url.includes('biblib/libraries/abc123')) return res({ metadata: LIB, documents: ['A'] });
  if (url.includes('biblib/libraries')) return res({ libraries: [LIB] });
  if (url.includes('/api/query')) return res(null, makeAtomFeed([PAPER_1]));
  if (url.includes('/html/')) return res(null, HTML);
  if (url.includes('semanticscholar')) return res({ paperId: 'p', title: 'T', year: 2020, authors: [], externalIds: {}, citations: [], references: [] });
  throw new Error(`unrouted ${url}`);
}

const SCIX_CALLS: Array<[string, Record<string, unknown>]> = [
  ['scix_search', { query: 'black holes' }],
  ['scix_get_paper', { bibcode: '2019ApJ...882L..24A' }],
  ['scix_get_citations', { bibcode: '2019ApJ...882L..24A' }],
  ['scix_find_similar', { bibcode: '2019ApJ...882L..24A' }],
  ['scix_get_metrics', { bibcodes: ['2019ApJ...882L..24A'] }],
  ['scix_export', { bibcodes: ['2019ApJ...882L..24A'], format: 'ris' }],
  ['scix_author_papers', { author: 'Hawking, S' }],
  ['scix_author_papers', { orcid: '0000-0002-1825-0097', include_metrics: false }],
  ['scix_author_affiliations', { bibcodes: ['2019ApJ...882L..24A'], export_format: 'csv' }],
  ['scix_resolve_objects', { names: ['M31'], expand_query: true }],
  ['scix_citation_helper', { bibcodes: ['2019ApJ...882L..24A'] }],
  ['scix_resolve_references', { references: ['R'] }],
  ['scix_search', { query: 'black holes', collection: 'astronomy' }],
  ['scix_search_docs', { query: 'search syntax' }],
  ['scix_library_list', {}],
  ['scix_library_get', { library_id: 'abc123' }],
  ['scix_library_create', { name: 'N' }],
  ['scix_library_documents', { library_id: 'abc123', bibcodes: ['A'], action: 'add' }],
  ['scix_library_note', { library_id: 'abc123', bibcode: 'A', action: 'get' }],
  ['arxiv_search', { query: 'attention' }],
  ['arxiv_get_paper', { paper_id: '2103.01231' }],
];

describe('every tool through the protocol', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  const savedToken = process.env.SCIX_API_TOKEN;

  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c.close(); });
  beforeEach(() => {
    process.env.SCIX_API_TOKEN = 'test';
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => route(String(url), init)) as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (savedToken === undefined) delete process.env.SCIX_API_TOKEN;
    else process.env.SCIX_API_TOKEN = savedToken;
  });

  it.each(SCIX_CALLS)('%s: markdown by default, text differs from the structured JSON', async (name, args) => {
    const r = await c.client.callTool({ name, arguments: args });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toBeTruthy();
    const text = (r.content as { text: string }[])[0].text;
    expect(text).not.toBe(JSON.stringify(r.structuredContent));
  });

  it.each(SCIX_CALLS)('%s: response_format=json returns the structured result as text', async (name, args) => {
    const r = await c.client.callTool({ name, arguments: { ...args, response_format: 'json' } });
    expect(r.isError).toBeFalsy();
    const text = (r.content as { text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual(r.structuredContent);
  });

  it('scix_resolve_objects: a 200 response carrying an Error key is an isError result', async () => {
    objectsBody = { Error: 'Unable to get results!', 'Error Info': 'SIMBAD timeout' };
    try {
      const r = await c.client.callTool({ name: 'scix_resolve_objects', arguments: { names: ['M31'] } });
      expect(r.isError).toBe(true);
      expect((r.content as { text: string }[])[0].text).toContain('Unable to get results');
    } finally {
      objectsBody = { M31: { id: '1', canonical: 'M  31' } };
    }
  });

  it('arxiv_read_paper and arxiv_citation_graph satisfy their output schemas', async () => {
    const read = await c.client.callTool({ name: 'arxiv_read_paper', arguments: { paper_id: '2103.01231' } });
    expect(read.isError).toBeFalsy();
    expect(read.structuredContent).toMatchObject({ source: 'html', next_offset: null });
    expect((read.content as { text: string }[])[0].text).toMatch(/^\[UNTRUSTED EXTERNAL CONTENT/);

    const graph = await c.client.callTool({ name: 'arxiv_citation_graph', arguments: { paper_id: '1706.03762' } });
    expect(graph.isError).toBeFalsy();
    expect(graph.structuredContent).toMatchObject({ status: 'success' });
  });

  it('arxiv_read_paper: source=pdf and an invalid id surface as isError results, not protocol errors', async () => {
    const bad = await c.client.callTool({ name: 'arxiv_read_paper', arguments: { paper_id: '2103.01231&x=1' } });
    expect(bad.isError).toBe(true);
    expect((bad.content as { text: string }[])[0].text).toContain('Invalid arXiv id');
  });
});
