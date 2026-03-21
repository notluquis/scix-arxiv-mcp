import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SciXAPIClient } from '../../src/client.js';
import { setupMockFetch, restoreFetch } from '../helpers/mockFetch.js';
import { getPaper } from '../../src/tools/paper.js';
import { ResponseFormat } from '../../src/types.js';

describe('Paper Tool', () => {
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

  describe('getPaper', () => {
    it('should fetch paper details by bibcode', async () => {
      const mockPaper = {
        bibcode: '2024ApJ...123..456A',
        title: ['A Comprehensive Study of Black Holes'],
        author: ['Einstein, A.', 'Hawking, S.'],
        year: '2024',
        pubdate: '2024-01-15',
        abstract: 'This paper studies black holes...',
        citation_count: 100,
        read_count: 500,
        doi: ['10.1234/test.doi'],
        arxiv_id: 'arXiv:2401.12345',
        pub: 'ApJ',
        volume: '123',
        page: ['456'],
        keyword: ['black holes', 'gravity'],
        aff: ['Institute of Physics'],
        identifier: ['2024ApJ...123..456A']
      };

      const mockResponse = {
        response: {
          numFound: 1,
          docs: [mockPaper]
        }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      const result = await getPaper(client, {
        bibcode: '2024ApJ...123..456A',
        response_format: ResponseFormat.MARKDOWN
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('search/query');
      expect(url).toContain('q=bibcode%3A2024ApJ...123..456A');
      expect(url).toContain('rows=1');

      expect(result).toContain('Black Holes');
      expect(result).toContain('Einstein');
    });

    it('should throw error if paper not found', async () => {
      const mockResponse = {
        response: {
          numFound: 0,
          docs: []
        }
      };

      setupMockFetch({ body: mockResponse });

      await expect(
        getPaper(client, {
          bibcode: 'nonexistent',
          response_format: ResponseFormat.MARKDOWN
        })
      ).rejects.toThrow('Paper with bibcode nonexistent not found');
    });

    it('should return JSON format', async () => {
      const mockPaper = {
        bibcode: '2024ApJ...123..456A',
        title: ['Test Paper']
      };

      const mockResponse = {
        response: {
          numFound: 1,
          docs: [mockPaper]
        }
      };

      setupMockFetch({ body: mockResponse });

      const result = await getPaper(client, {
        bibcode: '2024ApJ...123..456A',
        response_format: ResponseFormat.JSON
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(mockPaper);
    });

    it('should request all default fields', async () => {
      const mockResponse = {
        response: { numFound: 1, docs: [{ bibcode: 'test' }] }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      await getPaper(client, {
        bibcode: '2024ApJ...123..456A',
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      // Should include fl parameter with default fields
      expect(url).toContain('fl=');
      expect(url).toContain('bibcode');
      expect(url).toContain('title');
      expect(url).toContain('author');
    });

    it('should always request exactly 1 row', async () => {
      const mockResponse = {
        response: { numFound: 1, docs: [{ bibcode: 'test' }] }
      };

      const mockFetch = setupMockFetch({ body: mockResponse });

      await getPaper(client, {
        bibcode: '2024ApJ...123..456A',
        response_format: ResponseFormat.MARKDOWN
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('rows=1');
    });
  });
});
