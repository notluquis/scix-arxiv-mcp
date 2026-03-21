import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SciXAPIClient } from '../../src/client.js';
import { setupMockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { getMetrics } from '../../src/tools/metrics.js';
import { ResponseFormat } from '../../src/types.js';
import { MAX_BIBCODES } from '../../src/config.js';

describe('Metrics Tool', () => {
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

  describe('getMetrics', () => {
    it('should fetch metrics for single bibcode', async () => {
      const mockResponse = {
        citation_stats: {
          total_number_of_citations: 150,
          number_of_citing_papers: 100,
          average_citations: 1.5
        },
        indicators: {
          h: 10,
          i10: 5,
          i100: 1
        }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      const result = await getMetrics(client, {
        bibcodes: ['2024ApJ...123..456A'],
        response_format: ResponseFormat.MARKDOWN
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('metrics');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body);
      expect(body.bibcodes).toEqual(['2024ApJ...123..456A']);
      expect(body.types).toEqual(['basic', 'citations', 'indicators']);

      expect(result).toBeDefined();
    });

    it('should handle multiple bibcodes', async () => {
      const mockResponse = {
        citation_stats: { total_number_of_citations: 500 }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      await getMetrics(client, {
        bibcodes: ['bib1', 'bib2', 'bib3'],
        response_format: ResponseFormat.MARKDOWN
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.bibcodes).toEqual(['bib1', 'bib2', 'bib3']);
    });

    it('should respect MAX_BIBCODES limit', async () => {
      const bibcodes = Array.from({ length: MAX_BIBCODES }, (_, i) => `bib${i}`);
      const mockFetch = setupMockFetch({ body: {} });

      await getMetrics(client, {
        bibcodes,
        response_format: ResponseFormat.MARKDOWN
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.bibcodes.length).toBe(MAX_BIBCODES);
    });

    it('should return JSON format', async () => {
      const mockResponse = {
        citation_stats: { total_number_of_citations: 100 }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getMetrics(client, {
        bibcodes: ['test'],
        response_format: ResponseFormat.JSON
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockResponse);
    });

    it('should request all metric types', async () => {
      const mockFetch = setupMockFetch({ body: {} });

      await getMetrics(client, {
        bibcodes: ['test'],
        response_format: ResponseFormat.MARKDOWN
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.types).toContain('basic');
      expect(body.types).toContain('citations');
      expect(body.types).toContain('indicators');
    });
  });
});
