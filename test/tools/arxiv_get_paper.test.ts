import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivGetPaper } from '../../src/tools/arxiv.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { makeAtomFeed, PAPER_1, PAPER_2 } from '../helpers/arxivFixtures.js';

describe('handleArxivGetPaper', () => {
  afterEach(restoreFetch);

  it('returns formatted paper with abstract', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1]) });

    const result = await handleArxivGetPaper({ paper_id: '2103.01231' });

    expect(result.text).toContain('Attention Is All You Need');
    expect(result.text).toContain('Vaswani, A.');
    expect(result.text).toContain('2103.01231');
    expect(result.text).toContain('cs.CL');
    expect(result.text).toContain('sequence transduction');
    expect(result.text).toContain('https://arxiv.org/pdf/2103.01231');
    expect(result.text).toContain('https://arxiv.org/html/2103.01231');
  });

  it('includes DOI when present', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_2]) });

    const result = await handleArxivGetPaper({ paper_id: '2010.11929' });

    expect(result.text).toContain('10.1000/test.doi');
  });

  it('returns not-found message on empty feed', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const result = await handleArxivGetPaper({ paper_id: '9999.00000' });

    expect(result.text).toContain('No paper found');
    expect(result.text).toContain('9999.00000');
  });

  it('strips version suffix when querying', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await handleArxivGetPaper({ paper_id: '2103.01231v2' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('2103.01231');
    expect(url).not.toContain('v2');
  });

  it('truncates author list beyond 3 with et al.', async () => {
    const paper = {
      ...PAPER_1,
      authors: ['A, One', 'B, Two', 'C, Three', 'D, Four', 'E, Five'],
    };
    mockFetch({ text: makeAtomFeed([paper]) });

    const result = await handleArxivGetPaper({ paper_id: '2103.01231' });

    expect(result.text).toContain('et al.');
    expect(result.text).not.toContain('D, Four');
  });

  it('returns the paper record as structured output; not-found is an error', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_2]) });
    const found = await handleArxivGetPaper({ paper_id: '2010.11929' });
    expect(found.structured).toMatchObject({
      arxiv_id: '2010.11929', title: 'An Image is Worth 16x16 Words', doi: '10.1000/test.doi',
      abs_url: 'https://arxiv.org/abs/2010.11929', pdf_url: 'https://arxiv.org/pdf/2010.11929',
    });

    mockFetch({ text: makeAtomFeed([]) });
    const missing = await handleArxivGetPaper({ paper_id: '9999.00000' });
    expect(missing.isError).toBe(true);
  });

  it('rejects an id with injected parameters', async () => {
    const mock = mockFetch({ text: makeAtomFeed([PAPER_1]) });

    await expect(handleArxivGetPaper({ paper_id: '2103.01231&max_results=999' })).rejects.toThrow('Invalid arXiv id');
    expect(mock).not.toHaveBeenCalled();
  });
});
