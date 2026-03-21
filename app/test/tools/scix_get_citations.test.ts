import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixGetCitations } from '../../src/tools/scix_get_citations.js';
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
    expect(url).toContain('citations%282019ApJ');
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
    expect(url).toContain('references%282019ApJ');
  });

  it('returns formatted list with papers', async () => {
    mockFetch({ body: { response: { numFound: 2, docs: MOCK_DOCS } } });
    const client = new ScixClient();

    const result = await handleScixGetCitations(client, {
      bibcode: '2019ApJ...882L..24A',
      rows: 20,
      relationship: 'citations',
    });

    expect(result).toContain('Paper A');
    expect(result).toContain('Paper B');
    expect(result).toContain('2020ApJ');
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

    expect(citResult).toContain('citing');
    expect(refResult).toContain('References');
  });
});
