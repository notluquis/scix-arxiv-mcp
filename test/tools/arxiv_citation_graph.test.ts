import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivCitationGraph } from '../../src/tools/arxiv.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

describe('handleArxivCitationGraph', () => {
  afterEach(restoreFetch);

  it('returns citations and references from Semantic Scholar', async () => {
    const mock = mockFetch({
      body: {
        paperId: 's2-main',
        title: 'Attention Is All You Need',
        year: 2017,
        authors: [{ name: 'Vaswani, A.' }],
        externalIds: { ArXiv: '1706.03762' },
        citations: [{
          paperId: 's2-citing',
          title: 'A citing paper',
          year: 2020,
          authors: [{ name: 'Doe, J.' }],
          externalIds: { ArXiv: '2001.00001' },
        }],
        references: [{
          paperId: 's2-ref',
          title: 'A referenced paper',
          year: 2016,
          authors: [{ name: 'Smith, J.' }],
          externalIds: {},
        }],
      },
    });

    const result = await handleArxivCitationGraph({ paper_id: '1706.03762v7' });

    expect(result.text).toContain('Citation Graph for arXiv:1706.03762');
    expect(result.text).toContain('A citing paper');
    expect(result.text).toContain('A referenced paper');

    const [url] = mock.mock.calls[0];
    expect(url).toContain('api.semanticscholar.org');
    expect(url).toContain('ARXIV%3A1706.03762');
  });

  it('returns structured content for outputSchema-backed MCP responses', async () => {
    mockFetch({
      body: {
        paperId: 's2-main',
        title: 'Attention Is All You Need',
        year: 2017,
        authors: [{ name: 'Vaswani, A.' }],
        externalIds: { ArXiv: '1706.03762' },
        citations: [],
        references: [],
      },
    });

    const result = await handleArxivCitationGraph({ paper_id: '1706.03762' });

    expect(result.structured.status).toBe('success');
    expect(result.structured.paper_id).toBe('1706.03762');
    expect(result.structured.paper?.authors).toEqual(['Vaswani, A.']);
    expect(result.structured.citation_count).toBe(0);
  });

  it('returns a readable error when Semantic Scholar fails', async () => {
    mockFetch({ status: 404, text: 'not found' });

    const result = await handleArxivCitationGraph({ paper_id: '9999.99999' });

    expect(result.text).toContain('Could not retrieve citation graph');
    expect(result.text).toContain('404');
    expect(result.isError).toBe(true);
    expect(result.structured.status).toBe('error');
  });

  it('rejects a malformed id before any request is made', async () => {
    const mock = mockFetch({ body: {} });

    await expect(handleArxivCitationGraph({ paper_id: '1706.03762&fields=x' })).rejects.toThrow('Invalid arXiv id');

    expect(mock).not.toHaveBeenCalled();
  });
});
