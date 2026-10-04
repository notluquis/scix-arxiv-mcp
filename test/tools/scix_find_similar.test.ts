import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixFindSimilar } from '../../src/tools/scix.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const DOC = { bibcode: '2020ApJ...111A', title: ['Similar Paper'], author: ['Smith, J.'], year: '2020', citation_count: 5 };

describe('handleScixFindSimilar', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('queries similar() with a quoted identifier and lists the results', async () => {
    const mock = mockFetch({ body: { response: { numFound: 1, docs: [DOC] } } });

    const result = await handleScixFindSimilar(new ScixClient(), { bibcode: '2019ApJ...882L..24A', rows: 10 });

    const q = new URL(mock.mock.calls[0][0]).searchParams.get('q');
    expect(q).toBe('similar(identifier:"2019ApJ...882L..24A")');
    expect(result.text).toContain('Similar Paper');
    expect(result.text).toContain('Papers Similar to 2019ApJ...882L..24A');
    expect(result.structured).toMatchObject({ total: 1, start: 0 });
  });

  it('accepts an identifier longer than a bibcode', async () => {
    const mock = mockFetch({ body: { response: { numFound: 0, docs: [] } } });

    await handleScixFindSimilar(new ScixClient(), { bibcode: '10.1093/mnras/stab1234', rows: 5 });

    expect(new URL(mock.mock.calls[0][0]).searchParams.get('q')).toBe('similar(identifier:"10.1093/mnras/stab1234")');
  });

  it('says so when nothing similar is found', async () => {
    mockFetch({ body: { response: { numFound: 0, docs: [] } } });

    const result = await handleScixFindSimilar(new ScixClient(), { bibcode: 'X', rows: 10 });

    expect(result.text).toContain('No similar papers found for: X');
    expect(result.structured).toEqual({ total: 0, start: 0, items: [] });
  });
});
