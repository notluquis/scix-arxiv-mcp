import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import {
  handleScixAuthorAffiliations, handleScixAuthorPapers, handleScixCitationHelper,
  handleScixResolveObjects, handleScixResolveReferences,
} from '../../src/tools/scix_authors.js';
import { handleScixSearch } from '../../src/tools/scix.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const DOC = { bibcode: '2019ApJ...882L..24A', title: ['T'], author: ['A, B'], year: '2019', citation_count: 3 };
const METRICS = {
  indicators: { h: 5, g: 7, i10: 2, m: 0.5, tori: 1.25 },
  'citation stats': { 'total number of citations': 40, 'total number of refereed citations': 30 },
};

const bodyOf = (mock: ReturnType<typeof mockFetch>, n = 0) => JSON.parse(mock.mock.calls[n][1]?.body as string);
const urlOf = (mock: ReturnType<typeof mockFetch>, n = 0) => new URL(String(mock.mock.calls[n][0]));

beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
afterEach(restoreFetch);

const papers = (over: Record<string, unknown> = {}) => ({
  query: undefined, author: 'Hawking, S', first_author_only: false, rows: 20, include_metrics: true, ...over,
}) as Parameters<typeof handleScixAuthorPapers>[1];

describe('scix_author_papers', () => {
  it('queries author:"…" and posts metrics with the result bibcodes', async () => {
    const mock = mockFetch({ body: { response: { numFound: 1, docs: [DOC] }, ...METRICS } });
    const out = await handleScixAuthorPapers(new ScixClient(), papers());

    expect(urlOf(mock, 0).searchParams.get('q')).toBe('author:"Hawking, S"');
    expect(urlOf(mock, 0).searchParams.get('rows')).toBe('20');
    expect(urlOf(mock, 1).pathname).toMatch(/\/metrics$/);
    expect(mock.mock.calls[1][1]?.method).toBe('POST');
    expect(bodyOf(mock, 1)).toEqual({ bibcodes: ['2019ApJ...882L..24A'], types: ['basic', 'citations', 'indicators'] });
    expect(out.structured).toMatchObject({
      total: 1,
      items: [{ bibcode: '2019ApJ...882L..24A' }],
      metrics: { h: 5, g: 7, i10: 2, m: 0.5, tori: 1.25, total_citations: 40, refereed_citations: 30 },
    });
  });

  it('first_author_only=true prefixes the name with ^', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    await handleScixAuthorPapers(new ScixClient(), papers({ first_author_only: true }));
    expect(urlOf(mock).searchParams.get('q')).toBe('author:"^Hawking, S"');
  });

  it('orcid queries orcid:"…" instead of the author name', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    await handleScixAuthorPapers(new ScixClient(), papers({ author: undefined, orcid: '0000-0002-1825-0097' }));
    expect(urlOf(mock).searchParams.get('q')).toBe('orcid:"0000-0002-1825-0097"');
  });

  it('rejects a malformed orcid, orcid with first_author_only, and a missing identity', async () => {
    mockFetch({ body: {} });
    const c = new ScixClient();
    await expect(handleScixAuthorPapers(c, papers({ orcid: 'nope' }))).rejects.toThrow('Invalid ORCID');
    await expect(handleScixAuthorPapers(c, papers({ orcid: '0000-0002-1825-0097', first_author_only: true }))).rejects.toThrow('first_author_only');
    await expect(handleScixAuthorPapers(c, papers({ author: undefined }))).rejects.toThrow('author or orcid');
  });

  it('year_from and year_to become a year range; each alone is open-ended', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    const c = new ScixClient();
    await handleScixAuthorPapers(c, papers({ year_from: 2010, year_to: 2020 }));
    await handleScixAuthorPapers(c, papers({ year_from: 2010 }));
    await handleScixAuthorPapers(c, papers({ year_to: 2020 }));
    expect(urlOf(mock, 0).searchParams.get('q')).toBe('author:"Hawking, S" AND year:[2010 TO 2020]');
    expect(urlOf(mock, 1).searchParams.get('q')).toBe('author:"Hawking, S" AND year:[2010 TO *]');
    expect(urlOf(mock, 2).searchParams.get('q')).toBe('author:"Hawking, S" AND year:[* TO 2020]');
  });

  it('include_metrics=false makes no metrics call and no metrics key', async () => {
    const mock = mockFetch({ body: { response: { numFound: 1, docs: [DOC] } } });
    const out = await handleScixAuthorPapers(new ScixClient(), papers({ include_metrics: false, rows: 5 }));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(urlOf(mock).searchParams.get('rows')).toBe('5');
    expect(out.structured).not.toHaveProperty('metrics');
  });

  it('escapes quotes in the author name', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    await handleScixAuthorPapers(new ScixClient(), papers({ author: 'O"Brien' }));
    expect(urlOf(mock).searchParams.get('q')).toBe('author:"O\\"Brien"');
  });

  it('keeps the list when the metrics call fails', async () => {
    let n = 0;
    global.fetch = (async () => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify({ response: { numFound: 1, docs: [DOC] } }), { status: 200 });
      return new Response('boom', { status: 500 });
    }) as typeof fetch;
    const out = await handleScixAuthorPapers(new ScixClient(), papers());
    expect(out.isError).toBeFalsy();
    expect(out.text).toContain('Metrics unavailable');
    expect(out.structured).not.toHaveProperty('metrics');
  });
});

describe('scix_search collection', () => {
  it('sends fq=database:<collection> only when given', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    const base = { query: 'x', rows: 10, start: 0, sort: 'score desc' as const };
    await handleScixSearch(new ScixClient(), { ...base, collection: 'physics' });
    await handleScixSearch(new ScixClient(), base);
    expect(urlOf(mock, 0).searchParams.get('fq')).toBe('database:physics');
    expect(urlOf(mock, 1).searchParams.has('fq')).toBe(false);
  });
});

describe('scix_author_affiliations', () => {
  const SEARCH = {
    data: [{ authorName: 'Doe, Jane', affiliations: { name: 'MIT', years: ['2023', '2024'], lastActiveDate: '2024/05' } }],
  };
  const base = { maxauthor: 3, numyears: 4 };

  it('posts {bibcode, maxauthor, numyears} (singular bibcode) and parses rows', async () => {
    const mock = mockFetch({ body: SEARCH });
    const out = await handleScixAuthorAffiliations(new ScixClient(), { ...base, bibcodes: ['A', 'B'] });
    expect(urlOf(mock).pathname).toMatch(/author-affiliation\/search$/);
    expect(bodyOf(mock)).toEqual({ bibcode: ['A', 'B'], maxauthor: 3, numyears: 4 });
    expect(out.structured).toEqual({
      papers: 2,
      rows: [{ author: 'Doe, Jane', affiliation: 'MIT', years: ['2023', '2024'], last_active: '2024/05' }],
    });
  });

  it('passes non-default maxauthor and numyears', async () => {
    const mock = mockFetch({ body: SEARCH });
    await handleScixAuthorAffiliations(new ScixClient(), { maxauthor: 1, numyears: 10, bibcodes: ['A'] });
    expect(bodyOf(mock)).toEqual({ bibcode: ['A'], maxauthor: 1, numyears: 10 });
  });

  it('resolves a query to at most 500 bibcodes first', async () => {
    let n = 0;
    const calls: Array<[string, RequestInit | undefined]> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      n += 1;
      const body = n === 1 ? { response: { docs: [{ bibcode: 'X1' }, { bibcode: 'X2' }] } } : SEARCH;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    await handleScixAuthorAffiliations(new ScixClient(), { ...base, query: 'author:"Doe"' });
    const u = new URL(calls[0][0]);
    expect(u.searchParams.get('fl')).toBe('bibcode');
    expect(u.searchParams.get('rows')).toBe('500');
    expect(JSON.parse(calls[1][1]?.body as string).bibcode).toEqual(['X1', 'X2']);
  });

  it('requires exactly one of bibcodes or query', async () => {
    mockFetch({ body: SEARCH });
    const c = new ScixClient();
    await expect(handleScixAuthorAffiliations(c, { ...base })).rejects.toThrow('exactly one');
    await expect(handleScixAuthorAffiliations(c, { ...base, bibcodes: ['A'], query: 'x' })).rejects.toThrow('exactly one');
  });

  it.each([
    ['csv', '| Lastname, Firstname | Affiliation | Last Active Date | [csv]'],
    ['text', 'Lastname, Firstname(Affiliation)Last Active Date[text]'],
    ['browser', 'Lastname, Firstname(Affiliation)Last Active Date[browser]'],
  ] as const)('export_format=%s posts the OpenAPI enum string and the selected rows', async (fmt, enumString) => {
    let n = 0;
    const calls: Array<[string, RequestInit | undefined]> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      n += 1;
      return n === 1 ? new Response(JSON.stringify(SEARCH), { status: 200 }) : new Response('Doe, Jane,MIT,2024/05', { status: 200 });
    }) as typeof fetch;
    const out = await handleScixAuthorAffiliations(new ScixClient(), { ...base, bibcodes: ['A'], export_format: fmt });
    expect(calls[1][0]).toMatch(/author-affiliation\/export$/);
    expect(JSON.parse(calls[1][1]?.body as string)).toEqual({
      format: enumString,
      selected: ['Doe, Jane | MIT | 2024/05'],
    });
    expect(out.structured['export']).toBe('Doe, Jane,MIT,2024/05');
  });

  it('no export call without export_format', async () => {
    const mock = mockFetch({ body: SEARCH });
    const out = await handleScixAuthorAffiliations(new ScixClient(), { ...base, bibcodes: ['A'] });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(out.structured).not.toHaveProperty('export');
  });
});

describe('scix_resolve_objects', () => {
  const OBJ = { M31: { id: '1575544', canonical: 'M  31' }, Nope: null };

  it('posts {source, objects} and maps unrecognized names to null', async () => {
    const mock = mockFetch({ body: OBJ });
    const out = await handleScixResolveObjects(new ScixClient(), { names: ['M31', 'Nope'], source: 'simbad' });
    expect(urlOf(mock).pathname).toMatch(/\/objects$/);
    expect(bodyOf(mock)).toEqual({ source: 'simbad', objects: ['M31', 'Nope'] });
    expect(out.structured).toEqual({
      source: 'simbad',
      items: [{ input: 'M31', id: '1575544', canonical: 'M  31' }, { input: 'Nope', id: null, canonical: null }],
    });
  });

  it('source=ned is sent as ned', async () => {
    const mock = mockFetch({ body: OBJ });
    await handleScixResolveObjects(new ScixClient(), { names: ['M31'], source: 'ned' });
    expect(bodyOf(mock).source).toBe('ned');
  });

  it('a 200 response with an Error key is an error', async () => {
    mockFetch({ body: { Error: 'Unable to get results!', 'Error Info': 'SIMBAD timeout' } });
    await expect(handleScixResolveObjects(new ScixClient(), { names: ['M31'], source: 'simbad' }))
      .rejects.toThrow(/Unable to get results/);
  });

  it('expand_query posts objects/query {query:[object:"NAME"]} per name', async () => {
    let n = 0;
    const calls: Array<[string, RequestInit | undefined]> = [];
    global.fetch = (async (url: string, init?: RequestInit) => {
      calls.push([String(url), init]);
      n += 1;
      return new Response(JSON.stringify(n === 1 ? OBJ : { query: '((=abs:m31 OR simbid:1575544) database:astronomy)' }), { status: 200 });
    }) as typeof fetch;
    const out = await handleScixResolveObjects(new ScixClient(), { names: ['M31'], source: 'simbad', expand_query: true });
    expect(calls[1][0]).toMatch(/objects\/query$/);
    expect(JSON.parse(calls[1][1]?.body as string)).toEqual({ query: ['object:"M31"'] });
    expect(out.structured['expanded_queries']).toEqual([{ name: 'M31', query: '((=abs:m31 OR simbid:1575544) database:astronomy)' }]);
  });

  it('an Error key from objects/query is an error', async () => {
    let n = 0;
    global.fetch = (async () => {
      n += 1;
      return new Response(JSON.stringify(n === 1 ? OBJ : { Error: 'bad query' }), { status: 200 });
    }) as typeof fetch;
    await expect(handleScixResolveObjects(new ScixClient(), { names: ['M31'], source: 'simbad', expand_query: true }))
      .rejects.toThrow(/bad query/);
  });

  it('without expand_query makes a single call', async () => {
    const mock = mockFetch({ body: OBJ });
    await handleScixResolveObjects(new ScixClient(), { names: ['M31'], source: 'simbad', expand_query: false });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('scix_citation_helper', () => {
  it('posts {bibcodes} (plural) and maps suggestions', async () => {
    const mock = mockFetch({ body: [{ bibcode: 'S1', title: 'Suggested', author: 'Roe, R', score: 3 }] });
    const out = await handleScixCitationHelper(new ScixClient(), { bibcodes: ['A', 'B'] });
    expect(urlOf(mock).pathname).toMatch(/citation_helper$/);
    expect(bodyOf(mock)).toEqual({ bibcodes: ['A', 'B'] });
    expect(out.structured).toEqual({ total: 1, start: 0, items: [{ bibcode: 'S1', title: 'Suggested', author: 'Roe, R', score: 3 }] });
  });

  it('a 200 error body is an error', async () => {
    mockFetch({ body: { error: 'no bibcodes' } });
    await expect(handleScixCitationHelper(new ScixClient(), { bibcodes: ['A'] })).rejects.toThrow(/no bibcodes/);
  });
});

describe('scix_resolve_references', () => {
  it('posts {reference} and returns bibcode, score and comment (list form)', async () => {
    const mock = mockFetch({
      body: { resolved: [
        { refstring: 'Kravchenko 2020', bibcode: '2020A&A...637L...6K', score: '1.0' },
        { refstring: 'garbage', score: '0.0', comment: 'parse failed' },
      ] },
    });
    const out = await handleScixResolveReferences(new ScixClient(), { references: ['Kravchenko 2020', 'garbage'] });
    expect(urlOf(mock).pathname).toMatch(/reference\/text$/);
    expect(bodyOf(mock)).toEqual({ reference: ['Kravchenko 2020', 'garbage'] });
    expect(out.structured).toEqual({
      total: 2, start: 0,
      items: [
        { reference: 'Kravchenko 2020', bibcode: '2020A&A...637L...6K', score: 1 },
        { reference: 'garbage', score: 0, comment: 'parse failed' },
      ],
    });
  });

  it('accepts the single-object form shown in the OpenAPI spec', async () => {
    mockFetch({ body: { resolved: { refstring: 'R', bibcode: 'B', score: '0.9' } } });
    const out = await handleScixResolveReferences(new ScixClient(), { references: ['R'] });
    expect(out.structured).toMatchObject({ total: 1, items: [{ bibcode: 'B', score: 0.9 }] });
  });
});
