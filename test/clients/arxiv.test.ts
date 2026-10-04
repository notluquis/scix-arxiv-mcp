import { describe, it, expect, afterEach } from 'vitest';
import { arxivSearch, arxivGetPaper, arxivReadPaper } from '../../src/clients/arxiv.js';
import { mockFetch, mockFetchError, restoreFetch } from '../helpers/mockFetch.js';
import { makeAtomFeed, PAPER_1, PAPER_2 } from '../helpers/arxivFixtures.js';

describe('arxivSearch', () => {
  afterEach(restoreFetch);

  it('returns parsed papers from Atom feed', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1, PAPER_2]) });

    const results = await arxivSearch('transformer attention', { maxResults: 2 });

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('2103.01231');
    expect(results[0].title).toBe('Attention Is All You Need');
    expect(results[0].authors).toEqual(['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.']);
    expect(results[0].categories).toEqual(['cs.CL', 'cs.LG']);
    expect(results[0].absUrl).toBe('https://arxiv.org/abs/2103.01231');
    expect(results[0].pdfUrl).toBe('https://arxiv.org/pdf/2103.01231');
  });

  it('parses DOI when present', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_2]) });

    const results = await arxivSearch('ViT', { maxResults: 1 });

    expect(results[0].doi).toBe('10.1000/test.doi');
  });

  it('returns empty array on empty feed', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const results = await arxivSearch('nothing');

    expect(results).toHaveLength(0);
  });

  it('includes correct query params', async () => {
    const mock = mockFetch({ text: makeAtomFeed([]) });

    await arxivSearch('ti:transformers', { maxResults: 5, sortBy: 'submittedDate', sortOrder: 'ascending' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('search_query=ti%3Atransformers');
    expect(url).toContain('max_results=5');
    expect(url).toContain('sortBy=submittedDate');
    expect(url).toContain('sortOrder=ascending');
  });

  it('throws on network error', async () => {
    mockFetchError();

    await expect(arxivSearch('test')).rejects.toThrow('Network error');
  });

  it('throws on non-2xx status', async () => {
    mockFetch({ status: 503 });

    await expect(arxivSearch('test')).rejects.toThrow('503');
  });
});

describe('arxivGetPaper', () => {
  afterEach(restoreFetch);

  it('returns paper by ID', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1]) });

    const paper = await arxivGetPaper('2103.01231');

    expect(paper).not.toBeNull();
    expect(paper!.id).toBe('2103.01231');
    expect(paper!.abstract).toContain('sequence transduction');
  });

  it('strips version suffix before lookup', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await arxivGetPaper('2103.01231v3');

    const [url] = mock.mock.calls[0];
    expect(url).toContain('id_list=2103.01231');
    expect(url).not.toContain('v3');
  });

  it('returns null on empty feed', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const paper = await arxivGetPaper('9999.00000');

    expect(paper).toBeNull();
  });

  it('accepts an arXiv: prefix, a URL and an old-style id', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await arxivGetPaper('arXiv:2103.01231v2');
    await arxivGetPaper('https://arxiv.org/abs/2103.01231');
    await arxivGetPaper('astro-ph/0601001');

    const urls = mock.mock.calls.map(c => String(c[0]));
    expect(urls[0]).toContain('id_list=2103.01231&');
    expect(urls[1]).toContain('id_list=2103.01231&');
    expect(urls[2]).toContain('id_list=astro-ph/0601001&');
  });

  it('rejects an id that would inject extra query parameters, without any request', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await expect(arxivGetPaper('2103.01231&max_results=999')).rejects.toThrow('Invalid arXiv id');
    await expect(arxivReadPaper('2103.01231/../../x')).rejects.toThrow('Invalid arXiv id');

    expect(mock).not.toHaveBeenCalled();
  });
});
