/** Minimal valid arXiv Atom feed with one entry. */
export function makeAtomFeed(papers: {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published?: string;
  updated?: string;
  categories?: string[];
  doi?: string;
}[]): string {
  const entries = papers.map(p => {
    const authorTags = p.authors.map(a => `<author><name>${a}</name></author>`).join('\n');
    const categoryTags = (p.categories ?? ['cs.LG']).map(
      c => `<category term="${c}" scheme="http://arxiv.org/schemas/atom"/>`
    ).join('\n');
    const doiTag = p.doi
      ? `<link title="doi" href="https://dx.doi.org/${p.doi}" rel="related"/>`
      : '';
    return `
<entry>
  <id>http://arxiv.org/abs/${p.id}v1</id>
  <title>${p.title}</title>
  ${authorTags}
  <summary>${p.abstract}</summary>
  <published>${p.published ?? '2024-01-15T00:00:00Z'}</published>
  <updated>${p.updated ?? '2024-01-15T00:00:00Z'}</updated>
  ${categoryTags}
  ${doiTag}
</entry>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  ${entries}
</feed>`;
}

export const PAPER_1 = {
  id: '2103.01231',
  title: 'Attention Is All You Need',
  authors: ['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.'],
  abstract: 'The dominant sequence transduction models are based on complex RNNs.',
  published: '2017-06-12T00:00:00Z',
  categories: ['cs.CL', 'cs.LG'],
};

export const PAPER_2 = {
  id: '2010.11929',
  title: 'An Image is Worth 16x16 Words',
  authors: ['Dosovitskiy, A.', 'Beyer, L.'],
  abstract: 'While the Transformer architecture has become the de-facto standard.',
  published: '2020-10-22T00:00:00Z',
  categories: ['cs.CV'],
  doi: '10.1000/test.doi',
};
