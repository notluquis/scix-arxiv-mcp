import { describe, it, expect } from 'vitest';
import { handleScixSearchDocs } from '../../src/tools/scix.js';

describe('handleScixSearchDocs', () => {
  it('returns matching docs for search syntax queries', async () => {
    const result = await handleScixSearchDocs({ query: 'search syntax', limit: 3 });

    expect(result.text).toContain('SciX Docs Search Results');
    expect(result.text).toContain('Search Syntax');
    expect(result.text).toContain('Source:');
  });

  it('returns a no-results message when the query is empty-ish', async () => {
    const result = await handleScixSearchDocs({ query: '   ', limit: 3 });

    expect(result.text).toContain('No SciX docs found');
  });

  it('returns structured items', async () => {
    const result = await handleScixSearchDocs({ query: 'search syntax', limit: 3 });

    expect(result.structured['total']).toBeGreaterThan(0);
    expect((result.structured['items'] as { source_url: string }[])[0].source_url).toMatch(/^https?:\/\//);
  });
});
