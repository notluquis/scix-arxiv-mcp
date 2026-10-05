import { describe, it, expect } from 'vitest';
import { buildArxivUrl, normalizeArxivQuery } from '../../src/clients/arxiv.js';

const q = (url: string) => decodeURIComponent(url.split('search_query=')[1]!.split('&')[0]!.replace(/\+/g, ' '));

describe('arXiv query construction', () => {
  it('ANDs plain words', () => {
    expect(normalizeArxivQuery('eclipsing binary')).toBe('all:eclipsing AND all:binary');
  });

  it('keeps hyphenated words as one term and strips stray punctuation', () => {
    expect(normalizeArxivQuery('delta-Scuti stars, pulsation;')).toBe('all:delta-Scuti AND all:stars AND all:pulsation');
  });

  it('passes arXiv syntax through unchanged', () => {
    for (const s of ['ti:transformers', 'all:"eclipsing binary"', 'a AND b', 'a OR b', 'a ANDNOT b', '(a b)']) {
      expect(normalizeArxivQuery(s)).toBe(s);
    }
  });

  it('parenthesizes the user query before ANDing filters', () => {
    const url = buildArxivUrl('au:smith OR au:jones', { dateFrom: '2026-09-20', dateTo: '2026-10-03', categories: ['astro-ph.SR'] });
    expect(q(url)).toBe('(au:smith OR au:jones) AND submittedDate:[202609200000 TO 202610032359] AND (cat:astro-ph.SR)');
  });

  it('applies AND normalisation inside the parentheses', () => {
    expect(q(buildArxivUrl('eclipsing binary', { categories: ['astro-ph.SR'] })))
      .toBe('(all:eclipsing AND all:binary) AND (cat:astro-ph.SR)');
  });

  it('keeps a literal + as %2B (a bare + would be read as a space)', () => {
    const url = buildArxivUrl('ti:C++', {});
    expect(url).toContain('search_query=(ti%3AC%2B%2B)');
    expect(url).not.toContain('C++');
  });

  it('encodes spaces as +', () => {
    expect(buildArxivUrl('ti:"a b"', {})).toContain('(ti%3A%22a+b%22)');
  });

  it.each(['cs.LG', 'astro-ph.GA', 'astro-ph', 'hep-th', 'math.AG'])('accepts category %s', c => {
    expect(q(buildArxivUrl('x', { categories: [c] }))).toContain(`cat:${c}`);
  });

  it.each(['cs.LG OR all:x', 'cs.LG)', '', 'cs.', 'a.b.c', 'cs.LG"'])('rejects category %j before building the query', c => {
    expect(() => buildArxivUrl('x', { categories: ['cs.LG', c] })).toThrow(/Invalid arXiv category/);
  });
});
