import { describe, expect, it } from 'vitest';
import { paginate, toolResult } from '../src/content.js';

describe('paginate', () => {
  it('returns the first page and a next_offset', () => {
    expect(paginate('abcdefghij', 0, 4)).toEqual({ slice: 'abcd', offset: 0, next_offset: 4, total_chars: 10 });
  });

  it('continues from an offset and reports the end with next_offset null', () => {
    expect(paginate('abcdefghij', 8, 4)).toEqual({ slice: 'ij', offset: 8, next_offset: null, total_chars: 10 });
  });

  it('an exact fit has no next page', () => {
    expect(paginate('abcd', 0, 4).next_offset).toBeNull();
  });

  it('clamps an offset past the end', () => {
    expect(paginate('abc', 99, 4)).toEqual({ slice: '', offset: 3, next_offset: null, total_chars: 3 });
  });
});

describe('toolResult', () => {
  const out = { text: '# md', structured: { total: 1 } };

  it('markdown is the default text', () => {
    const r = toolResult(out);
    expect(r.content).toEqual([{ type: 'text', text: '# md' }]);
    expect(r.structuredContent).toEqual({ total: 1 });
  });

  it('json puts the structured result in content[0].text', () => {
    const r = toolResult({ ...out, format: 'json' });
    expect(r.content).toEqual([{ type: 'text', text: '{"total":1}' }]);
    expect(r.structuredContent).toEqual({ total: 1 });
  });

  it('an error carries no structuredContent', () => {
    const r = toolResult({ text: 'Error: x', structured: {}, isError: true, format: 'json' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toEqual([{ type: 'text', text: 'Error: x' }]);
  });
});
