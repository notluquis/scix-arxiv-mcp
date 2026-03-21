import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixGetPaper } from '../../src/tools/scix_get_paper.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

const MOCK_PAPER = {
  bibcode: '2019ApJ...882L..24A',
  title: ['First Image of a Black Hole'],
  author: ['Event Horizon Telescope Collaboration'],
  year: '2019',
  pub: 'The Astrophysical Journal Letters',
  citation_count: 1500,
  read_count: 50000,
  doi: ['10.3847/2041-8213/ab0ec7'],
  arxiv_id: '1906.11238',
  abstract: 'We present the first image of a black hole...',
};

describe('handleScixGetPaper', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns formatted paper markdown', async () => {
    mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const client = new ScixClient();

    const result = await handleScixGetPaper(client, { bibcode: '2019ApJ...882L..24A' });

    expect(result).toContain('First Image of a Black Hole');
    expect(result).toContain('Event Horizon Telescope Collaboration');
    expect(result).toContain('2019ApJ...882L..24A');
    expect(result).toContain('1500');
    expect(result).toContain('10.3847/2041-8213/ab0ec7');
    expect(result).toContain('1906.11238');
    expect(result).toContain('We present the first image');
  });

  it('returns not-found message when docs is empty', async () => {
    mockFetch({ body: { response: { docs: [] } } });
    const client = new ScixClient();

    const result = await handleScixGetPaper(client, { bibcode: 'nonexistent' });

    expect(result).toContain('No paper found');
    expect(result).toContain('nonexistent');
  });

  it('queries by identifier field', async () => {
    const mock = mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const client = new ScixClient();

    await handleScixGetPaper(client, { bibcode: '2019ApJ...882L..24A' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('identifier%3A2019ApJ');
  });
});
