import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleArxivDownloadPaper } from '../../src/tools/arxiv_download_paper.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';

const originalFetch = global.fetch;

function makeResponse(options: { text?: string; buffer?: Buffer; status?: number }) {
  const { text = '', buffer, status = 200 } = options;
  const bytes = buffer ?? Buffer.from(text, 'utf8');

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => text,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

describe('handleArxivDownloadPaper', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('downloads and extracts text from PDF', async () => {
    // Simple PDF mock: minimal PDF structure
    const pdfBytes = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Sample PDF text) Tj ET\nendstream endobj xref 0 6 0000000000 65535 f 0000000009 00000 n 0000000058 00000 n 0000000115 00000 n 0000000214 00000 n 0000000301 00000 n trailer<</Size 6/Root 1 0 R>>startxref 398\n%%EOF',
      'utf8'
    );

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/pdf/2103.01231')) {
        return makeResponse({ buffer: pdfBytes });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivDownloadPaper({ paper_id: '2103.01231' });

    expect(result).toContain('2103.01231');
    expect(result).toContain('Attention Is All You Need');
    expect(result.length).toBeGreaterThan(100);
  });

  it('returns error message when paper not found', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: '<?xml version="1.0" encoding="UTF-8"?><feed><title>ArXiv Query Response</title><opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:totalResults></feed>' });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivDownloadPaper({ paper_id: 'invalid-id' });

    expect(result).toContain('Could not download paper');
  });
});
