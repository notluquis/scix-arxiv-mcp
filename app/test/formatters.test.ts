import { describe, it, expect } from 'vitest';
import { formatScixPaper, formatScixList, formatArxivPaper, formatArxivList } from '../src/formatters.js';
import type { ArxivPaper } from '../src/clients/arxiv.js';

const SCIX_PAPER = {
  bibcode: '2019ApJ...882L..24A',
  title: ['First Image of a Black Hole'],
  author: ['Collaboration, E.', 'Smith, J.'],
  year: '2019',
  pub: 'ApJL',
  citation_count: 1500,
  read_count: 50000,
  doi: ['10.3847/2041-8213/ab0ec7'],
  arxiv_id: '1906.11238',
  abstract: 'We present the first image of a black hole.',
};

const ARXIV_PAPER: ArxivPaper = {
  id: '2103.01231',
  title: 'Attention Is All You Need',
  authors: ['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.'],
  abstract: 'The dominant sequence transduction models are based on complex RNNs.',
  published: '2017-06-12T00:00:00Z',
  updated: '2017-06-12T00:00:00Z',
  categories: ['cs.CL', 'cs.LG'],
  pdfUrl: 'https://arxiv.org/pdf/2103.01231',
  htmlUrl: 'https://arxiv.org/html/2103.01231',
  absUrl: 'https://arxiv.org/abs/2103.01231',
};

describe('formatScixPaper', () => {
  it('renders title as H1', () => {
    expect(formatScixPaper(SCIX_PAPER)).toMatch(/^# First Image/);
  });

  it('includes bibcode, year, pub, citations, reads', () => {
    const md = formatScixPaper(SCIX_PAPER);
    expect(md).toContain('2019ApJ...882L..24A');
    expect(md).toContain('2019');
    expect(md).toContain('ApJL');
    expect(md).toContain('1500');
    expect(md).toContain('50000');
  });

  it('includes DOI link', () => {
    expect(formatScixPaper(SCIX_PAPER)).toContain('doi.org/10.3847');
  });

  it('includes arXiv link', () => {
    expect(formatScixPaper(SCIX_PAPER)).toContain('arxiv.org/abs/1906.11238');
  });

  it('includes SciX link', () => {
    expect(formatScixPaper(SCIX_PAPER)).toContain('scixplorer.org/abs/');
  });

  it('truncates authors beyond 3 with et al.', () => {
    const paper = { ...SCIX_PAPER, author: ['A', 'B', 'C', 'D'] };
    expect(formatScixPaper(paper)).toContain('et al.');
  });

  it('shows all authors when 3 or fewer', () => {
    const md = formatScixPaper(SCIX_PAPER);
    expect(md).toContain('Collaboration, E.');
    expect(md).toContain('Smith, J.');
    expect(md).not.toContain('et al.');
  });
});

describe('formatScixList', () => {
  const docs = [SCIX_PAPER, { ...SCIX_PAPER, bibcode: '2020ApJ...999X', citation_count: 0 }];

  it('shows total and shown counts', () => {
    const md = formatScixList(docs, 100);
    expect(md).toContain('100');
    expect(md).toContain('2');
  });

  it('uses custom heading when provided', () => {
    expect(formatScixList([], 0, 'My Heading')).toContain('My Heading');
  });

  it('numbers entries', () => {
    const md = formatScixList(docs, 2);
    expect(md).toContain('1. **');
    expect(md).toContain('2. **');
  });
});

describe('formatArxivPaper', () => {
  it('renders title as H1', () => {
    expect(formatArxivPaper(ARXIV_PAPER)).toMatch(/^# Attention/);
  });

  it('includes ID, date, categories, links', () => {
    const md = formatArxivPaper(ARXIV_PAPER);
    expect(md).toContain('2103.01231');
    expect(md).toContain('2017-06-12');
    expect(md).toContain('cs.CL');
    expect(md).toContain('https://arxiv.org/pdf/2103.01231');
    expect(md).toContain('https://arxiv.org/html/2103.01231');
  });

  it('shows abstract', () => {
    expect(formatArxivPaper(ARXIV_PAPER)).toContain('sequence transduction');
  });

  it('shows DOI when present', () => {
    const paper: ArxivPaper = { ...ARXIV_PAPER, doi: '10.1000/test' };
    expect(formatArxivPaper(paper)).toContain('doi.org/10.1000/test');
  });

  it('omits updated date when same as published', () => {
    expect(formatArxivPaper(ARXIV_PAPER)).not.toContain('Updated:');
  });

  it('shows updated date when different from published', () => {
    const paper: ArxivPaper = { ...ARXIV_PAPER, updated: '2024-01-01T00:00:00Z' };
    expect(formatArxivPaper(paper)).toContain('Updated:**');
  });
});

describe('formatArxivList', () => {
  it('shows count', () => {
    expect(formatArxivList([ARXIV_PAPER])).toContain('1');
  });

  it('numbers entries with ID and link', () => {
    const md = formatArxivList([ARXIV_PAPER]);
    expect(md).toContain('1. **Attention Is All You Need**');
    expect(md).toContain('2103.01231');
    expect(md).toContain('https://arxiv.org/abs/2103.01231');
  });

  it('truncates category list to 3', () => {
    const paper: ArxivPaper = {
      ...ARXIV_PAPER,
      categories: ['cs.CL', 'cs.LG', 'cs.CV', 'cs.AI', 'cs.NE'],
    };
    const md = formatArxivList([paper]);
    // only first 3 shown
    expect(md).toContain('cs.CL, cs.LG, cs.CV');
    expect(md).not.toContain('cs.AI');
  });
});
