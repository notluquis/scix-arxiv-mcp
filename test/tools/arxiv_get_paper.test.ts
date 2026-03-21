import { describe, it, expect, afterEach } from 'vitest';
import { handleArxivGetPaper } from '../../src/tools/arxiv_get_paper.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { makeAtomFeed, PAPER_1, PAPER_2 } from '../helpers/arxivFixtures.js';

describe('handleArxivGetPaper', () => {
  afterEach(restoreFetch);

  it('returns formatted paper with abstract', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_1]) });

    const result = await handleArxivGetPaper({ paper_id: '2103.01231' });

    expect(result).toContain('Attention Is All You Need');
    expect(result).toContain('Vaswani, A.');
    expect(result).toContain('2103.01231');
    expect(result).toContain('cs.CL');
    expect(result).toContain('sequence transduction');
    expect(result).toContain('https://arxiv.org/pdf/2103.01231');
    expect(result).toContain('https://arxiv.org/html/2103.01231');
  });

  it('includes DOI when present', async () => {
    mockFetch({ text: makeAtomFeed([PAPER_2]) });

    const result = await handleArxivGetPaper({ paper_id: '2010.11929' });

    expect(result).toContain('10.1000/test.doi');
  });

  it('returns not-found message on empty feed', async () => {
    mockFetch({ text: makeAtomFeed([]) });

    const result = await handleArxivGetPaper({ paper_id: '9999.00000' });

    expect(result).toContain('No paper found');
    expect(result).toContain('9999.00000');
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

    expect(result).toContain('et al.');
    expect(result).not.toContain('D, Four');
  });
});
