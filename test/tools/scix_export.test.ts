import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { handleScixExport } from '../../src/tools/scix_export.js';
import { mockFetch, restoreFetch } from '../helpers/mockFetch.js';

describe('handleScixExport', () => {
  beforeEach(() => { process.env.SCIX_API_TOKEN = 'test'; });
  afterEach(restoreFetch);

  it('returns bibtex string from API', async () => {
    const bibtex = '@article{key, title={Test}, author={Doe, J.}}';
    mockFetch({ body: { export: bibtex } });
    const client = new ScixClient();

    const result = await handleScixExport(client, {
      bibcodes: ['2024ApJ...123A'],
      format: 'bibtex',
    });

    expect(result).toBe(bibtex);
  });

  it('POSTs to export/{format} endpoint', async () => {
    const mock = mockFetch({ body: { export: '' } });
    const client = new ScixClient();

    await handleScixExport(client, { bibcodes: ['A', 'B'], format: 'ris' });

    const [url] = mock.mock.calls[0];
    expect(url).toContain('export/ris');
  });

  it('sends bibcodes in request body', async () => {
    const mock = mockFetch({ body: { export: '' } });
    const client = new ScixClient();

    await handleScixExport(client, { bibcodes: ['X', 'Y', 'Z'], format: 'endnote' });

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.bibcode).toEqual(['X', 'Y', 'Z']);
  });

  it('includes optional sort and maxauthor', async () => {
    const mock = mockFetch({ body: { export: '' } });
    const client = new ScixClient();

    await handleScixExport(client, {
      bibcodes: ['A'],
      format: 'bibtex',
      sort: 'date desc',
      maxauthor: 5,
    });

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.sort).toEqual(['date desc']);
    expect(body.maxauthor).toEqual([5]);
  });

  it('includes upstream optional export parameters', async () => {
    const mock = mockFetch({ body: { export: '' } });
    const client = new ScixClient();

    await handleScixExport(client, {
      bibcodes: ['A'],
      format: 'bibtex',
      authorcutoff: 10,
      journalformat: 3,
      keyformat: '%R',
    });

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.authorcutoff).toEqual([10]);
    expect(body.journalformat).toEqual([3]);
    expect(body.keyformat).toEqual(['%R']);
  });

  it('returns empty string when API returns no export field', async () => {
    mockFetch({ body: {} });
    const client = new ScixClient();

    const result = await handleScixExport(client, { bibcodes: ['A'], format: 'bibtex' });

    expect(result).toBe('');
  });
});
