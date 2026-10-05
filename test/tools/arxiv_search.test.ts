import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivSearch } from '../../src/tools/arxiv.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { makeAtomFeed, PAPER_1, PAPER_2 } from '../helpers/arxivFixtures.js';

describe('handleArxivSearch', () => {
  afterEach(restoreFetch);

  it('returns formatted list of papers', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1, PAPER_2]) });

    const result = await handleArxivSearch({
      query: 'transformer attention',
      max_results: 10,
      sort_by: 'relevance',
      sort_order: 'descending',
    });

    expect(result.text).toContain('Attention Is All You Need');
    expect(result.text).toContain('2103.01231');
    expect(result.text).toContain('An Image is Worth 16x16 Words');
    expect(result.text).toContain('2010.11929');
  });

  it('returns not-found message when empty', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const result = await handleArxivSearch({
      query: 'xyzzy quantum gobbledygook',
      max_results: 10,
      sort_by: 'relevance',
      sort_order: 'descending',
    });

    expect(result.text).toContain('No results found');
  });

  it('passes max_results to client', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await handleArxivSearch({
      query: 'test',
      max_results: 5,
      sort_by: 'submittedDate',
      sort_order: 'ascending',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('max_results=5');
    expect(url).toContain('sortBy=submittedDate');
    expect(url).toContain('sortOrder=ascending');
  });

  it('shows abstract link in output', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1]) });

    const result = await handleArxivSearch({
      query: 'attention',
      max_results: 1,
      sort_by: 'relevance',
      sort_order: 'descending',
    });

    expect(result.text).toContain('https://arxiv.org/abs/2103.01231');
  });

  it('returns structured total, start and items', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1, PAPER_2]) });

    const result = await handleArxivSearch({
      query: 'x', max_results: 10, sort_by: 'relevance', sort_order: 'descending',
    });

    expect(result.structured).toMatchObject({
      total: 2,
      start: 0,
      items: [{ arxiv_id: '2103.01231', title: 'Attention Is All You Need', categories: ['cs.CL', 'cs.LG'] }, {}],
    });
  });
});
