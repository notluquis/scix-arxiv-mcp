import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivSearch } from '../../src/tools/arxiv_search.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';

describe('arxiv_search date and category filters', () => {
  afterEach(restoreFetch);

  it('appends date range to query when date_from provided', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await handleArxivSearch({
      query: 'transformers',
      max_results: 5,
      sort_by: 'relevance',
      sort_order: 'descending',
      date_from: '2022-01',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('submittedDate');
    expect(url).toContain('202201');
  });

  it('appends both date_from and date_to as range', async () => {
    const mock = mockFetch({ text: makeAtomFeed([]) });

    await handleArxivSearch({
      query: 'attention',
      max_results: 5,
      sort_by: 'relevance',
      sort_order: 'descending',
      date_from: '2021-01',
      date_to: '2023-12',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('202101');
    expect(url).toContain('202312');
    expect(url).toContain('TO');
  });

  it('appends category filter for single category', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await handleArxivSearch({
      query: 'neural networks',
      max_results: 5,
      sort_by: 'relevance',
      sort_order: 'descending',
      categories: ['cs.LG'],
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('cat%3Acs.LG');
  });

  it('ORs multiple categories', async () => {
    const mock = mockFetch({ text: makeAtomFeed([]) });

    await handleArxivSearch({
      query: 'diffusion',
      max_results: 5,
      sort_by: 'relevance',
      sort_order: 'descending',
      categories: ['cs.CV', 'cs.LG'],
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('cs.CV');
    expect(url).toContain('cs.LG');
    expect(url).toContain('OR');
  });

  it('works with no optional filters (backward compat)', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await handleArxivSearch({
      query: 'language models',
      max_results: 10,
      sort_by: 'relevance',
      sort_order: 'descending',
    });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('language');
    expect(url).not.toContain('submittedDate');
    expect(url).not.toContain('cat');
  });
});
