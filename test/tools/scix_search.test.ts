import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixSearch } from '../../src/tools/scix_search.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const MOCK_DOC = {
  bibcode: '2024ApJ...123..456A',
  title: ['Black Holes and Galaxy Formation'],
  author: ['Author, A.', 'Author, B.', 'Author, C.', 'Author, D.'],
  year: '2024',
  citation_count: 42,
};

describe('handleScixSearch', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns markdown list with results', async () => {
    mockFetch({ body: { response: { numFound: 1, docs: [MOCK_DOC] } } });
    const client = new ScixClient();

    const result = await handleScixSearch(client, {
      query: 'black holes',
      rows: 10,
      start: 0,
      sort: 'score desc',
    });

    expect(result).toContain('Black Holes and Galaxy Formation');
    expect(result).toContain('2024ApJ...123..456A');
    expect(result).toContain('42');
    expect(result).toContain('Author, A.');  // list shows first author only
  });

  it('shows pagination hint when more results exist', async () => {
    mockFetch({ body: { response: { numFound: 100, docs: [MOCK_DOC] } } });
    const client = new ScixClient();

    const result = await handleScixSearch(client, {
      query: 'stars',
      rows: 10,
      start: 0,
      sort: 'score desc',
    });

    expect(result).toContain('start=10');
  });

  it('no pagination hint when all results shown', async () => {
    mockFetch({ body: { response: { numFound: 1, docs: [MOCK_DOC] } } });
    const client = new ScixClient();

    const result = await handleScixSearch(client, {
      query: 'stars',
      rows: 10,
      start: 0,
      sort: 'score desc',
    });

    expect(result).not.toContain('start=');
  });

  it('returns total count in heading', async () => {
    mockFetch({ body: { response: { numFound: 500, docs: [MOCK_DOC] } } });
    const client = new ScixClient();

    const result = await handleScixSearch(client, {
      query: 'quasars',
      rows: 1,
      start: 0,
      sort: 'citation_count desc',
    });

    expect(result).toContain('500');
  });
});
