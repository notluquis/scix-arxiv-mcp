import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixGetCitations } from '../../src/tools/scix.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const MOCK_DOCS = [
  { bibcode: '2020ApJ...111A', title: ['Paper A'], author: ['Smith, J.'], year: '2020', citation_count: 5 },
  { bibcode: '2021ApJ...222B', title: ['Paper B'], author: ['Jones, K.'], year: '2021', citation_count: 2 },
];

describe('handleScixGetCitations', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('queries citations() for relationship=citations', async () => {
    const mock = mockFetch({ body: { response: { numFound: 2, docs: MOCK_DOCS } } });
    const client = new ScixClient();

    await handleScixGetCitations(client, {
      bibcode: '2019ApJ...882L..24A',
      rows: 20,
      relationship: 'citations',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('citations%28identifier%3A%222019ApJ');
  });

  it('queries references() for relationship=references', async () => {
    const mock = mockFetch({ body: { response: { numFound: 2, docs: MOCK_DOCS } } });
    const client = new ScixClient();

    await handleScixGetCitations(client, {
      bibcode: '2019ApJ...882L..24A',
      rows: 20,
      relationship: 'references',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('references%28identifier%3A%222019ApJ');
  });

  it('returns formatted list with papers', async () => {
    mockFetch({ body: { response: { numFound: 2, docs: MOCK_DOCS } } });
    const client = new ScixClient();

    const result = await handleScixGetCitations(client, {
      bibcode: '2019ApJ...882L..24A',
      rows: 20,
      relationship: 'citations',
    });

    expect(result.text).toContain('Paper A');
    expect(result.text).toContain('Paper B');
    expect(result.text).toContain('2020ApJ');
  });

  it('includes label distinguishing citations from references', async () => {
    mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    const client = new ScixClient();

    const citResult = await handleScixGetCitations(client, {
      bibcode: 'X', rows: 10, relationship: 'citations',
    });
    const refResult = await handleScixGetCitations(client, {
      bibcode: 'X', rows: 10, relationship: 'references',
    });

    expect(citResult.text).toContain('citing');
    expect(refResult.text).toContain('References');
  });

  it('queries citations() with an arXiv id or DOI as a quoted identifier', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });
    const client = new ScixClient();

    await handleScixGetCitations(client, { bibcode: '10.1093/mnras/stab1234', rows: 5, relationship: 'citations' });

    expect(new URL(mock.mock.calls[0][0]).searchParams.get('q')).toBe('citations(identifier:"10.1093/mnras/stab1234")');
  });

  it('returns structured items', async () => {
    mockFetch({ body: { response: { numFound: 2, docs: MOCK_DOCS } } });

    const result = await handleScixGetCitations(new ScixClient(), { bibcode: 'X', rows: 20, relationship: 'citations' });

    expect(result.structured).toMatchObject({
      total: 2,
      start: 0,
      items: [{ bibcode: '2020ApJ...111A', title: 'Paper A', authors: ['Smith, J.'], year: '2020', citation_count: 5 }, {}],
    });
  });
});
