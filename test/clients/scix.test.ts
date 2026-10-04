import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScixClient } from '../../src/clients/scix.js';
import { mockFetch, mockFetchError, restoreFetch } from '../helpers/mockFetch.js';

const ENV_KEY = 'SCIX_API_TOKEN';

describe('ScixClient', () => {
  const savedToken = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = 'test-token';
  });

  afterEach(() => {
    restoreFetch();
    process.env[ENV_KEY] = savedToken;
  });

  it('throws if SCIX_API_TOKEN is not set', () => {
    delete process.env[ENV_KEY];
    expect(() => new ScixClient()).toThrow('SCIX_API_TOKEN');
  });

  it('GET: sends Authorization header and returns JSON', async () => {
    const payload = { response: { docs: [] } };
    const mock = mockFetch({ body: payload });
    const client = new ScixClient();

    const result = await client.get('search/query', { q: 'black holes' });

    expect(result).toEqual(payload);
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('search/query');
    expect(url).toContain('q=black+holes');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });

  it('GET: skips null/undefined params', async () => {
    const mock = mockFetch({ body: {} });
    const client = new ScixClient();

    await client.get('search/query', { q: 'test', fl: undefined, rows: null as unknown as undefined });

    const [url] = mock.mock.calls[0];
    expect(url).not.toContain('fl=');
    expect(url).not.toContain('rows=');
  });

  it('GET: throws on non-2xx status', async () => {
    mockFetch({ status: 401, body: 'Unauthorized' });
    const client = new ScixClient();

    await expect(client.get('search/query')).rejects.toThrow('401');
  });

  it('POST: sends body as JSON and returns response', async () => {
    const payload = { indicators: { h: 10 } };
    const mock = mockFetch({ body: payload });
    const client = new ScixClient();

    const result = await client.post('metrics', { bibcodes: ['2024ApJ...1A'] });

    expect(result).toEqual(payload);
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain('metrics');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ bibcodes: ['2024ApJ...1A'] });
  });

  it('throws on network error', async () => {
    mockFetchError('Connection refused');
    const client = new ScixClient();

    await expect(client.get('search/query')).rejects.toThrow('Connection refused');
  });

  it('POST 503 is not retried by default (mutations are not idempotent)', async () => {
    const mock = mockFetch({ status: 503, text: 'busy' });
    await expect(new ScixClient().post('biblib/libraries', { name: 'x' })).rejects.toThrow('503');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('POST 503 is retried when the caller marks it idempotent', async () => {
    const mock = mockFetch({ status: 503, text: 'busy' });
    await expect(new ScixClient().post('search/bigquery', {}, { idempotent: true })).rejects.toThrow('503');
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('GET 503 is retried', async () => {
    const mock = mockFetch({ status: 503, text: 'busy' });
    await expect(new ScixClient().get('search/query')).rejects.toThrow('503');
    expect(mock).toHaveBeenCalledTimes(4);
  });
});
