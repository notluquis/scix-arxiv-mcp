import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SciXAPIClient } from '../../src/client.js';
import { setupMockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { getCitations, getReferences } from '../../src/tools/citations.js';
import { ResponseFormat } from '../../src/types.js';

describe('Citations and References Tools', () => {
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

  describe('getCitations', () => {
    it('should fetch citations for a paper', async () => {
      const mockResponse = {
        response: {
          numFound: 50,
          docs: [
            {
              bibcode: '2024ApJ...789..012B',
              title: ['Citing Paper'],
              author: ['Smith, J.'],
              year: '2024',
              citation_count: 5
            }
          ]
        }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      const result = await getCitations(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search/query');
      expect(url).toContain('q=citations%28bibcode%3A2024ApJ...123..456A%29');
      expect(url).toContain('rows=10');
      expect(url).toContain('sort=citation_count+desc');

      expect(result).toContain('Citing Paper');
      expect(result).toContain('Papers citing 2024ApJ...123..456A');
    });

    it('should limit results by rows parameter', async () => {
      const mockResponse = {
        response: { numFound: 100, docs: [] }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      await getCitations(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 25,
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('rows=25');
    });

    it('should sort by citation count descending', async () => {
      const mockFetch = setupMockFetch({
        body: { response: { numFound: 0, docs: [] } }
      });

      await getCitations(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('sort=citation_count+desc');
    });

    it('should return JSON format', async () => {
      const mockResponse = {
        response: {
          numFound: 1,
          docs: [{ bibcode: 'test' }]
        }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getCitations(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.JSON
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockResponse);
    });

    it('should handle papers with no citations', async () => {
      const mockResponse = {
        response: { numFound: 0, docs: [] }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getCitations(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      expect(result).toBeDefined();
    });
  });

  describe('getReferences', () => {
    it('should fetch references for a paper', async () => {
      const mockResponse = {
        response: {
          numFound: 30,
          docs: [
            {
              bibcode: '2023MNRAS.456..789C',
              title: ['Referenced Paper'],
              author: ['Johnson, K.'],
              year: '2023',
              citation_count: 100
            }
          ]
        }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      const result = await getReferences(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search/query');
      expect(url).toContain('q=references%28bibcode%3A2024ApJ...123..456A%29');
      expect(url).toContain('rows=10');
      expect(url).toContain('sort=citation_count+desc');

      expect(result).toContain('Referenced Paper');
      expect(result).toContain('Papers referenced by 2024ApJ...123..456A');
    });

    it('should limit results by rows parameter', async () => {
      const mockResponse = {
        response: { numFound: 100, docs: [] }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      await getReferences(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 50,
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('rows=50');
    });

    it('should sort by citation count descending', async () => {
      const mockFetch = setupMockFetch({
        body: { response: { numFound: 0, docs: [] } }
      });

      await getReferences(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('sort=citation_count+desc');
    });

    it('should return JSON format', async () => {
      const mockResponse = {
        response: {
          numFound: 1,
          docs: [{ bibcode: 'test' }]
        }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getReferences(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.JSON
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockResponse);
    });

    it('should handle papers with no references', async () => {
      const mockResponse = {
        response: { numFound: 0, docs: [] }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getReferences(client, {
        bibcode: '2024ApJ...123..456A',
        rows: 10,
        response_format: ResponseFormat.MARKDOWN
      });

      expect(result).toBeDefined();
    });
  });
});
