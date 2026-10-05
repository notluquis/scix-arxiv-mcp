import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../helpers/harness.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';

// Own file: getScixClient() caches the client, so the token must never have been set in this module graph.
describe('missing SCIX_API_TOKEN', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('is an isError result for SciX tools only; arXiv tools keep working', async () => {
    vi.stubEnv('SCIX_API_TOKEN', '');
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, headers: new Headers(), text: async () => makeAtomFeed([PAPER_1]),
    }) as Response) as typeof fetch;
    const c = await connect();
    try {
      const scix = await c.client.callTool({ name: 'scix_search', arguments: { query: 'x' } });
      expect(scix.isError).toBe(true);
      expect((scix.content as { text: string }[])[0].text).toContain('SCIX_API_TOKEN is not set');

      const arxiv = await c.client.callTool({ name: 'arxiv_search', arguments: { query: 'x' } });
      expect(arxiv.isError).toBeFalsy();
    } finally {
      await c.close();
    }
  });
});
