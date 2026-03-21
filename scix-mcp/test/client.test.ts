import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SciXAPIClient } from '../src/client.js';
import { setupMockFetch, createTimeoutFetch, restoreFetch } from './helpers/mockFetch.js';

describe('SciXAPIClient', () => {
  let client: SciXAPIClient;
  const originalEnv = process.env.SCIX_API_TOKEN;

  beforeEach(() => {
    process.env.SCIX_API_TOKEN = 'test-api-key';
    client = new SciXAPIClient();
  });

  afterEach(() => {
    restoreFetch();
    process.env.SCIX_API_TOKEN = originalEnv;
  });

  describe('GET requests', () => {
    it('should make successful GET request', async () => {
      const mockData = { results: ['data'] };
      const mockFetch = setupMockFetch({ body: mockData });

      const result = await client.get('test/endpoint');

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('test/endpoint');
      expect(init.method).toBe('GET');
      expect(init.headers['Authorization']).toBe('Bearer test-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('should encode query parameters correctly', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await client.get('search', {
        q: 'author:"Einstein"',
        rows: 10,
        start: 0
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('q=author%3A%22Einstein%22');
      expect(url).toContain('rows=10');
      expect(url).toContain('start=0');
    });

    it('should handle array parameters', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await client.get('test', {
        fields: ['title', 'author', 'year']
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('fields=title%2Cauthor%2Cyear');
    });

    it('should skip null and undefined parameters', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await client.get('test', {
        defined: 'value',
        nullValue: null,
        undefinedValue: undefined
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('defined=value');
      expect(url).not.toContain('null');
      expect(url).not.toContain('undefined');
    });

    it('should throw on 401 Unauthorized', async () => {
      setupMockFetch({ status: 401, statusText: 'Unauthorized' });

      await expect(client.get('test')).rejects.toThrow('Authentication failed');
      await expect(client.get('test')).rejects.toThrow('SCIX_API_TOKEN');
    });

    it('should throw on 404 Not Found', async () => {
      setupMockFetch({ status: 404, statusText: 'Not Found' });

      await expect(client.get('test')).rejects.toThrow('Resource not found');
    });

    it('should throw on 429 Rate Limit', async () => {
      setupMockFetch({ status: 429, statusText: 'Too Many Requests' });

      await expect(client.get('test')).rejects.toThrow('Rate limit exceeded');
      await expect(client.get('test')).rejects.toThrow('5000 requests/day');
    });

    it('should throw on generic HTTP errors', async () => {
      setupMockFetch({ status: 500, statusText: 'Internal Server Error' });

      await expect(client.get('test')).rejects.toThrow('SciX API error: 500');
    });

    it('should handle request timeout', async () => {
      global.fetch = createTimeoutFetch(100) as any;

      await expect(client.get('test')).rejects.toThrow('Request timeout after 30 seconds');
    });

    it('should handle abort signal', async () => {
      const mockFetch = setupMockFetch({ shouldAbort: true });
      global.fetch = mockFetch as any;

      await expect(client.get('test')).rejects.toThrow('Request timeout after 30 seconds');
    });
  });

  describe('POST requests', () => {
    it('should make successful POST request', async () => {
      const mockData = { success: true };
      const mockFetch = setupMockFetch({ body: mockData });

      const payload = { name: 'test', value: 123 };
      const result = await client.post('test/endpoint', payload);

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('test/endpoint');
      expect(init.method).toBe('POST');
      expect(init.headers['Authorization']).toBe('Bearer test-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('should stringify JSON body correctly', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      const complexPayload = {
        string: 'value',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: { key: 'value' }
      };

      await client.post('test', complexPayload);

      const [, init] = mockFetch.mock.calls[0];
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody).toEqual(complexPayload);
    });

    it('should throw on 401 Unauthorized', async () => {
      setupMockFetch({ status: 401 });

      await expect(client.post('test', {})).rejects.toThrow('Authentication failed');
    });

    it('should throw on 404 Not Found', async () => {
      setupMockFetch({ status: 404 });

      await expect(client.post('test', {})).rejects.toThrow('Resource not found');
    });

    it('should throw on 429 Rate Limit', async () => {
      setupMockFetch({ status: 429 });

      await expect(client.post('test', {})).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle request timeout', async () => {
      global.fetch = createTimeoutFetch(100) as any;

      await expect(client.post('test', {})).rejects.toThrow('Request timeout');
    });
  });

  describe('PUT requests', () => {
    it('should make successful PUT request', async () => {
      const mockData = { updated: true };
      const mockFetch = setupMockFetch({ body: mockData });

      const payload = { field: 'updated value' };
      const result = await client.put('test/endpoint', payload);

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('test/endpoint');
      expect(init.method).toBe('PUT');
      expect(init.headers['Authorization']).toBe('Bearer test-api-key');
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('should throw on 401 Unauthorized', async () => {
      setupMockFetch({ status: 401 });

      await expect(client.put('test', {})).rejects.toThrow('Authentication failed');
    });

    it('should throw on 404 Not Found', async () => {
      setupMockFetch({ status: 404 });

      await expect(client.put('test', {})).rejects.toThrow('Resource not found');
    });

    it('should handle request timeout', async () => {
      global.fetch = createTimeoutFetch(100) as any;

      await expect(client.put('test', {})).rejects.toThrow('Request timeout');
    });
  });

  describe('DELETE requests', () => {
    it('should make successful DELETE request', async () => {
      const mockData = { deleted: true };
      const mockFetch = setupMockFetch({ body: mockData });

      const result = await client.delete('test/endpoint');

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('test/endpoint');
      expect(init.method).toBe('DELETE');
      expect(init.headers['Authorization']).toBe('Bearer test-api-key');
    });

    it('should throw on 401 Unauthorized', async () => {
      setupMockFetch({ status: 401 });

      await expect(client.delete('test')).rejects.toThrow('Authentication failed');
    });

    it('should throw on 404 Not Found', async () => {
      setupMockFetch({ status: 404 });

      await expect(client.delete('test')).rejects.toThrow('Resource not found');
    });

    it('should handle request timeout', async () => {
      global.fetch = createTimeoutFetch(100) as any;

      await expect(client.delete('test')).rejects.toThrow('Request timeout');
    });
  });

  describe('Authentication', () => {
    it('should use API key from environment', () => {
      const client = new SciXAPIClient();
      expect(client).toBeDefined();
    });

    it('should include Bearer token in all requests', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await client.get('test');
      const [, getInit] = mockFetch.mock.calls[0];
      expect(getInit.headers['Authorization']).toBe('Bearer test-api-key');

      await client.post('test', {});
      const [, postInit] = mockFetch.mock.calls[1];
      expect(postInit.headers['Authorization']).toBe('Bearer test-api-key');

      await client.put('test', {});
      const [, putInit] = mockFetch.mock.calls[2];
      expect(putInit.headers['Authorization']).toBe('Bearer test-api-key');

      await client.delete('test');
      const [, deleteInit] = mockFetch.mock.calls[3];
      expect(deleteInit.headers['Authorization']).toBe('Bearer test-api-key');
    });
  });

  describe('Content-Type headers', () => {
    it('should set application/json for all requests', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await client.get('test');
      await client.post('test', {});
      await client.put('test', {});
      await client.delete('test');

      for (let i = 0; i < 4; i++) {
        const [, init] = mockFetch.mock.calls[i];
        expect(init.headers['Content-Type']).toBe('application/json');
      }
    });
  });
});
