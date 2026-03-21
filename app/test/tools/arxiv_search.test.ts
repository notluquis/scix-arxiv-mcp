import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivSearch } from '../../src/tools/arxiv_search.js';
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

    expect(result).toContain('Attention Is All You Need');
    expect(result).toContain('2103.01231');
    expect(result).toContain('An Image is Worth 16x16 Words');
    expect(result).toContain('2010.11929');
  });

  it('returns not-found message when empty', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const result = await handleArxivSearch({
      query: 'xyzzy quantum gobbledygook',
      max_results: 10,
      sort_by: 'relevance',
      sort_order: 'descending',
    });

    expect(result).toContain('No results found');
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

    expect(result).toContain('https://arxiv.org/abs/2103.01231');
  });
});
