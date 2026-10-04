import { describe, it, expect, afterEach, vi } from 'vitest';
import { handleArxivReadPaper } from '../../src/tools/arxiv.js';
import { makeAtomFeed, PAPER_1 } from '../helpers/arxivFixtures.js';
import { restoreFetch } from '../helpers/mockFetch.js';
import { UNTRUSTED_BANNER } from '../../src/content.js';

const originalFetch = global.fetch;

function createTarEntry(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8');
  const header = Buffer.alloc(512, 0);

  header.write(name, 0, Math.min(100, Buffer.byteLength(name)), 'utf8');
  header.write('0000777\0', 100, 'utf8');
  header.write('0000000\0', 108, 'utf8');
  header.write('0000000\0', 116, 'utf8');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('00000000000\0', 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

function makeTarArchive(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, content]) => createTarEntry(name, content));
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
}

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

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj 4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj 5 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Sample PDF text) Tj ET\nendstream endobj xref 0 6 0000000000 65535 f 0000000009 00000 n 0000000058 00000 n 0000000115 00000 n 0000000214 00000 n 0000000301 00000 n trailer<</Size 6/Root 1 0 R>>startxref 398\n%%EOF',
  'utf8'
);

const LATEX = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
TeX body with more substance than the abstract.
\end{document}`;

const FULL_HTML = `<html><body><article><h1>Attention Is All You Need</h1>
<section><h2>Introduction</h2><p>Transformer text from HTML.</p></section>
<section><h2>Method</h2><p>More HTML content.</p></section>
<section><h2>Conclusion</h2><p>Done.</p></section>
<section><h2>References</h2><p>[1] Vaswani et al.</p></section></article></body></html>`;

describe('handleArxivReadPaper', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    restoreFetch();
  });

  it('prefers HTML when it looks like full paper text', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/html/2103.01231')) {
        return makeResponse({ text: `
          <html>
            <body>
              <article>
                <h1>Attention Is All You Need</h1>
                <section><h2>Introduction</h2><p>Transformer text from HTML.</p></section>
                <section><h2>Method</h2><p>More HTML content.</p></section>
                <section><h2>Conclusion</h2><p>Done.</p></section>
                <section><h2>References</h2><p>[1] Vaswani et al.</p></section>
              </article>
            </body>
          </html>
        ` });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivReadPaper({ paper_id: '2103.01231', source: 'auto', offset: 0, max_chars: 12_000 });

    expect(result.text).toContain('Attention Is All You Need');
    expect(result.text).toContain('**Source:** arXiv HTML');
    expect(result.text).toContain('Introduction');
    expect(result.text).toContain('Transformer text from HTML');
  });

  it('falls back to the source archive when HTML is too short', async () => {
    const tex = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
TeX body with more substance than the abstract.
\section{Method}
Important method details.
\end{document}`;
    const archive = makeTarArchive({ 'main.tex': tex });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/html/2103.01231')) {
        return makeResponse({ text: '<html><body><h1>Abstract</h1><p>Short abstract only.</p></body></html>' });
      }

      if (url.includes('/e-print/2103.01231')) {
        return makeResponse({ buffer: archive });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const result = await handleArxivReadPaper({ paper_id: '2103.01231', source: 'auto', offset: 0, max_chars: 12_000 });

    expect(result.text).toContain('**Source:** arXiv source archive');
    expect(result.text).toContain('main.tex');
    expect(result.text).toContain('Introduction');
    expect(result.text).toContain('TeX body with more substance than the abstract');
  });

  it('paginates long extracted paper text', async () => {
    const longBody = 'A'.repeat(1500) + 'NEXT_PAGE_MARKER';
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) {
        return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      }

      if (url.includes('/html/2103.01231')) {
        return makeResponse({ text: `
          <html>
            <body>
              <article>
                <h1>Attention Is All You Need</h1>
                <section><h2>Introduction</h2><p>${longBody}</p></section>
                <section><h2>Method</h2><p>More HTML content.</p></section>
                <section><h2>Conclusion</h2><p>Done.</p></section>
                <section><h2>References</h2><p>[1] Vaswani et al.</p></section>
              </article>
            </body>
          </html>
        ` });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const firstPage = await handleArxivReadPaper({
      paper_id: '2103.01231',
      source: 'auto',
      offset: 0,
      max_chars: 1000,
    });
    const secondPage = await handleArxivReadPaper({
      paper_id: '2103.01231',
      source: 'auto',
      offset: 1000,
      max_chars: 1000,
    });

    expect(firstPage.text).toContain('offset=1000');
    expect(firstPage.text).not.toContain('NEXT_PAGE_MARKER');
    expect(secondPage.text).toContain('NEXT_PAGE_MARKER');
  });

  function routed(routes: Record<string, () => Response>) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/query')) return makeResponse({ text: makeAtomFeed([PAPER_1]) });
      for (const [needle, make] of Object.entries(routes)) if (url.includes(needle)) return make();
      throw new Error(`Unexpected URL: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;
    return fetchMock;
  }

  const input = (over: Partial<Parameters<typeof handleArxivReadPaper>[0]> = {}) => ({
    paper_id: '2103.01231', source: 'auto' as const, offset: 0, max_chars: 12_000, ...over,
  });

  it('prefixes the text with the untrusted-content banner and reports structured metadata', async () => {
    routed({ '/html/2103.01231': () => makeResponse({ text: FULL_HTML }) });

    const result = await handleArxivReadPaper(input());

    expect(result.text.startsWith(UNTRUSTED_BANNER)).toBe(true);
    expect(result.structured).toMatchObject({
      arxiv_id: '2103.01231', source: 'html', offset: 0, next_offset: null,
    });
    expect(result.structured['total_chars']).toBe(result.structured['returned_chars']);
  });

  it('reports next_offset while more text remains', async () => {
    routed({ '/html/2103.01231': () => makeResponse({ text: FULL_HTML.replace('Done.', 'D'.repeat(3000)) }) });

    const result = await handleArxivReadPaper(input({ max_chars: 1000 }));

    expect(result.structured['next_offset']).toBe(1000);
    expect(result.structured['returned_chars']).toBe(1000);
  });

  it('source=pdf extracts text from the PDF without touching HTML or e-print', async () => {
    const fetchMock = routed({ '/pdf/2103.01231': () => makeResponse({ buffer: PDF_BYTES }) });

    const result = await handleArxivReadPaper(input({ source: 'pdf' }));

    expect(result.text).toContain('2103.01231');
    expect(result.text).toContain('Attention Is All You Need');
    expect(result.text).toContain('**Source:** arXiv PDF');
    expect(result.structured['source']).toBe('pdf');
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('/html/') || u.includes('/e-print/'))).toBe(false);
  });

  it('source=latex uses the source archive even when HTML is a full paper', async () => {
    const fetchMock = routed({
      '/html/2103.01231': () => makeResponse({ text: FULL_HTML }),
      '/e-print/2103.01231': () => makeResponse({ buffer: makeTarArchive({ 'main.tex': LATEX }) }),
    });

    const result = await handleArxivReadPaper(input({ source: 'latex' }));

    expect(result.structured).toMatchObject({ source: 'latex', source_name: 'main.tex' });
    expect(result.text).toContain('TeX body with more substance');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/html/'))).toBe(false);
  });

  it('source=html returns the HTML text even when it is short', async () => {
    routed({ '/html/2103.01231': () => makeResponse({ text: '<html><body><p>Short.</p></body></html>' }) });

    const result = await handleArxivReadPaper(input({ source: 'html' }));

    expect(result.structured['source']).toBe('html');
    expect(result.text).toContain('Short.');
  });

  it('a forced source does not fall back: source=latex without an archive fails', async () => {
    routed({
      '/html/2103.01231': () => makeResponse({ text: FULL_HTML }),
      '/e-print/2103.01231': () => makeResponse({ status: 404 }),
    });

    await expect(handleArxivReadPaper(input({ source: 'latex' }))).rejects.toThrow('No LaTeX source');
  });

  it('keeps the requested version for full-text URLs and reports it', async () => {
    const fetchMock = routed({ '/html/2103.01231v2': () => makeResponse({ text: FULL_HTML }) });

    const result = await handleArxivReadPaper(input({ paper_id: 'arXiv:2103.01231v2' }));

    expect(result.structured['version']).toBe('v2');
    expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/html/2103.01231v2'))).toBe(true);
    // metadata lookup still uses the bare id
    expect(String(fetchMock.mock.calls[0][0])).toContain('id_list=2103.01231&');
  });

  it('rejects a malformed id before any request is made', async () => {
    const fetchMock = routed({});

    await expect(handleArxivReadPaper(input({ paper_id: 'invalid-id' }))).rejects.toThrow('Invalid arXiv id');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns not-found when the PDF-only lookup finds no paper', async () => {
    global.fetch = vi.fn(async () => makeResponse({
      text: '<?xml version="1.0" encoding="UTF-8"?><feed><title>ArXiv Query Response</title></feed>',
    })) as typeof fetch;

    const result = await handleArxivReadPaper(input({ paper_id: '9999.00000', source: 'pdf' }));

    expect(result.isError).toBe(true);
    expect(result.text).toContain('No paper found');
  });
});
