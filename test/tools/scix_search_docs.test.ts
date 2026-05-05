import { describe, it, expect } from 'vitest';
import { handleScixSearchDocs } from '../../src/tools/scix_search_docs.js';

describe('handleScixSearchDocs', () => {
  it('returns matching docs for search syntax queries', async () => {
    const result = await handleScixSearchDocs({ query: 'search syntax', limit: 3 });

    expect(result).toContain('SciX Docs Search Results');
    expect(result).toContain('Search Syntax');
    expect(result).toContain('Source:');
  });

  it('returns a no-results message when the query is empty-ish', async () => {
    const result = await handleScixSearchDocs({ query: '   ', limit: 3 });

    expect(result).toContain('No SciX docs found');
  });
});
