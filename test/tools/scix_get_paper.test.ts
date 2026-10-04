import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixGetPaper } from '../../src/tools/scix.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { connect } from '../helpers/harness.js';

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

    expect(result.text).toContain('First Image of a Black Hole');
    expect(result.text).toContain('Event Horizon Telescope Collaboration');
    expect(result.text).toContain('2019ApJ...882L..24A');
    expect(result.text).toContain('1500');
    expect(result.text).toContain('10.3847/2041-8213/ab0ec7');
    expect(result.text).toContain('1906.11238');
    expect(result.text).toContain('We present the first image');
  });

  it('returns not-found message when docs is empty', async () => {
    mockFetch({ body: { response: { docs: [] } } });
    const client = new ScixClient();

    const result = await handleScixGetPaper(client, { bibcode: 'nonexistent' });

    expect(result.text).toContain('No paper found');
    expect(result.text).toContain('nonexistent');
  });

  it('queries by identifier field', async () => {
    const mock = mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const client = new ScixClient();

    await handleScixGetPaper(client, { bibcode: '2019ApJ...882L..24A' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('identifier%3A%222019ApJ');
  });

  it('looks up a DOI longer than a bibcode (no 19-char cap) with a quoted identifier', async () => {
    const mock = mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const client = new ScixClient();
    const doi = '10.1093/mnras/stab1234';
    expect(doi.length).toBeGreaterThan(19);

    await handleScixGetPaper(client, { bibcode: doi });

    const q = new URL(mock.mock.calls[0][0]).searchParams.get('q');
    expect(q).toBe('identifier:"10.1093/mnras/stab1234"');
  });

  it('escapes quotes so an identifier cannot inject extra Solr clauses', async () => {
    const mock = mockFetch({ body: { response: { docs: [] } } });
    const client = new ScixClient();

    await handleScixGetPaper(client, { bibcode: 'x" OR bibcode:*' });

    const q = new URL(mock.mock.calls[0][0]).searchParams.get('q');
    expect(q).toBe('identifier:"x\\" OR bibcode:*"');
  });

  it('maps scix: ids to scix_id', async () => {
    const mock = mockFetch({ body: { response: { docs: [] } } });
    const client = new ScixClient();

    await handleScixGetPaper(client, { bibcode: 'scix:ABCD-1234' });

    expect(new URL(mock.mock.calls[0][0]).searchParams.get('q')).toBe('scix_id:"scix:ABCD-1234"');
  });

  it('returns the paper record as structured output and not-found as an error', async () => {
    mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const found = await handleScixGetPaper(new ScixClient(), { bibcode: '2019ApJ...882L..24A' });
    expect(found.structured).toMatchObject({
      bibcode: '2019ApJ...882L..24A', title: 'First Image of a Black Hole', year: '2019',
      doi: '10.3847/2041-8213/ab0ec7', arxiv_id: '1906.11238', citation_count: 1500,
    });

    mockFetch({ body: { response: { docs: [] } } });
    const missing = await handleScixGetPaper(new ScixClient(), { bibcode: 'nope' });
    expect(missing.isError).toBe(true);
  });
});

describe('scix_get_paper through the MCP protocol', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('accepts a DOI longer than 19 characters (input schema has no bibcode-length cap)', async () => {
    const mock = mockFetch({ body: { response: { docs: [MOCK_PAPER] } } });
    const c = await connect();
    try {
      // connect() must come first: mockFetch replaces global.fetch, the harness passes its own fetch.
      const res = await c.client.callTool({
        name: 'scix_get_paper',
        arguments: { bibcode: '10.1093/mnras/stab1234' },
      });
      expect(res.isError).toBe(false);
      expect(String(mock.mock.calls[0][0])).toContain('identifier%3A%2210.1093%2Fmnras%2Fstab1234%22');
    } finally {
      await c.close();
    }
  });
});
