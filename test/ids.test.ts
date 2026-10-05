import { describe, expect, it } from 'vitest';
import {
  adsIdentifierQuery, arxivIdWithVersion, bibcodeSegment, libraryIdSegment, normalizeArxivId,
} from '../src/ids.js';

describe('normalizeArxivId', () => {
  it.each([
    ['2103.01231', { base: '2103.01231' }],
    ['2103.01231v2', { base: '2103.01231', version: 'v2' }],
    ['arXiv:2103.01231v2', { base: '2103.01231', version: 'v2' }],
    ['ARXIV:2103.01231', { base: '2103.01231' }],
    ['0704.0001', { base: '0704.0001' }],
    ['1706.03762', { base: '1706.03762' }],
    ['astro-ph/0601001', { base: 'astro-ph/0601001' }],
    ['astro-ph/0601001v3', { base: 'astro-ph/0601001', version: 'v3' }],
    ['cs.LG/0612056', { base: 'cs.LG/0612056' }],
    ['https://arxiv.org/abs/2103.01231v1', { base: '2103.01231', version: 'v1' }],
    ['https://arxiv.org/pdf/2103.01231v1.pdf', { base: '2103.01231', version: 'v1' }],
    ['  2103.01231  ', { base: '2103.01231' }],
  ])('accepts %s', (input, expected) => {
    expect(normalizeArxivId(input)).toEqual(expected);
  });

  it.each([
    '2103.01231&max_results=999',
    '2103.01231,2103.01232',
    '../../etc/passwd',
    '2103.01231/../x',
    '2103.012',
    '2103.012345',
    '210.01231',
    'invalid-id',
    '',
    'astro-ph/060100',
    '2103.01231 v2',
    'https://evil.example/abs/2103.01231',
    '2103.01231?x=1',
  ])('rejects %j', (input) => {
    expect(() => normalizeArxivId(input)).toThrow('Invalid arXiv id');
  });

  it('arxivIdWithVersion re-attaches the version', () => {
    expect(arxivIdWithVersion(normalizeArxivId('2103.01231v2'))).toBe('2103.01231v2');
    expect(arxivIdWithVersion(normalizeArxivId('2103.01231'))).toBe('2103.01231');
  });
});

describe('adsIdentifierQuery', () => {
  it.each([
    ['2019ApJ...882L..24A', 'identifier:"2019ApJ...882L..24A"'],
    ['10.1093/mnras/stab1234', 'identifier:"10.1093/mnras/stab1234"'],
    ['arXiv:2103.01231v2', 'identifier:"arXiv:2103.01231v2"'],
    ['scix:ABCD-1234', 'scix_id:"scix:ABCD-1234"'],
    ['SCIX:ABCD', 'scix_id:"scix:ABCD"'],
  ])('%s', (input, expected) => {
    expect(adsIdentifierQuery(input)).toBe(expected);
  });

  it('escapes quotes and backslashes so the value cannot leave its quotes', () => {
    expect(adsIdentifierQuery('x" OR bibcode:*')).toBe('identifier:"x\\" OR bibcode:*"');
    expect(adsIdentifierQuery('a\\b')).toBe('identifier:"a\\\\b"');
  });
});

describe('libraryIdSegment', () => {
  it('accepts URL-safe base64 ids', () => {
    expect(libraryIdSegment('bMF6Lm0LT4-Qs0rUPzxKmA')).toBe('bMF6Lm0LT4-Qs0rUPzxKmA');
    expect(libraryIdSegment('abc123')).toBe('abc123');
  });

  it.each(['', '../x', 'a/b', 'a?b', '..', 'a b', 'x'.repeat(65), '%2e%2e'])('rejects %j', (v) => {
    expect(() => libraryIdSegment(v)).toThrow('Invalid library_id');
  });
});

describe('bibcodeSegment', () => {
  it('encodes a bibcode for use in a path', () => {
    expect(bibcodeSegment('2019ApJ...882L..24A')).toBe('2019ApJ...882L..24A');
    expect(bibcodeSegment('2020A&A...641A...6P')).toBe('2020A%26A...641A...6P');
  });

  it.each(['', 'a/b', 'a\\b', 'a?b', 'a#b', 'a\nb', '..', '.', '%2e%2E', 'x'.repeat(201)])('rejects %j', (v) => {
    expect(() => bibcodeSegment(v)).toThrow('Invalid bibcode');
  });
});
