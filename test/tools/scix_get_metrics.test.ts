import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixGetMetrics } from '../../src/tools/scix_get_metrics.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const MOCK_METRICS = {
  indicators: { h: 15, g: 20, i10: 8, m: 1.5, tori: 3.2 },
  'citation stats': {
    'total number of citations': 300,
    'total number of refereed citations': 250,
    'average number of citations': 30.0,
    'number of self-citations': 10,
  },
  'basic stats': {
    'number of papers': 10,
    'total number of reads': 5000,
    'average number of reads': 500.0,
  },
};

describe('handleScixGetMetrics', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns formatted metrics with indices', async () => {
    mockFetch({ body: MOCK_METRICS });
    const client = new ScixClient();

    const result = await handleScixGetMetrics(client, {
      bibcodes: ['2019ApJ...882L..24A'],
    });

    expect(result).toContain('h-index:** 15');
    expect(result).toContain('g-index:** 20');
    expect(result).toContain('i10-index:** 8');
    expect(result).toContain('m-index:** 1.50');
    expect(result).toContain('tori:** 3.20');
  });

  it('shows citation stats', async () => {
    mockFetch({ body: MOCK_METRICS });
    const client = new ScixClient();

    const result = await handleScixGetMetrics(client, {
      bibcodes: ['2019ApJ...882L..24A'],
    });

    expect(result).toContain('300');
    expect(result).toContain('250');
    expect(result).toContain('Self-citations:** 10');
  });

  it('shows paper stats', async () => {
    mockFetch({ body: MOCK_METRICS });
    const client = new ScixClient();

    const result = await handleScixGetMetrics(client, { bibcodes: ['A', 'B'] });

    expect(result).toContain('Total papers:** 10');
    expect(result).toContain('Total reads:** 5000');
  });

  it('POSTs bibcodes in request body', async () => {
    const mock = mockFetch({ body: MOCK_METRICS });
    const client = new ScixClient();

    await handleScixGetMetrics(client, { bibcodes: ['A', 'B', 'C'] });

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.bibcodes).toEqual(['A', 'B', 'C']);
  });
});
